"use client";

import { useEffect, useRef, useState } from "react";
import {
  CopilotKit,
  useCoAgent,
  useCopilotAction,
  useCopilotChatInternal,
  useCopilotReadable,
} from "@copilotkit/react-core";
import { Role, TextMessage } from "@copilotkit/runtime-client-gql";
import dynamic from "next/dynamic";
import JurisdictionTable from "./JurisdictionTable";

// Pixi canvas must never render on the server (Day 4 hero island).
const GalaxyHero = dynamic(() => import("./GalaxyHero"), { ssr: false });
// Day 8 colony board: second Pixi island, same ssr rule.
const ColonyView = dynamic(() => import("./ColonyView"), { ssr: false });
import EquitySlider from "./EquitySlider";
import FilingChecklist from "./FilingChecklist";
import FilingSteps from "./FilingSteps";
import RolloverFactCard from "./RolloverFactCard";
import LawyerSummary from "./LawyerSummary";
import {
  DEMO_CHECKLIST,
  DEMO_COMPANY_NAME,
  DEMO_FOUNDERS,
  DEMO_JURISDICTIONS,
} from "../lib/demo-data";
import { FILING_STEPS_PACK, S85_PACK } from "../lib/knowledge";
import type { SharedState } from "../lib/state";
import TrustStrip from "./TrustStrip";
import { verifyPaintedCards } from "../lib/verifier";
import { resolveHostPrompt, shortFounderNames } from "../lib/host-questions";
import { AGENT_ACTIONS } from "../lib/agent-actions";
import { INITIAL_STATE, withDefaults, resolveFounderIndex, applyEquity, applyChecklistItem, applyAdvanceChecklist, applyJurisdiction, applyRolloverFact, applyFilingSteps, applyLawyerSummary } from "../lib/state-updates";
import { concatFloat32, toPcm16k } from "../lib/pcm";
import { computeSectionScrollTop, firstChangedBeat, shouldAutoScroll, turnResultSignature } from "../lib/scroll";
import { MAX_PCM_BYTES } from "../lib/request-guard";


const BEATS = [
  { id: "jurisdiction", label: "Jurisdiction" },
  { id: "equity", label: "Equity" },
  { id: "checklist", label: "Checklist" },
  { id: "rollover", label: "Rollover" },
  { id: "filingsteps", label: "Filing steps" },
  { id: "summary", label: "Summary" },
] as const;

// Day 8: one-click example commands for judges without a mic. Each chip
// sends its command through the same sendToAgent path as typed/voice
// input — no shortcut state writes, the agent still drives the beats.
const EXAMPLE_COMMANDS = [
  { label: "Pick Mars", command: "Pick Mars as our home base" },
  { label: "Make Orbit 70%", command: "Make Orbit 70%" },
  { label: "s.85 rollover?", command: "What is a section 85 rollover?" },
  { label: "Filing steps & fees", command: "What are the filing steps and fees?" },
  { label: "Prepare lawyer summary", command: "Prepare the lawyer summary" },
] as const;

function Canvas() {
  const { state, setState } = useCoAgent<SharedState>({
    name: "vvb",
    initialState: INITIAL_STATE,
  });
  // Before the provider syncs agent state, `state` is undefined — and it can
  // also arrive as an empty or partial object. Merge over the initial state
  // so every render read has a value; never dereference `state` directly.
  const view = withDefaults(state);
  // Day 5: separate verifier over the painted cards (pure, on state
  // change, outside the voice turn path — it never blocks a turn).
  const verification = verifyPaintedCards(view);
  const rolloverFlag = verification.verdicts.find(
    (v) => v.cardKind === "rollover" && v.status === "flagged",
  );
  const filingFlag = verification.verdicts.find(
    (v) => v.cardKind === "filingSteps" && v.status === "flagged",
  );
  const checklistFlags: Record<string, string> = {};
  for (const v of verification.verdicts) {
    if (v.cardKind === "checklist" && v.status === "flagged") {
      checklistFlags[v.cardId] = `${v.reason}: ${v.detail}`;
    }
  }
  const { appendMessage, isLoading, messages } = useCopilotChatInternal();
  const [recording, setRecording] = useState(false);
  const [typed, setTyped] = useState("");
  const [notice, setNotice] = useState("");
  const audioContextRef = useRef<AudioContext | null>(null);
  const workletNodeRef = useRef<AudioWorkletNode | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const sourceNodeRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const chunksRef = useRef<Float32Array[]>([]);
  const finishingRef = useRef(false);
  const messageIdRef = useRef(0);

  // THE one shared-state update path for equity (beat 2 invariant).
  // Slider drags call this directly; the voice-agent action below calls
  // the same function. Both normalize through setFounderShare(), so
  // neither surface can leave the split inconsistent — it totals 100%.
  function updateEquity(index: number, percent: number, via: string) {
    setState((prev) => applyEquity(withDefaults(prev), index, percent, via));
  }

  // THE one shared-state update path for the checklist (beat 3):
  // clicks and voice-agent actions both go through here.
  function updateChecklistItem(itemId: string, done: boolean) {
    setState((prev) => applyChecklistItem(withDefaults(prev), itemId, done));
  }

  // Grounding for the agent: fictional company/places, current equity
  // and checklist state, and the s.85 pack's fact ids + topics. The
  // agent picks a factId; the card text itself comes from the pack.
  useCopilotReadable({
    description:
      "Fictional demo company, places, equity split, checklist state, and s.85 knowledge-pack fact index for the incorporation demo",
    value: {
      company: DEMO_COMPANY_NAME,
      places: DEMO_JURISDICTIONS.map((row) => row.jurisdiction),
      founders: view.founders,
      checklist: view.checklist.map((item) => ({
        id: item.id,
        label: item.label,
        done: item.done,
      })),
      s85PackId: S85_PACK.packId,
      s85Facts: S85_PACK.facts.map((fact) => ({
        factId: fact.factId,
        topic: fact.topic,
      })),
      filingStepsPackId: FILING_STEPS_PACK.packId,
      filingStepsFacts: FILING_STEPS_PACK.facts.map((fact) => ({
        factId: fact.factId,
        topic: fact.topic,
      })),
      note: "Demo only. Facts come only from tools.",
    },
  });

  // Beat 1 action (unchanged path): only the agent sets jurisdiction
  // state from voice. No client-side keyword parsing, no shortcut.
  useCopilotAction({
    name: AGENT_ACTIONS.showJurisdictionComparison,
    description:
      "Show the fictional jurisdiction comparison table and optionally select one of the fictional places (Mars, Europa, Andromeda Galaxy). Call this when the user asks to compare jurisdictions, choose a place to incorporate, or start incorporating the fictional company.",
    parameters: [
      {
        name: "jurisdiction",
        type: "string",
        description:
          "Name of the fictional place the user picked, if they named one.",
        required: false,
      },
    ],
    handler: async ({ jurisdiction }) => {
      setState((prev) => applyJurisdiction(withDefaults(prev), jurisdiction ?? null));
    },
    render: () => <></>,
  });

  // Beat 2 voice path: "make me 70%" -> same updateEquity() the slider
  // drags use, so 60/40 with a 70% request lands on 70/30, total 100%.
  useCopilotAction({
    name: AGENT_ACTIONS.setFounderEquity,
    description:
      "Set one DEMO founder's equity percent (e.g. the user says 'make me 70%'). The other founder(s) auto-adjust so the split always totals 100%. Founders: DEMO Founder Nova (fictional), DEMO Founder Orbit (fictional).",
    parameters: [
      {
        name: "founder",
        type: "string",
        description: "Founder name, or 'me' for the first founder.",
        required: true,
      },
      {
        name: "percent",
        type: "number",
        description: "Target percent for that founder, 0-100.",
        required: true,
      },
    ],
    handler: async ({ founder, percent }) => {
      const base = withDefaults(state);
      const index = resolveFounderIndex(base.founders, founder ?? "");
      if (index < 0) {
        return `Nothing changed: no founder matched "${founder}". Founders are ${base.founders.map((f) => f.name).join(", ")}. Nothing was edited; please ask again with one of those names.`;
      }
      updateEquity(index, Number(percent), "voice");
      return `Updated ${base.founders[index].name} to ${Number(percent)}%.`;
    },
  });

  // Beat 3 voice paths: check/uncheck one item, or advance the walk.
  useCopilotAction({
    name: AGENT_ACTIONS.setChecklistItem,
    description:
      "Check or uncheck one filing-checklist item by its id (ids are in the readable checklist state). Use when the user answers a checklist step or asks to mark one done/not done.",
    parameters: [
      { name: "itemId", type: "string", description: "Checklist item id.", required: true },
      { name: "done", type: "boolean", description: "True to check, false to uncheck.", required: true },
    ],
    handler: async ({ itemId, done }) => {
      updateChecklistItem(itemId, Boolean(done));
    },
  });

  useCopilotAction({
    name: AGENT_ACTIONS.advanceChecklist,
    description:
      "Mark the first not-yet-done filing-checklist item done and move the walk forward. Use as the user answers each checklist step.",
    parameters: [],
    handler: async () => {
      setState((prev) => applyAdvanceChecklist(withDefaults(prev)));
    },
  });

  // Beat 4: grounded s.85 fact card. The handler looks the fact up in
  // the knowledge pack — the card text is the pack text verbatim and
  // shows pack/fact grounding. An unknown factId renders NO card.
  useCopilotAction({
    name: AGENT_ACTIONS.showRolloverFact,
    description:
      "Show a grounded s.85 rollover fact card. Call with a factId from the readable s85Facts index when the user asks a rollover / section 85 question. Never invent rollover content; only pack facts become cards.",
    parameters: [
      { name: "factId", type: "string", description: "Fact id from the s85Facts index.", required: true },
      { name: "question", type: "string", description: "The user's rollover question.", required: false },
    ],
    handler: async ({ factId, question }) => {
      setState((prev) => applyRolloverFact(withDefaults(prev), factId ?? "", question));
    },
  });

  // Day 3: grounded filing-steps/fees card. The handler looks every
  // fact up in the filing-steps pack — card text is pack text verbatim
  // with pack/fact grounding. Any unknown factId renders NO card.
  useCopilotAction({
    name: AGENT_ACTIONS.showFilingSteps,
    description:
      "Show grounded filing steps and fees facts. Call with factIds from the readable filingStepsFacts index when the user asks about filing steps, process order, or fees. Never invent steps or fees; only pack facts become cards.",
    parameters: [
      {
        name: "factIds",
        type: "string[]",
        description: "Fact ids from the filingStepsFacts index.",
        required: true,
      },
      { name: "question", type: "string", description: "The user's question.", required: false },
    ],
    handler: async ({ factIds, question }) => {
      const ids = Array.isArray(factIds) ? factIds.map(String) : [];
      setState((prev) => applyFilingSteps(withDefaults(prev), ids, question));
    },
  });

  // Day 3: lawyer-summary package display. The Prepare button and this
  // agent action share buildLawyerSummary() over shared state — one
  // package, rendered on the canvas. Prep only; nothing is sent.
  function prepareLawyerPackage() {
    setState((prev) => applyLawyerSummary(withDefaults(prev)));
  }

  useCopilotAction({
    name: AGENT_ACTIONS.prepareLawyerSummary,
    description:
      "Prepare the lawyer-summary package (jurisdiction choice, equity split, checklist state) and display it on the canvas. Use when the user asks to prepare, show, or send-to-lawyer the summary. This only prepares the package for the user to forward; it never sends email.",
    parameters: [],
    handler: async () => {
      prepareLawyerPackage();
    },
  });

  async function sendToAgent(text: string) {
    const trimmed = text.trim();
    if (!trimmed) return;
    setState((prev) => ({ ...withDefaults(prev), transcript: trimmed }));
    messageIdRef.current += 1;
    await appendMessage(
      new TextMessage({
        id: `msg-${messageIdRef.current}`,
        role: Role.User,
        content: trimmed,
      }),
    );
  }

  function cleanupAudio() {
    try {
      workletNodeRef.current?.disconnect();
    } catch {
      // ignore
    }
    try {
      if (workletNodeRef.current) workletNodeRef.current.port.onmessage = null;
    } catch {
      // ignore
    }
    workletNodeRef.current = null;
    try {
      sourceNodeRef.current?.disconnect();
    } catch {
      // ignore
    }
    sourceNodeRef.current = null;
    mediaStreamRef.current?.getTracks().forEach((track) => track.stop());
    mediaStreamRef.current = null;
    const ctx = audioContextRef.current;
    audioContextRef.current = null;
    if (ctx && ctx.state !== "closed") {
      void ctx.close().catch(() => undefined);
    }
  }

  useEffect(() => {
    return () => {
      cleanupAudio();
    };
  }, []);

  async function finishRecording() {
    if (finishingRef.current) return;
    finishingRef.current = true;
    setRecording(false);
    const ctx = audioContextRef.current;
    const inputRate = ctx?.sampleRate ?? 0;
    const chunks = chunksRef.current;
    chunksRef.current = [];
    cleanupAudio();
    try {
      if (!inputRate || inputRate <= 0) {
        setNotice("Transcribe failed: microphone capture failed (no audio context).");
        return;
      }
      const samples = concatFloat32(chunks);
      if (samples.length === 0) {
        setNotice("Transcribe failed: no audio captured.");
        return;
      }
      const pcm = toPcm16k(samples, inputRate);
      const byteLength = pcm.byteLength;
      if (byteLength === 0 || byteLength % 2 !== 0) {
        setNotice("Transcribe failed: invalid PCM audio.");
        return;
      }
      if (byteLength > MAX_PCM_BYTES) {
        setNotice("Transcribe failed: recording too long (60s max).");
        return;
      }
      const buf = new ArrayBuffer(pcm.byteLength);
      new Int16Array(buf).set(pcm);
      const blob = new Blob([buf], { type: "audio/L16" });
      const form = new FormData();
      form.append("audio", blob, "recording.pcm");
      setNotice("Transcribing…");
      try {
        const res = await fetch("/api/transcribe", {
          method: "POST",
          body: form,
        });
        const data = await res.json();
        if (!res.ok) {
          setNotice(`Transcribe failed: ${data.error ?? res.statusText}`);
          return;
        }
        setNotice("");
        await sendToAgent(data.transcript ?? "");
      } catch (error) {
        setNotice(
          `Transcribe failed: ${error instanceof Error ? error.message : "unknown error"}`,
        );
      }
    } finally {
      finishingRef.current = false;
    }
  }

  async function toggleRecording() {
    if (recording) {
      await finishRecording();
      return;
    }
    let stream: MediaStream | null = null;
    let ctx: AudioContext | null = null;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: true,
      });
      mediaStreamRef.current = stream;
      ctx = new AudioContext();
      audioContextRef.current = ctx;
      await ctx.audioWorklet.addModule("/pcm-capture-worklet.js");
      const node = new AudioWorkletNode(ctx, "pcm-capture");
      workletNodeRef.current = node;
      chunksRef.current = [];
      finishingRef.current = false;
      node.port.onmessage = (event: MessageEvent) => {
        const block = event.data as Float32Array;
        if (!block || block.length === 0) return;
        chunksRef.current.push(block);
        const rate = audioContextRef.current?.sampleRate ?? 0;
        if (rate > 0) {
          const total = chunksRef.current.reduce((s, c) => s + c.length, 0);
          const estBytes = Math.round(total / (rate / 16000)) * 2;
          if (estBytes > MAX_PCM_BYTES) {
            void finishRecording();
          }
        }
      };
      const source = ctx.createMediaStreamSource(stream);
      sourceNodeRef.current = source;
      source.connect(node);
      if (ctx.state === "suspended") {
        await ctx.resume();
      }
      setRecording(true);
    } catch (error) {
      cleanupAudio();
      setRecording(false);
      const detail =
        error instanceof Error && error.name !== "NotAllowedError"
          ? `: ${error.message}`
          : "";
      setNotice(
        detail
          ? `Microphone capture failed${detail}. Type a command instead.`
          : "Microphone access was not granted.",
      );
    }
  }

  const hostPrompt = resolveHostPrompt(messages as never, view.currentBeat, shortFounderNames(view.founders), view.selectedJurisdiction);
  // Auto-scroll to the latest turn: once a turn completes with a new result,
  // bring the section it changed into view below the sticky latest-turn
  // header (which keeps the transcript + host reply visible). Fires once
  // per result signature — never on every render, never mid-stream.
  const latestTurnRef = useRef<HTMLDivElement | null>(null);
  const scrolledSignatureRef = useRef<string | null>(null);
  const resultSignature = turnResultSignature(view, hostPrompt.text);
  useEffect(() => {
    if (scrolledSignatureRef.current === null) {
      scrolledSignatureRef.current = resultSignature;
      return;
    }
    if (!shouldAutoScroll(isLoading, scrolledSignatureRef.current, resultSignature)) return;
    const previousSignature = scrolledSignatureRef.current;
    scrolledSignatureRef.current = resultSignature;
    const beat = firstChangedBeat(previousSignature, resultSignature, view.currentBeat);
    const scrollToTarget = () => {
      const el = document.querySelector(`[data-beat="${beat}"]`) as HTMLElement | null;
      if (!el) return;
      const elTop = el.getBoundingClientRect().top + window.scrollY;
      window.scrollTo({ top: computeSectionScrollTop(elTop, el.offsetHeight, window.innerHeight), behavior: "instant" as ScrollBehavior });
    };
    scrollToTarget();
    // One bounded settle pass: Pixi canvases can shift layout just after a
    // turn lands, which would otherwise strand the scroll short of target.
    const settle = setTimeout(() => {
      if (scrolledSignatureRef.current === resultSignature) scrollToTarget();
    }, 900);
    return () => clearTimeout(settle);
  }, [resultSignature, isLoading, view.currentBeat]);

  return (
    <main style={{ maxWidth: "900px", margin: "0 auto", padding: "2rem" }}>
      <h1>Visual Vocal Builder</h1>
      <p>
        <strong>
          Demo data only. This is not legal advice, not a filing, and nothing
          here is submitted to any registry.
        </strong>
      </p>
      <p>
        Fictional demo company: <strong>{DEMO_COMPANY_NAME}</strong> — not a
        real company. All places and figures below are invented.
      </p>

      <div ref={latestTurnRef} data-testid="latest-turn" style={{ position: "sticky", top: "0.5rem", zIndex: 30, background: "#0b1026", borderRadius: "12px" }}>
      <section aria-label="Voice input">
        <button onClick={toggleRecording}>
          {recording ? "Stop recording" : "Speak (mic)"}
        </button>{" "}
        <input
          value={typed}
          onChange={(event) => setTyped(event.target.value)}
          onKeyDown={async (event) => {
            if (event.key === "Enter") {
              await sendToAgent(typed);
              setTyped("");
            }
          }}
          placeholder="Or type a command for the agent"
          style={{ minWidth: "320px" }}
        />{" "}
        <button
          onClick={async () => {
            await sendToAgent(typed);
            setTyped("");
          }}
        >
          Send to agent
        </button>
        <div aria-label="Example commands" style={{ marginTop: "0.75rem", display: "flex", gap: "0.5rem", flexWrap: "wrap", alignItems: "center" }}>
          <span>Try:</span>
          {EXAMPLE_COMMANDS.map((chip) => (
            <button
              key={chip.label}
              data-testid={`example-chip-${chip.label}`}
              onClick={async () => { await sendToAgent(chip.command); }}
            >
              {chip.label}
            </button>
          ))}
        </div>
        {isLoading ? <p>Agent is working…</p> : null}
        {notice ? <p>{notice}</p> : null}
        {view.transcript ? (
          <p>
            Last transcript: <q>{view.transcript}</q>
          </p>
        ) : null}
      </section>

      <section data-testid="host-prompt" aria-label="Host prompt">
        <h2>Host (unverified conversation)</h2>
        <p data-testid="host-prompt-text">{hostPrompt.text}</p>
        <p>Host speech only — not a grounded fact card. Verify facts on the grounded cards below.</p>
      </section>
      </div>

      <TrustStrip result={verification} />

      <nav data-testid="quest-progress" aria-label="Quest progress">
        <strong>Mission progress:</strong>{" "}
        {BEATS.map((beat, i) => (
          <span key={beat.id} data-testid={`quest-beat-${beat.id}`} data-active={view.currentBeat === beat.id}>
            {i > 0 ? " → " : ""}{view.currentBeat === beat.id ? "▶ " : ""}{beat.label}
          </span>
        ))}
      </nav>

      <ColonyView
        selected={view.selectedJurisdiction}
        checklist={view.checklist}
        founders={view.founders}
        lawyerPackage={view.lawyerPackage}
      />

      <div data-beat="jurisdiction" data-beat-active={view.currentBeat === "jurisdiction"}>
      <GalaxyHero
        rows={view.jurisdictions}
        selected={view.selectedJurisdiction}
        onSelect={(jurisdiction) =>
          setState((prev) => ({ ...withDefaults(prev), selectedJurisdiction: jurisdiction }))
        }
      />

      <JurisdictionTable
        rows={view.jurisdictions}
        selected={view.selectedJurisdiction}
        onSelect={(jurisdiction) =>
          setState((prev) => ({ ...withDefaults(prev), selectedJurisdiction: jurisdiction }))
        }
      />
      </div>

      <div data-beat="equity" data-beat-active={view.currentBeat === "equity"}>
      <EquitySlider
        founders={view.founders}
        equityNote={view.equityNote}
        onShareChange={(index, percent) => updateEquity(index, percent, "slider")}
      />
      </div>

      <div data-beat="checklist" data-beat-active={view.currentBeat === "checklist"}>
      <FilingChecklist items={view.checklist} onToggle={updateChecklistItem} flags={checklistFlags} />
      </div>

      <div data-beat="filingsteps" data-beat-active={view.currentBeat === "filingsteps"}>
      <FilingSteps card={view.filingStepsCard} filingStepsNote={view.filingStepsNote} flagReason={filingFlag ? `${filingFlag.reason}: ${filingFlag.detail}` : null} />
      </div>

      <div data-beat="rollover" data-beat-active={view.currentBeat === "rollover"}>
      <RolloverFactCard card={view.rolloverCard} rolloverNote={view.rolloverNote} flagReason={rolloverFlag ? `${rolloverFlag.reason}: ${rolloverFlag.detail}` : null} />
      </div>

      <div data-beat="summary" data-beat-active={view.currentBeat === "summary"}>
      <LawyerSummary
        view={view}
        companyName={DEMO_COMPANY_NAME}
        lawyerPackage={view.lawyerPackage}
        lawyerNote={view.lawyerNote}
        onPrepare={prepareLawyerPackage}
      />
      </div>
    </main>
  );
}

export default function CanvasHost() {
  return (
    <CopilotKit runtimeUrl="/api/copilotkit">
      <Canvas />
    </CopilotKit>
  );
}
