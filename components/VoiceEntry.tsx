"use client";

// Voice-first front door. The landing page listens for "Enter the
// bridge" / "Start" (and "Resume" when a run is saved) through the same
// Meta Voice Transcribe endpoint the cockpit uses. The button remains
// only as an accessibility fallback; the core journey never needs it.
//
// The component is deliberately small and fail-safe: denied mic,
// missing audio engine, or a failed transcription all leave the button
// available and show a plain-language line instead of a dead screen.

import { useEffect, useRef, useState } from "react";
import { loadPcmWorklet, micFailureNotice } from "../lib/mic";
import { rmsLevel } from "../lib/live-intent";
import { concatFloat32, toPcm16k } from "../lib/pcm";
import { entryHint, entryPrompt, parseEntryIntent, type EntryMode } from "../lib/voice-entry";
import { progressSummary, type SavedSession } from "../lib/persistence";

type Props = {
  saved: SavedSession | null;
  onEnter: (mode: EntryMode) => void;
  onStartOver: () => void;
};

const ENTRY_RMS = 0.012;
const ENTRY_SILENCE_MS = 1100;

export default function VoiceEntry({ saved, onEnter, onStartOver }: Props) {
  const [status, setStatus] = useState<"starting" | "listening" | "heard" | "error">("starting");
  const [heard, setHeard] = useState("");
  const [error, setError] = useState("");
  const [level, setLevel] = useState(0);
  const [busy, setBusy] = useState(false);
  const [permissionHint, setPermissionHint] = useState(false);
  const [audioWarn, setAudioWarn] = useState(false);
  const streamRef = useRef<MediaStream | null>(null);
  const ctxRef = useRef<AudioContext | null>(null);
  const nodeRef = useRef<AudioWorkletNode | null>(null);
  const chunksRef = useRef<Float32Array[]>([]);
  const speechSeenRef = useRef(false);
  const lastSpeechAtRef = useRef(0);
  const busyRef = useRef(false);
  const doneRef = useRef(false);
  const startedRef = useRef(false);
  const cancelledRef = useRef(false);

  function cleanup() {
    try {
      nodeRef.current?.disconnect();
    } catch {
      // ignore
    }
    nodeRef.current = null;
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    const ctx = ctxRef.current;
    ctxRef.current = null;
    if (ctx && ctx.state !== "closed") void ctx.close().catch(() => undefined);
  }

  function enter(mode: EntryMode) {
    if (doneRef.current) return;
    doneRef.current = true;
    cleanup();
    try {
      window.speechSynthesis?.cancel();
    } catch {
      // ignore
    }
    if (mode === "fresh" && saved) {
      onStartOver();
    } else {
      onEnter(saved ? "resume" : "fresh");
    }
  }

  function handleTranscript(text: string) {
    const clean = (text ?? "").trim();
    if (!clean) return;
    setHeard(clean);
    const intent = parseEntryIntent(clean);
    if (!intent) {
      setStatus("heard");
      return;
    }
    // "Enter the bridge" on a saved run means resume; "start over" is the
    // only phrase that discards it.
    if (intent.mode === "fresh" && !/start\s*over|fresh|new|reset|beginning/i.test(clean)) {
      enter("resume");
      return;
    }
    enter(intent.mode);
  }

  async function sendChunk() {
    if (busyRef.current || doneRef.current) return;
    const chunks = chunksRef.current;
    chunksRef.current = [];
    const speechSeen = speechSeenRef.current;
    speechSeenRef.current = false;
    if (!speechSeen) return;
    const samples = concatFloat32(chunks);
    const rate = ctxRef.current?.sampleRate ?? 16000;
    if (samples.length < rate * 0.15) return;
    const pcm = rate === 16000
      ? (() => {
          const out = new Int16Array(samples.length);
          for (let i = 0; i < samples.length; i++) {
            const s = Math.max(-1, Math.min(1, samples[i]));
            out[i] = Math.round(s < 0 ? s * 0x8000 : s * 0x7fff);
          }
          return out;
        })()
      : toPcm16k(samples, rate);
    busyRef.current = true;
    setBusy(true);
    try {
      const form = new FormData();
      const bytes = new Uint8Array(pcm.byteLength);
      bytes.set(new Uint8Array(pcm.buffer, pcm.byteOffset, pcm.byteLength));
      form.append("audio", new Blob([bytes], { type: "audio/L16" }), "entry.pcm");
      const res = await fetch("/api/transcribe", {
        method: "POST",
        body: form,
        signal: AbortSignal.timeout(20_000),
      });
      const data = (await res.json()) as { transcript?: string; error?: string };
      if (!res.ok) throw new Error(data.error ?? `transcribe failed (${res.status})`);
      handleTranscript(String(data.transcript ?? ""));
    } catch (err) {
      setStatus("heard");
      setHeard(`I couldn't catch that. ${micFailureNotice(err)}`);
      setError(micFailureNotice(err));
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }

  async function start() {
    if (startedRef.current || doneRef.current) return;
    startedRef.current = true;
    cancelledRef.current = false;
    setStatus("starting");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
      if (cancelledRef.current || doneRef.current) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }
      streamRef.current = stream;
      let ctx: AudioContext;
      try {
        ctx = new AudioContext({ sampleRate: 16000 });
      } catch {
        ctx = new AudioContext();
      }
      ctxRef.current = ctx;
      await loadPcmWorklet((url) => ctx.audioWorklet.addModule(url));
      const node = new AudioWorkletNode(ctx, "pcm-capture");
      nodeRef.current = node;
      node.port.onmessage = (event: MessageEvent) => {
        const block = event.data as Float32Array;
        if (!block || block.length === 0 || doneRef.current) return;
        chunksRef.current.push(block);
        const now = performance.now();
        const rms = rmsLevel(block);
        setLevel((prev) => Math.max(rms, prev * 0.82));
        if (rms >= ENTRY_RMS) {
          speechSeenRef.current = true;
          lastSpeechAtRef.current = now;
        }
        if (speechSeenRef.current && now - lastSpeechAtRef.current > ENTRY_SILENCE_MS) {
          void sendChunk();
        }
        // Bound the pre-roll so a long silence doesn't grow memory.
        if (chunksRef.current.length > 240) chunksRef.current.shift();
      };
      const source = ctx.createMediaStreamSource(stream);
      source.connect(node);
      if (ctx.state === "suspended") await ctx.resume();

      if (typeof window !== "undefined") {
        const w = window as unknown as Record<string, unknown>;
        const Ctor = (w.SpeechRecognition ?? w.webkitSpeechRecognition) as
          | (new () => { lang: string; continuous: boolean; interimResults: boolean; start: () => void; stop: () => void; onresult: unknown; onerror: unknown })
          | undefined;
        if (Ctor) {
          try {
            const rec = new Ctor();
            rec.lang = "en-US";
            rec.interimResults = true;
            rec.continuous = true;
            rec.onresult = (ev: { results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal?: boolean }> }) => {
              if (doneRef.current) return;
              let text = "";
              for (let i = 0; i < ev.results.length; i++) {
                text += ev.results[i][0]?.transcript ?? "";
              }
              const clean = text.trim();
              if (clean) {
                setHeard(clean);
                const intent = parseEntryIntent(clean);
                if (intent) {
                  try { rec.stop(); } catch { /* ignore */ }
                  handleTranscript(clean);
                }
              }
            };
            rec.onerror = () => {};
            rec.start();
          } catch {
            // ignore
          }
        }
      }

      setStatus("listening");
    } catch (err) {
      setStatus("error");
      setError(micFailureNotice(err));
    }
  }

  // Speak the one instruction first, then open the mic. If speech is
  // unavailable or blocked, open the mic anyway after a short beat.
  useEffect(() => {
    cancelledRef.current = false;
    startedRef.current = false;
    const prompt = entryPrompt(Boolean(saved), saved ? progressSummary(saved.state) : "");
    let began = false;
    const begin = () => {
      if (began) return;
      began = true;
      void start();
    };
    let promptStarted = false;
    try {
      if (typeof window !== "undefined" && window.speechSynthesis) {
        const utter = new SpeechSynthesisUtterance(prompt);
        utter.rate = 0.95;
        utter.onstart = () => {
          promptStarted = true;
        };
        utter.onend = begin;
        utter.onerror = begin;
        window.speechSynthesis.speak(utter);
      }
    } catch {
      // ignore
    }
    const audioCheck = setTimeout(() => {
      if (!promptStarted) setAudioWarn(true);
    }, 1800);
    const fallback = setTimeout(begin, 2400);
    return () => {
      clearTimeout(fallback);
      clearTimeout(audioCheck);
      cancelledRef.current = true;
      startedRef.current = false;
      cleanup();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (status !== "starting") return;
    const timer = setTimeout(() => setPermissionHint(true), 5000);
    return () => clearTimeout(timer);
  }, [status]);

  const hasSaved = Boolean(saved);
  return (
    <section className="voice-gate" data-testid="voice-gate" aria-labelledby="voice-gate-title">
      <div className="landing-orb-wrap" aria-hidden="true">
        <span className="landing-spin" />
        <span className="boot-orbit" />
      </div>
      <p className="eyebrow">VVB-01 · ORBITAL FOUNDRY</p>
      <h1 id="voice-gate-title" className="landing-title">
        Visual Vocal Builder
      </h1>
      <p className="landing-tagline">Build a colony by voice. Never touch a mouse.</p>

      <div className="voice-gate-card">
        <p className="voice-gate-hint" data-testid="voice-gate-hint">
          {entryHint(hasSaved)}
        </p>
        {hasSaved ? (
          <p className="voice-gate-saved" data-testid="voice-gate-saved">
            Saved run · {progressSummary(saved!.state)}
          </p>
        ) : null}
        <p className="voice-gate-status" data-testid="voice-gate-status" role="status" aria-live="polite">
          {status === "starting"
            ? permissionHint
              ? "Waiting for microphone permission — choose Allow once, or use the button below."
              : "Opening the mic…"
            : status === "listening"
              ? busy
                ? "Listening — checking what I heard…"
                : "Listening for your voice…"
              : status === "heard"
                ? "I heard you, but not the entry phrase. Try again."
                : "Voice entry could not start."}
        </p>
        <div className="voice-gate-meter" aria-hidden="true" data-testid="voice-gate-level">
          {[0.12, 0.3, 0.55, 0.8].map((bar) => (
            <span key={bar} className={level >= bar ? "is-on" : ""} />
          ))}
        </div>
        {heard ? (
          <p className="voice-gate-heard" data-testid="voice-gate-heard">
            Heard: <q>{heard}</q>
          </p>
        ) : null}
        {audioWarn ? (
          <p className="voice-gate-error" data-testid="landing-audio-warning" role="alert">
            No host audio detected. Check the system output device and the tab mute; voice entry
            still works. Inside, say “test voice”.
          </p>
        ) : null}
        {error ? (
          <p className="voice-gate-error" data-testid="voice-gate-error" role="alert">
            {error}
          </p>
        ) : null}
        <div className="voice-gate-actions">
          <button
            type="button"
            className="btn btn-primary landing-enter"
            data-testid="enter-bridge"
            onClick={() => enter(hasSaved ? "resume" : "fresh")}
          >
            {hasSaved ? "Resume" : "Enter the Bridge"}
          </button>
          {hasSaved ? (
            <button
              type="button"
              className="btn"
              data-testid="start-over-button"
              onClick={() => onStartOver()}
            >
              Start over
            </button>
          ) : null}
        </div>
        <p className="voice-gate-help">
          You can always say <strong>help</strong>, <strong>repeat that</strong>, <strong>stop</strong>,{" "}
          <strong>slower</strong>, or <strong>start over</strong> once inside.
        </p>
      </div>

      <p id="landing-disclaimer" className="landing-disclaimer">
        Demo data only. This is not legal advice, not a filing, and nothing here is submitted to any
        registry. Fictional places and a fictional company only.
      </p>
    </section>
  );
}
