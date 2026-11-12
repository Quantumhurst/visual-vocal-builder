"use client";

// The host's voice: speak one line, cancel it (barge-in), and recover when
// a voice never starts. "Host speaking" lives in the turn machine
// (HOST_START / HOST_END / HOST_CANCEL), so the mic gate and the re-arm
// rule read the same truth.
//
// Engines: the Gemini neural voice through Web Audio when the server has
// it (useNeuralPlayback), otherwise — and as the fallback for any slow or
// failed neural line — the browser/OS voice through the surviving speech
// queue.
//
// A browser can report `speechSynthesis.speaking === true` while the
// utterance never starts — that is silence, not a slow start. If no
// onstart arrives, cancel and retry once with the system default voice.
// If the default also fails, surface a visible host-audio fault instead
// of continuing silently.

import { useEffect, useLayoutEffect, useRef, useState, type MutableRefObject } from "react";
import { NEURAL_VOICE_WAIT_MS, hostTts, withDeadline } from "../../lib/host-tts";
import type { ProviderInfo } from "../../lib/provider";
import type { RecoveryKind } from "../../lib/recovery";
import { spokenHostText } from "../../lib/spoken-text";
import type { TurnStore } from "../../lib/turn-store";
import type { TurnTimings } from "../../lib/turn-timing";
import type { VoiceSettings } from "../../lib/voice-controls";
import { pickVoice, prosodyFor } from "../../lib/voice-select";
import { echoFilter } from "../../lib/voice/echo-filter";
import { speechQueue } from "../../lib/voice/surviving-speech-queue";
import type { BrowserVoiceChoice } from "./useBrowserVoiceChoice";
import type { NeuralPlayback } from "./useNeuralPlayback";

// useLayoutEffect warns during server rendering; the deps only matter in
// the browser.
const useIsomorphicLayoutEffect = typeof window === "undefined" ? useEffect : useLayoutEffect;

export type HostAudioStats = {
  started: number;
  ended: number;
  errors: number;
  retries: number;
  lastVoice: string;
  lastVolume: number;
  lastRate: number;
  lastStartedAt: number;
};

export type SpeakOptions = { retry?: number; useDefaultVoice?: boolean };

export type HostSpeechDeps = {
  turn: TurnStore;
  settingsRef: MutableRefObject<VoiceSettings>;
  providerRef: MutableRefObject<ProviderInfo>;
  neural: NeuralPlayback;
  voiceChoice: BrowserVoiceChoice;
  // The last line handed to the speech path (Canvas reads it elsewhere).
  lastHostLineRef: MutableRefObject<string>;
  appendLog: (role: "host", text: string) => void;
  logEvent: (line: string) => void;
  stampTiming: (field: keyof TurnTimings) => void;
  setNotice: (text: string) => void;
  surfaceRecovery: (kind: RecoveryKind) => void;
  // A voice started: drop a host-silent recovery banner if one is up.
  clearSilentRecovery: () => void;
  requestRearm: () => void;
  // Barge-in also cancels a pending mic re-arm.
  onCancel: () => void;
};

export type HostSpeech = {
  // Speaks one line (after the caption is painted). False when there is
  // nothing to say or no window. onDone runs when the line ends, is muted,
  // or finally fails — never when it is cancelled.
  speak: (text: string, onDone?: () => void, options?: SpeakOptions) => boolean;
  // Barge-in: stop now, drop queued speech, no onDone.
  cancel: () => void;
  // Any engine still producing host audio.
  isActive: () => boolean;
  stats: () => HostAudioStats;
  // Unmount: clear the watchdog and start timer, forget the live utterance.
  dispose: () => void;
  hostSilent: boolean;
  setHostSilent: (silent: boolean) => void;
};

// Two animation frames is one painted screen. A hidden tab has no frames,
// so a timeout is the fallback; speech must never be lost to a throttled
// rAF.
function afterNextPaint(fn: () => void) {
  if (typeof window === "undefined" || document.visibilityState === "hidden") {
    fn();
    return;
  }
  let ran = false;
  const run = () => {
    if (ran) return;
    ran = true;
    fn();
  };
  window.requestAnimationFrame(() => window.requestAnimationFrame(run));
  window.setTimeout(run, 140);
}

export function useHostSpeech(deps: HostSpeechDeps): HostSpeech {
  const [hostSilent, setHostSilent] = useState(false);
  // Callbacks come from the latest render, so they never act on stale state.
  const depsRef = useRef(deps);
  useIsomorphicLayoutEffect(() => {
    depsRef.current = deps;
  });

  const [engine] = useState(() => {
    const attemptSeq = { current: 0 };
    const utterCancelled = { current: false };
    // Keep a reference to the live utterance: Chrome can drop an
    // unreferenced utterance before firing onend, leaving
    // speechSynthesis.speaking stuck true and the mic closed forever. The
    // watchdog is the last resort.
    const utterance: { current: SpeechSynthesisUtterance | null } = { current: null };
    const watchdog: { current: ReturnType<typeof setTimeout> | null } = { current: null };
    const startTimer: { current: ReturnType<typeof setTimeout> | null } = { current: null };
    const stats: HostAudioStats = {
      started: 0,
      ended: 0,
      errors: 0,
      retries: 0,
      lastVoice: "",
      lastVolume: 1,
      lastRate: 1,
      lastStartedAt: 0,
    };

    const clearWatchdog = () => {
      if (watchdog.current !== null) {
        clearTimeout(watchdog.current);
        watchdog.current = null;
      }
    };
    const clearStartTimer = () => {
      if (startTimer.current !== null) {
        clearTimeout(startTimer.current);
        startTimer.current = null;
      }
    };

    const cancel = () => {
      const d = depsRef.current;
      utterCancelled.current = true;
      attemptSeq.current += 1;
      clearWatchdog();
      clearStartTimer();
      d.onCancel();
      d.neural.stop();
      utterance.current = null;
      d.turn.dispatch({ type: "HOST_CANCEL" });
      echoFilter.clear();
      speechQueue.hardFlushOnBargeIn();
    };

    const speak = (text: string, onDone?: () => void, options: SpeakOptions = {}): boolean => {
      if (typeof window === "undefined") return false;
      const d = depsRef.current;
      const spoken = spokenHostText(text);
      if (!spoken) return false;
      const retry = options.retry ?? 0;
      d.lastHostLineRef.current = spoken;
      if (retry === 0) {
        d.appendLog("host", spoken);
        const win = window as unknown as { __vvbLastSpoken?: string; __vvbAllSpoken?: string[] };
        win.__vvbLastSpoken = spoken;
        win.__vvbAllSpoken = win.__vvbAllSpoken ?? [];
        win.__vvbAllSpoken.push(spoken);
      }
      // Muted or no speech engine: the line is still visible, logged, and
      // repeatable. Callers still get their completion callback.
      if (!d.settingsRef.current.voiceOn || d.settingsRef.current.volume <= 0.01) {
        onDone?.();
        return true;
      }

      // Paint first, then speak. Local callers set the caption right
      // before this call; two frames guarantee it is on screen when the
      // first word is audible. The mic is gated from this moment, so the
      // paint gap cannot capture a stray fragment.
      utterCancelled.current = false;
      d.turn.dispatch({ type: "HOST_START" });
      const attempt = ++attemptSeq.current;

      const speakAfterPaint = () => {
        if (attempt !== attemptSeq.current || utterCancelled.current) return;
        echoFilter.recordHostSpeech(spoken);
        clearWatchdog();
        clearStartTimer();

        const finishSpeech = () => {
          if (attempt !== attemptSeq.current) return;
          clearWatchdog();
          clearStartTimer();
          utterance.current = null;
          depsRef.current.turn.dispatch({ type: "HOST_END" });
          // Keep the lexical guard only for the brief speaker tail. The mic
          // is gated during playback, so holding host words for 1.2s after
          // the line ends only drops the user's natural fast answer.
          echoFilter.scheduleClear(200);
          if (utterCancelled.current) return;
          stats.ended += 1;
          onDone?.();
          depsRef.current.requestRearm();
        };

        const markStarted = (voiceName: string, rate: number) => {
          const cur = depsRef.current;
          setHostSilent(false);
          cur.clearSilentRecovery();
          stats.started += 1;
          stats.lastVoice = voiceName;
          stats.lastVolume = cur.settingsRef.current.volume;
          stats.lastRate = rate;
          stats.lastStartedAt = Date.now();
        };

        const speakWithBrowserSynth = () => {
          try {
            const cur = depsRef.current;
            const synth = window.speechSynthesis;
            if (!synth) {
              finishSpeech();
              return;
            }
            if (synth.speaking && !utterance.current) {
              try { synth.cancel(); } catch { /* ignore */ }
            }
            if (utterance.current) {
              utterance.current = null;
              try { synth.cancel(); } catch { /* ignore */ }
              speechQueue.hardFlushOnBargeIn();
            }
            cur.voiceChoice.refresh();
            const voice = options.useDefaultVoice
              ? null
              : cur.voiceChoice.cachedVoiceRef.current ?? pickVoice(synth.getVoices());
            const base = prosodyFor(spoken);
            const rate = Math.min(1.6, Math.max(0.5, base.rate * cur.settingsRef.current.rate));
            const pitch = base.pitch;
            let started = false;

            const utter = speechQueue.enqueue(spoken, {
              role: "CONTENT",
              rate,
              pitch,
              volume: cur.settingsRef.current.volume,
              voice,
              useDefaultVoice: options.useDefaultVoice,
              onStart: () => {
                if (attempt !== attemptSeq.current) return;
                started = true;
                clearStartTimer();
                markStarted(voice?.name ?? "(browser default)", rate);
                depsRef.current.logEvent(`host voice started ${voice?.name ?? "default"}`);
                watchdog.current = setTimeout(() => {
                  watchdog.current = null;
                  if (utterance.current !== utter) return;
                  speechQueue.hardFlushOnBargeIn();
                  finishSpeech();
                }, Math.min(12000, 3000 + spoken.length * 55));
              },
              onDone: () => {
                if (attempt !== attemptSeq.current) return;
                depsRef.current.stampTiming("speechEnd");
                finishSpeech();
              },
              onError: (failed) => {
                if (attempt !== attemptSeq.current) return;
                if (utterance.current !== failed || utterCancelled.current) return;
                stats.errors += 1;
                depsRef.current.setNotice("Host voice could not play — retrying with the system default.");
              },
            });

            if (utter) {
              utterance.current = utter;
              startTimer.current = setTimeout(() => {
                startTimer.current = null;
                if (attempt !== attemptSeq.current || started) return;
                const late = depsRef.current;
                utterance.current = null;
                utterCancelled.current = true;
                speechQueue.hardFlushOnBargeIn();
                late.turn.dispatch({ type: "HOST_END" });
                if (retry < 1) {
                  stats.retries += 1;
                  late.logEvent("host voice did not start; retrying system default");
                  late.setNotice("Host voice did not start — switching to the system default voice.");
                  speak(text, onDone, { retry: 1, useDefaultVoice: true });
                } else {
                  setHostSilent(true);
                  late.setNotice("");
                  late.surfaceRecovery("host-silent");
                  onDone?.();
                  late.requestRearm();
                }
              }, 1800);
            } else {
              finishSpeech();
            }
          } catch {
            finishSpeech();
          }
        };

        // The browser voice is the engine for the Meta provider, for the
        // "system default" retry, and whenever neural audio is not available.
        if (!depsRef.current.providerRef.current.neuralVoice || options.useDefaultVoice || hostTts.unavailable()) {
          speakWithBrowserSynth();
          return;
        }

        // Gemini neural voice. The line is usually already cached by the
        // prefetch; if it is not here within the wait budget the browser
        // voice says it, so the host never sits silent on a slow request.
        const isCurrent = () => attempt === attemptSeq.current && !utterCancelled.current;
        withDeadline(hostTts.get(spoken), NEURAL_VOICE_WAIT_MS)
          .then(async (audio) => {
            if (!isCurrent()) return;
            const neural = depsRef.current.neural;
            neural.stop();
            const playingMs = await neural.play(
              audio,
              () => {
                if (attempt !== attemptSeq.current) return;
                depsRef.current.stampTiming("speechEnd");
                finishSpeech();
              },
              isCurrent,
            );
            if (playingMs === -1 || !isCurrent()) return;
            if (playingMs === null) {
              speakWithBrowserSynth();
              return;
            }
            markStarted("Gemini (Aoede)", depsRef.current.settingsRef.current.rate);
            depsRef.current.logEvent("host voice started Gemini (Aoede)");
            // Web Audio should always report the end; never trust it to.
            watchdog.current = setTimeout(() => {
              watchdog.current = null;
              if (attempt !== attemptSeq.current) return;
              depsRef.current.neural.stop();
              finishSpeech();
            }, playingMs + 1500);
          })
          .catch(() => {
            if (!isCurrent()) return;
            speakWithBrowserSynth();
          });
      };

      afterNextPaint(speakAfterPaint);
      return true;
    };

    const isActive = () =>
      typeof window !== "undefined" &&
      Boolean(window.speechSynthesis?.speaking || speechQueue.isSpeaking() || depsRef.current.turn.get().hostSpeaking);

    return {
      speak,
      cancel,
      isActive,
      stats: () => ({ ...stats }),
      dispose: () => {
        clearWatchdog();
        clearStartTimer();
        utterance.current = null;
      },
    };
  });

  return { ...engine, hostSilent, setHostSilent };
}
