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
import "lenis/dist/lenis.css";
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
import { resolveHostPrompt, shortFounderNames, shouldSpeakFallbackQuestion, type Beat } from "../lib/host-questions";
import { AGENT_ACTIONS } from "../lib/agent-actions";
import { INITIAL_STATE, withDefaults, resolveFounderIndex, applyEquity, applyChecklistItem, applyChecklistItems, applyAdvanceChecklist, applyJurisdiction, applyRolloverFact, applyFilingSteps, applyLawyerSummary, applyFocusJurisdiction, applyStartOver, cheapestByNumber } from "../lib/state-updates";
import { pushHistory, popHistory, statesEqual, type HistoryEntry } from "../lib/history";
import { describeChange, currentStateSummary } from "../lib/describe-change";
import { beatProgress } from "../lib/beat-progress";
import { concatFloat32, toPcm16k } from "../lib/pcm";
import { clearedVoiceErrors, hasRetryAudio, makeTranscribeFailure, type TranscribeFailure } from "../lib/voice-reliability";
import { beatFieldChanged, firstChangedBeat, turnResultSignature } from "../lib/scroll";
import { ReactLenis, useLenis } from "lenis/react";
import type Lenis from "lenis";
import confetti from "canvas-confetti";
import { MAX_PCM_BYTES } from "../lib/request-guard";
import { parseLiveIntent, rmsLevel, nextVoiceActivity, shouldAutoStop, IDLE_ACTIVITY, SILENCE_TO_STOP_MS, INTENT_SILENCE_TO_STOP_MS, type VoiceActivity } from "../lib/live-intent";
import { queueTurn, flushQueuedTurn, QUEUED_TURN_NOTICE } from "../lib/turn-queue";
import { cueForChange, CUES, type CueName } from "../lib/sound-cues";
import { missionFor } from "../lib/mission";
import { spokenHostText } from "../lib/spoken-text";
import { pickVoice, prosodyFor } from "../lib/voice-select";
import { summarizeTimings, type TurnTimings } from "../lib/turn-timing";


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
// input — sendToAgent paints a live preview instantly (same appliers
// the agent uses), then the agent turn confirms or corrects it.
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
  const [sending, setSending] = useState(false);
  const [transcribing, setTranscribing] = useState(false);
  const [lastTranscript, setLastTranscript] = useState("");
  const [ack, setAck] = useState("");
  const [turnError, setTurnError] = useState("");
  const [transcribeFailure, setTranscribeFailure] = useState<TranscribeFailure | null>(null);
  const [hasLastAudio, setHasLastAudio] = useState(false);
  // Live voice: interim transcript + speculative preview, updated while
  // the user is still speaking so the canvas moves before Stop.
  const [liveTranscript, setLiveTranscript] = useState("");
  const [livePreview, setLivePreview] = useState<{ key: string; label: string; status: "live" | "confirming" | "confirmed" } | null>(null);
  const [micLevel, setMicLevel] = useState(0);
  const [recordSeconds, setRecordSeconds] = useState(0);
  const lastAudioRef = useRef<ArrayBuffer | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const workletNodeRef = useRef<AudioWorkletNode | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const sourceNodeRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const chunksRef = useRef<Float32Array[]>([]);
  const finishingRef = useRef(false);
  const messageIdRef = useRef(0);
  const activityRef = useRef<VoiceActivity>(IDLE_ACTIVITY);
  const levelRef = useRef(0);
  const previewKeyRef = useRef<string | null>(null);
  const recordingRef = useRef(false);
  const webSpeechFailedRef = useRef(false);
  const recognitionRef = useRef<{ stop: () => void; onresult: unknown; onerror: unknown; onend: unknown } | null>(null);

  // Shared commit path: every canvas change (voice, slider, click)
  // funnels through here so handlers can report what actually changed
  // and Undo can reverse manual edits too. History lives client-side
  // in a ref; transcript is excluded from snapshots.
  const stateRef = useRef(view);
  useEffect(() => {
    stateRef.current = view;
  }, [view]);
  const historyRef = useRef<HistoryEntry[]>([]);
  const [historySize, setHistorySize] = useState(0);
  // Game layer: sound cues + spoken host + mission celebration.
  const [soundOn, setSoundOn] = useState(true);
  const [voiceOn, setVoiceOn] = useState(true);
  // Continuous conversation (OpenClaw pattern): talk, agent answers
  // out loud, mic re-opens by itself. On by default; a manual Stop
  // ends it. The full control set lives in a pop-out, not the bar.
  const [convoOn, setConvoOn] = useState(true);
  const [convoActive, setConvoActive] = useState(false);
  const convoRef = useRef(false);
  const [dockOpen, setDockOpen] = useState(false);
  // Turn timing: stamped as a turn flows, one summary line per turn.
  const turnTimingRef = useRef<TurnTimings>({});

  function stampTiming(field: keyof TurnTimings, value?: number) {
    if (turnTimingRef.current[field] === undefined) {
      (turnTimingRef.current as Record<string, number>)[field as string] =
        value ?? performance.now();
    }
  }

  function logToolCall() {
    stampTiming("firstToolCall");
  }

  // The conversation loop re-arms the mic only once the host has
  // finished speaking, so it never cancels the reply mid-flight.
  function isSpeechActive(): boolean {
    return typeof window !== "undefined" && Boolean(window.speechSynthesis?.speaking);
  }
  const [celebrated, setCelebrated] = useState("");
  const sfxCtxRef = useRef<AudioContext | null>(null);
  const unlockedRef = useRef(false);
  const lastSpokenRef = useRef("");
  const prevDoneCountRef = useRef(-1);
  // Voice pre-warm: cache the picked system voice, re-pick once when
  // the browser finishes loading voices, preload on first gesture.
  const cachedVoiceRef = useRef<SpeechSynthesisVoice | null>(null);
  const voicesRepickedRef = useRef(false);
  const utterCancelledRef = useRef(false);
  const busyRef = useRef(false);
  const turnErrorRef = useRef(false);
  // Single-slot pending turn: a command sent while the agent is busy is
  // parked here (latest wins) and flushed once when idle — never silently
  // dropped, never double-sent, never sent after the conversation ends.
  const queuedTurnRef = useRef<{ text: string; convoWasActive: boolean } | null>(null);
  // Adaptive endpointing: set once a live intent (not a question) has
  // matched in the current recording, shortening the stop pause.
  const intentMatchedRef = useRef(false);

  function dropQueuedTurnNotice() {
    setNotice((n) => (n === QUEUED_TURN_NOTICE ? "" : n));
  }

  function dropQueuedTurn() {
    queuedTurnRef.current = null;
    dropQueuedTurnNotice();
  }

  function refreshCachedVoice() {
    if (typeof window === "undefined" || !window.speechSynthesis) return;
    const picked = pickVoice(window.speechSynthesis.getVoices());
    if (picked) cachedVoiceRef.current = picked;
  }

  // Synthesised cues only (no assets). Browsers refuse audio before a
  // user gesture, so cues stay silent until the first interaction.
  function playCue(name: CueName) {
    if (!soundOn || !unlockedRef.current || typeof window === "undefined") return;
    try {
      const ctx = sfxCtxRef.current ?? new AudioContext();
      sfxCtxRef.current = ctx;
      if (ctx.state === "suspended") void ctx.resume();
      const recipe = CUES[name];
      const t0 = ctx.currentTime;
      for (const note of recipe.notes) {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = recipe.type;
        osc.frequency.value = note.freq;
        const start = t0 + note.atMs / 1000;
        gain.gain.setValueAtTime(0.0001, start);
        gain.gain.exponentialRampToValueAtTime(0.12, start + 0.015);
        gain.gain.exponentialRampToValueAtTime(0.0001, start + note.durMs / 1000);
        osc.connect(gain).connect(ctx.destination);
        osc.start(start);
        osc.stop(start + note.durMs / 1000 + 0.05);
      }
    } catch {
      // Sound is garnish; a failed cue must never break a turn.
    }
  }

  function cancelSpeech() {
    utterCancelledRef.current = true;
    try {
      window.speechSynthesis?.cancel();
    } catch {
      // ignore
    }
  }

  // On-end re-arm (primary path; the poll below is fallback only). A
  // cancelled utterance never re-arms: cancelSpeech always runs first
  // and marks it, so only natural speech end reaches startRecording.
  function requestRearm() {
    if (!convoRef.current) return;
    if (recordingRef.current) return;
    if (busyRef.current || turnErrorRef.current) return;
    stampTiming("rearm");
    console.info(`[vvb-timing] rearm ${summarizeTimings(turnTimingRef.current)}`);
    void startRecording();
  }

  // Voice-out is the curated system voice only: pick the best English
  // voice actually on this machine (enhanced/natural beats the robotic
  // default) with question/statement prosody. No downloads, no model.
  function speakNative(text: string) {
    if (typeof window === "undefined" || !window.speechSynthesis) return false;
    const spoken = spokenHostText(text);
    if (!spoken) return false;
    try {
      const voice = cachedVoiceRef.current ?? pickVoice(window.speechSynthesis.getVoices());
      const { rate, pitch } = prosodyFor(spoken);
      const utter = new SpeechSynthesisUtterance(spoken);
      if (voice) utter.voice = voice;
      utter.rate = rate;
      utter.pitch = pitch;
      utterCancelledRef.current = false;
      utter.onend = () => {
        stampTiming("speechEnd");
        if (!utterCancelledRef.current) requestRearm();
      };
      window.speechSynthesis.speak(utter);
      return true;
    } catch {
      return false;
    }
  }

  function speakHost(text: string) {
    if (!voiceOn || !unlockedRef.current || typeof window === "undefined" || !window.speechSynthesis) return;
    const spoken = spokenHostText(text);
    if (!spoken || spoken === lastSpokenRef.current) return;
    lastSpokenRef.current = spoken;
    try {
      window.speechSynthesis.cancel();
    } catch {
      // ignore
    }
    speakNative(text);
  }
  function commit(label: string, fn: (s: SharedState) => SharedState): string {
    const before = withDefaults(stateRef.current);
    const after = fn(before);
    if (!statesEqual(before, after)) {
      historyRef.current = pushHistory(historyRef.current, before, label, performance.now());
      setHistorySize(historyRef.current.length);
    }
    stateRef.current = after;
    setState(after);
    stampTiming("firstPaint");
    const cue = cueForChange(before, after);
    if (cue) playCue(cue);
    return describeChange(before, after);
  }
  function undoLast(): string {
    const { stack, entry } = popHistory(historyRef.current);
    const current = withDefaults(stateRef.current);
    if (!entry) return `Nothing to undo. Current state: ${currentStateSummary(current)}.`;
    historyRef.current = stack;
    setHistorySize(stack.length);
    const restored: SharedState = { ...entry.state, transcript: current.transcript };
    const summary = describeChange(current, restored);
    stateRef.current = restored;
    setState(restored);
    playCue("adjust");
    return `Undid: ${entry.label}. ${summary}`;
  }

  // THE one shared-state update path for equity (beat 2 invariant).
  // Slider drags call this directly; the voice-agent action below calls
  // the same function. Both normalize through setFounderShare(), so
  // neither surface can leave the split inconsistent — it totals 100%.
  function updateEquity(index: number, percent: number, via: string) {
    commit("slider", (s) => applyEquity(s, index, percent, via));
  }

  // THE one shared-state update path for the checklist (beat 3):
  // clicks and voice-agent actions both go through here.
  function updateChecklistItem(itemId: string, done: boolean) {
    commit("click", (s) => applyChecklistItem(s, itemId, done));
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
      jurisdictionRows: DEMO_JURISDICTIONS,
      selectedJurisdiction: view.selectedJurisdiction,
      progress: beatProgress(view),
      canUndo: historySize > 0,
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

  // Live preview: a recognisable command in a partial transcript is
  // painted immediately through the SAME appliers the agent actions
  // below use, so the screen moves while the user is still speaking.
  // The agent turn still runs on the final transcript and confirms or
  // corrects the preview — grounded cards are never painted locally.
  function applyLiveIntent(text: string, status: "live" | "confirming") {
    const intent = parseLiveIntent(text);
    if (!intent) return null;
    if (intent.key !== previewKeyRef.current) {
      previewKeyRef.current = intent.key;
      // Previews go through commit() like every other canvas change, so
      // they are undoable and the agent's confirming commit (same
      // result) adds no second history entry.
      if (intent.kind === "jurisdiction") {
        commit("live-preview", (s) => applyJurisdiction(s, intent.jurisdiction));
      } else if (intent.kind === "equity") {
        const base = withDefaults(stateRef.current);
        const index = resolveFounderIndex(base.founders, intent.founder);
        if (index >= 0) commit("live-preview", (s) => applyEquity(s, index, intent.percent, "voice-live"));
      } else if (intent.kind === "checklist-advance") {
        commit("live-preview", (s) => applyAdvanceChecklist(s));
      } else if (intent.kind === "lawyer-summary") {
        prepareLawyerPackage();
      }
      // rollover/filing questions: no local card — the label below is
      // the feedback; the grounded card comes from the agent + pack.
    }
    setLivePreview({ key: intent.key, label: intent.label, status });
    return intent;
  }

  function handleLiveTranscript(text: string) {
    const trimmed = text.trim();
    if (!trimmed) return;
    stampTiming("firstPartial");
    setLiveTranscript(trimmed);
    const intent = applyLiveIntent(trimmed, "live");
    // Adaptive endpointing: a recognised command shortens the stop pause
    // to 600 ms. Questions keep 1100 ms — a slow ask needs its full pause.
    if (intent && intent.kind !== "rollover-question" && intent.kind !== "filing-question") {
      intentMatchedRef.current = true;
    }
  }

  // Beat 1 action: the agent's authoritative jurisdiction write. It
  // lands on the same applyJurisdiction path as the live preview, so
  // confirming a preview changes nothing twice.
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
      logToolCall();
      return commit("jurisdiction", (s) => applyJurisdiction(s, jurisdiction ?? null));
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
      logToolCall();
      const base = withDefaults(stateRef.current);
      const index = resolveFounderIndex(base.founders, founder ?? "");
      if (index < 0) {
        return `Nothing changed: no founder matched "${founder}". Founders are ${base.founders.map((f) => f.name).join(", ")}. Nothing was edited; please ask again with one of those names. Current state: ${currentStateSummary(base)}.`;
      }
      return commit("equity", (s) => applyEquity(s, index, Number(percent), "voice"));
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
      logToolCall();
      return commit("checklist", (s) => applyChecklistItem(s, itemId, Boolean(done)));
    },
  });

  useCopilotAction({
    name: AGENT_ACTIONS.setChecklistItems,
    description:
      "Check or uncheck several filing-checklist items at once by their ids (ids are in the readable checklist state). Use when the user asks to tick off multiple items in one command.",
    parameters: [
      { name: "itemIds", type: "string[]", description: "Checklist item ids.", required: true },
      { name: "done", type: "boolean", description: "True to check, false to uncheck.", required: true },
    ],
    handler: async ({ itemIds, done }) => {
      logToolCall();
      const ids = Array.isArray(itemIds) ? itemIds.map(String) : [];
      return commit("checklist", (s) => applyChecklistItems(s, ids, Boolean(done)));
    },
  });

  useCopilotAction({
    name: AGENT_ACTIONS.undoLastChange,
    description:
      "Reverse the last canvas change (voice, slider, or click). Call when the user says undo that, revert, or go back. Never claim an undo without calling this.",
    parameters: [],
    handler: async () => {
      logToolCall();
      return undoLast();
    },
  });

  useCopilotAction({
    name: AGENT_ACTIONS.startOver,
    description:
      "Reset the canvas only (selection, equity, checklist, cards, lawyer package) and keep the chat history. Call when the user says start over or fresh start. Never claim a reset without calling this.",
    parameters: [],
    handler: async () => {
      logToolCall();
      return commit("start-over", (s) => applyStartOver(s));
    },
  });

  useCopilotAction({
    name: AGENT_ACTIONS.compareJurisdictions,
    description:
      "Answer a comparison question about the three fictional places (Mars, Europa, Andromeda Galaxy) from the DEMO rows and set a DEMO highlight. The highlight never changes the user's selected jurisdiction. DEMO values may be quoted verbatim, labeled DEMO, for these three fictional places only.",
    parameters: [
      { name: "question", type: "string", description: "The user's comparison question.", required: false },
      { name: "focus", type: "string", description: "Fictional place to DEMO-highlight, if one fits; otherwise omit.", required: false },
    ],
    handler: async ({ question, focus }) => {
      logToolCall();
      const cheapest = cheapestByNumber(DEMO_JURISDICTIONS);
      const focusName = focus ?? cheapest.name;
      const result = commit("compare", (s) =>
        applyFocusJurisdiction(s, focusName, question ?? "comparison"),
      );
      const rowsText = DEMO_JURISDICTIONS.map(
        (r) => `${r.jurisdiction} — ${r.filingFee}, ${r.timeline}`,
      ).join("; ");
      return `DEMO jurisdictions: ${rowsText}. DEMO cheapest by number: ${cheapest.name} (${cheapest.fee}). Currencies are fictional and don't convert (sameCurrency: ${cheapest.sameCurrency}), so there's no true cheapest. ${result}`;
    },
  });

  useCopilotAction({
    name: AGENT_ACTIONS.advanceChecklist,
    description:
      "Mark the first not-yet-done filing-checklist item done and move the walk forward. Use as the user answers each checklist step.",
    parameters: [],
    handler: async () => {
      logToolCall();
      return commit("checklist", (s) => applyAdvanceChecklist(s));
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
      logToolCall();
      return commit("rollover", (s) => applyRolloverFact(s, factId ?? "", question));
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
      logToolCall();
      const ids = Array.isArray(factIds) ? factIds.map(String) : [];
      return commit("filingsteps", (s) => applyFilingSteps(s, ids, question));
    },
  });

  // Day 3: lawyer-summary package display. The Prepare button and this
  // agent action share buildLawyerSummary() over shared state — one
  // package, rendered on the canvas. Prep only; nothing is sent.
  function prepareLawyerPackage() {
    commit("summary", (s) => applyLawyerSummary(s));
  }

  useCopilotAction({
    name: AGENT_ACTIONS.prepareLawyerSummary,
    description:
      "Prepare the lawyer-summary package (jurisdiction choice, equity split, checklist state) and display it on the canvas. Use when the user asks to prepare, show, or send-to-lawyer the summary. This only prepares the package for the user to forward; it never sends email.",
    parameters: [],
    handler: async () => {
      logToolCall();
      return commit("summary", (s) => applyLawyerSummary(s));
    },
  });

  // Every new turn starts with no displayed error. Last transcript and
  // host reply are separate state and are deliberately not cleared here.
  function clearTurnErrors() {
    const cleared = clearedVoiceErrors();
    setTurnError(cleared.turnError);
    setTranscribeFailure(cleared.transcribeFailure);
    setNotice(cleared.notice);
  }

  // One selection path for planet clicks, table rows, and button picks.
  // Re-picking the current home base is never silent: it confirms aloud.
  function handleSelectJurisdiction(jurisdiction: string) {
    if (view.selectedJurisdiction && view.selectedJurisdiction.toLowerCase() === jurisdiction.toLowerCase()) {
      setAck(`${jurisdiction} again — confirming ${jurisdiction} as your home base.`);
    } else {
      setAck("");
    }
    clearTurnErrors();
    commit("click", (s) => ({ ...s, selectedJurisdiction: jurisdiction }));
  }

  async function sendToAgent(text: string, fromVoice = false) {
    const trimmed = text.trim();
    if (!trimmed) return;
    // Busy lane: park one turn (latest wins) with a visible notice instead
    // of the old silent drop. The flush effect below sends it once idle.
    if (sending || isLoading) {
      queuedTurnRef.current = queueTurn(queuedTurnRef.current, trimmed, convoRef.current);
      setNotice(QUEUED_TURN_NOTICE);
      return;
    }
    if (turnTimingRef.current.micStart === undefined) {
      turnTimingRef.current = { micStart: performance.now() };
    }
    cancelSpeech();
    setDockOpen(false);
    clearTurnErrors();
    // Immediate acknowledgment (OpenClaw pattern): a one-breath spoken
    // "on it" while the model thinks, so a slow turn never feels like
    // dead air. The host answer replaces it.
    if (fromVoice && voiceOn) {
      const intent = parseLiveIntent(trimmed);
      const ack =
        intent?.kind === "jurisdiction"
          ? `Picking ${intent.jurisdiction}.`
          : intent?.kind === "equity"
            ? "Adjusting the split."
            : intent?.kind === "checklist-advance"
              ? "Building that now."
              : "On it.";
      speakNative(ack);
    }
    // Paint instantly, confirm asynchronously: a typed/spoken command
    // moves the canvas now; the agent turn below is the authority and
    // corrects the preview if it heard something different.
    previewKeyRef.current = null;
    applyLiveIntent(trimmed, "confirming");
    setLiveTranscript(trimmed);
    setLastTranscript(trimmed);
    setState((prev) => ({ ...withDefaults(prev), transcript: trimmed }));
    const sel = view.selectedJurisdiction;
    const mentioned = DEMO_JURISDICTIONS.map((r) => r.jurisdiction).find((name) => trimmed.toLowerCase().includes(name.toLowerCase()));
    if (sel && mentioned && mentioned.toLowerCase() === sel.toLowerCase()) {
      setAck(`${sel} again — confirming ${sel} as your home base.`);
    } else {
      setAck("");
    }
    pendingTurnRef.current = { signature: turnResultSignature(view, hostPrompt.text), text: trimmed, beat: view.currentBeat };
    setSending(true);
    messageIdRef.current += 1;
    try {
      await appendMessage(
        new TextMessage({
          id: `msg-${messageIdRef.current}`,
          role: Role.User,
          content: trimmed,
        }),
      );
    } catch (error) {
      setTurnError(`Agent error: ${error instanceof Error ? error.message : "the agent run failed"}. Nothing was changed by that turn — type the command again.`);
    } finally {
      setSending(false);
    }
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

  async function fetchTranscript(buf: ArrayBuffer): Promise<string> {
    const blob = new Blob([buf], { type: "audio/L16" });
    const form = new FormData();
    form.append("audio", blob, "recording.pcm");
    const res = await fetch("/api/transcribe", { method: "POST", body: form });
    const data = await res.json();
    if (!res.ok) throw new Error(String(data.error ?? res.statusText));
    return String(data.transcript ?? "");
  }

  function stopWebSpeech() {
    const rec = recognitionRef.current;
    recognitionRef.current = null;
    if (!rec) return;
    rec.onresult = null;
    rec.onerror = null;
    rec.onend = null;
    try {
      rec.stop();
    } catch {
      // ignore
    }
  }

  // Instant interim words where the browser offers them (Chrome/Edge
  // only). This is a *preview* recogniser only: the Meta transcript
  // after Stop is still the authority that goes to the agent. Other
  // browsers get no interim words — just the final Meta transcript.
  function startWebSpeech() {
    if (webSpeechFailedRef.current || typeof window === "undefined") return;
    const w = window as unknown as Record<string, unknown>;
    const Ctor = (w.SpeechRecognition ?? w.webkitSpeechRecognition) as
      | (new () => { lang: string; interimResults: boolean; continuous: boolean; start: () => void; stop: () => void; onresult: unknown; onerror: unknown; onend: unknown })
      | undefined;
    if (!Ctor) return;
    try {
      const rec = new Ctor();
      rec.lang = "en-US";
      rec.interimResults = true;
      rec.continuous = true;
      rec.onresult = (event: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => {
        let text = "";
        for (let i = 0; i < event.results.length; i++) text += event.results[i][0]?.transcript ?? "";
        handleLiveTranscript(text);
      };
      rec.onerror = (event: { error?: string }) => {
        if (event.error !== "no-speech" && event.error !== "aborted") webSpeechFailedRef.current = true;
        recognitionRef.current = null;
      };
      rec.onend = () => {
        recognitionRef.current = null;
        // Chrome ends recognition after a pause; re-arm while the mic
        // is still hot so a second sentence is heard too.
        if (recordingRef.current && !webSpeechFailedRef.current) {
          setTimeout(() => {
            if (recordingRef.current) startWebSpeech();
          }, 250);
        }
      };
      recognitionRef.current = rec;
      rec.start();
    } catch {
      webSpeechFailedRef.current = true;
    }
  }

  useEffect(() => {
    return () => {
      cleanupAudio();
      stopWebSpeech();
    };
  }, []);

  // While recording: meter + clock only. Interim words come solely
  // from Web Speech (Chrome/Edge); nothing re-uploads audio mid-turn.
  useEffect(() => {
    if (!recording) return;
    const meter = setInterval(() => {
      setMicLevel(Math.min(1, levelRef.current * 3.5));
    }, 200);
    const clock = setInterval(() => setRecordSeconds((s) => s + 1), 1000);
    return () => {
      clearInterval(meter);
      clearInterval(clock);
    };
  }, [recording]);

  // Same existing transcribe path for a fresh recording and for Retry.
  async function transcribeAndSend(buf: ArrayBuffer) {
    clearTurnErrors();
    setTranscribing(true);
    setNotice("Transcribing…");
    try {
      const transcript = await fetchTranscript(buf);
      stampTiming("finalTranscript");
      setNotice("");
      await sendToAgent(transcript, true);
    } catch (error) {
      setNotice("");
      setTranscribeFailure(
        makeTranscribeFailure(error instanceof Error ? error.message : "unknown error"),
      );
    } finally {
      setTranscribing(false);
    }
  }

  async function retryTranscribe() {
    const buf = lastAudioRef.current;
    if (!hasRetryAudio(buf) || !buf || recording || transcribing || sending || isLoading) return;
    clearTurnErrors();
    await transcribeAndSend(buf);
  }

  async function finishRecording() {
    if (finishingRef.current) return;
    finishingRef.current = true;
    recordingRef.current = false;
    stopWebSpeech();
    setMicLevel(0);
    setRecording(false);
    const ctx = audioContextRef.current;
    const inputRate = ctx?.sampleRate ?? 0;
    const chunks = chunksRef.current;
    chunksRef.current = [];
    cleanupAudio();
    try {
      if (!inputRate || inputRate <= 0) {
        setTranscribeFailure(makeTranscribeFailure("microphone capture failed (no audio context)"));
        return;
      }
      const samples = concatFloat32(chunks);
      if (samples.length === 0) {
        setTranscribeFailure(makeTranscribeFailure("no audio captured"));
        return;
      }
      const pcm = toPcm16k(samples, inputRate);
      const byteLength = pcm.byteLength;
      if (byteLength === 0 || byteLength % 2 !== 0) {
        setTranscribeFailure(makeTranscribeFailure("invalid PCM audio"));
        return;
      }
      if (byteLength > MAX_PCM_BYTES) {
        setTranscribeFailure(makeTranscribeFailure("recording too long (60s max)"));
        return;
      }
      const buf = new ArrayBuffer(pcm.byteLength);
      new Int16Array(buf).set(pcm);
      lastAudioRef.current = buf;
      setHasLastAudio(true);
      await transcribeAndSend(buf);
    } finally {
      finishingRef.current = false;
    }
  }

  async function toggleRecording() {
    if (recording) {
      // A manual stop ends the conversation, not just the turn.
      convoRef.current = false;
      setConvoActive(false);
      dropQueuedTurn();
      await finishRecording();
      return;
    }
    if (convoRef.current && (transcribing || sending || isLoading)) {
      // Ending a conversation while the agent is mid-turn: just stop
      // re-arming the mic; the current turn finishes on its own.
      convoRef.current = false;
      setConvoActive(false);
      dropQueuedTurn();
      return;
    }
    if (convoOn) {
      convoRef.current = true;
      setConvoActive(true);
    }
    setDockOpen(false);
    await startRecording();
  }

  async function startRecording() {
    if (recordingRef.current) return;
    recordingRef.current = true;
    turnTimingRef.current = { micStart: performance.now() };
    // Barge-in: the host stops talking the moment the user speaks.
    cancelSpeech();
    unlockedRef.current = true;
    clearTurnErrors();
    lastAudioRef.current = null;
    setHasLastAudio(false);
    activityRef.current = IDLE_ACTIVITY;
    levelRef.current = 0;
    previewKeyRef.current = null;
    intentMatchedRef.current = false;
    setLiveTranscript("");
    setLivePreview(null);
    setMicLevel(0);
    setRecordSeconds(0);
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
        // Live level + client endpointing: a natural pause after real
        // speech ends the turn hands-free — no Stop click needed.
        const level = rmsLevel(block);
        levelRef.current = level;
        const now = performance.now();
        activityRef.current = nextVoiceActivity(activityRef.current, level, now, rate > 0 ? (block.length / rate) * 1000 : 0);
        if (shouldAutoStop(activityRef.current, now, intentMatchedRef.current ? INTENT_SILENCE_TO_STOP_MS : SILENCE_TO_STOP_MS)) {
          void finishRecording();
          return;
        }
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
      recordingRef.current = true;
      setRecording(true);
      startWebSpeech();
    } catch (error) {
      cleanupAudio();
      recordingRef.current = false;
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
  const progress = beatProgress(view);
  const mission = missionFor(view);
  const doneCount = Object.values(progress.done).filter(Boolean).length;

  // First gesture unlocks audio/speech (browser autoplay policy)
  // and pre-loads the curated system voice. Voices often arrive
  // after first paint, so re-pick once when the list updates.
  useEffect(() => {
    const unlock = () => {
      unlockedRef.current = true;
      refreshCachedVoice();
    };
    const repickOnce = () => {
      if (voicesRepickedRef.current) return;
      voicesRepickedRef.current = true;
      refreshCachedVoice();
    };
    window.addEventListener("pointerdown", unlock);
    window.addEventListener("keydown", unlock);
    const synth = window.speechSynthesis;
    if (synth && typeof synth.addEventListener === "function") synth.addEventListener("voiceschanged", repickOnce);
    return () => {
      window.removeEventListener("pointerdown", unlock);
      window.removeEventListener("keydown", unlock);
      if (synth && typeof synth.removeEventListener === "function") synth.removeEventListener("voiceschanged", repickOnce);
    };
  }, []);

  // Mirrors so the utterance onend handler re-arms with fresh state.
  useEffect(() => {
    busyRef.current = transcribing || sending || isLoading;
  }, [transcribing, sending, isLoading]);
  useEffect(() => {
    turnErrorRef.current = Boolean(turnError || transcribeFailure);
  }, [turnError, transcribeFailure]);

  // The agent talks back: speak its latest line once a turn completes.
  useEffect(() => {
    if (!isLoading && hostPrompt.source === "agent") speakHost(hostPrompt.text);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLoading, hostPrompt.text, hostPrompt.source, voiceOn]);

  // Queued-turn flush: a turn parked while busy goes out exactly once,
  // the moment the lane is idle — unless the user ended the conversation
  // meanwhile, in which case it is dropped. The slot clears synchronously
  // before the async send, so the turn can never double-send.
  useEffect(() => {
    if (sending || isLoading) return;
    if (!queuedTurnRef.current) return;
    const { send, slot } = flushQueuedTurn(queuedTurnRef.current, false, convoRef.current);
    queuedTurnRef.current = slot;
    dropQueuedTurnNotice();
    if (send) void sendToAgent(send);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sending, isLoading]);

  // Conversation loop: when the agent has finished speaking, re-open
  // the mic automatically so the talk never "just ends". Any error
  // pauses the loop instead of retrying into a wall.
  useEffect(() => {
    if (!convoActive || recording || transcribing || sending || isLoading) return;
    if (turnError || transcribeFailure) {
      const t = setTimeout(() => {
        convoRef.current = false;
        setConvoActive(false);
        queuedTurnRef.current = null;
        setNotice("Conversation paused after an error — press Speak (mic) to resume.");
      }, 0);
      return () => clearTimeout(t);
    }
    let quietPolls = 0;
    let waitedMs = 0;
    const timer = setInterval(() => {
      waitedMs += 400;
      // Wait until the host has finished speaking so re-arming never
      // cancels the reply mid-flight.
      quietPolls = isSpeechActive() ? 0 : quietPolls + 1;
      // Two quiet polls (~0.8s of silence after speech) and we listen
      // again. If nothing was spoken at all, the same rule re-arms.
      if (quietPolls >= 2) {
        clearInterval(timer);
        if (convoRef.current) void startRecording();
      }
      if (waitedMs > 45000) clearInterval(timer);
    }, 400);
    return () => clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [convoActive, recording, transcribing, sending, isLoading, turnError, transcribeFailure]);

  // Errors get a dull buzz, never silence.
  useEffect(() => {
    if (turnError || transcribeFailure) playCue("error");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [turnError, transcribeFailure]);

  // Beat completion celebrates on the mission banner, with a
  // zero-gravity stardust burst over the page (skipped entirely for
  // reduced-motion users).
  useEffect(() => {
    if (prevDoneCountRef.current >= 0 && doneCount > prevDoneCountRef.current) {
      setCelebrated(mission.title);
      if (!window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
        const launched = Boolean(view.lawyerPackage);
        void confetti({
          particleCount: launched ? 120 : 40,
          spread: launched ? 100 : 65,
          startVelocity: 32,
          gravity: 0,
          scalar: 1.05,
          ticks: 220,
          shapes: ["star", "circle"],
          colors: ["#ffd166", "#7aa2ff", "#e6eaff"],
          origin: { y: 0.35 },
        });
      }
      const t = setTimeout(() => setCelebrated(""), 2200);
      prevDoneCountRef.current = doneCount;
      return () => clearTimeout(t);
    }
    prevDoneCountRef.current = doneCount;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doneCount]);
  const [elapsed, setElapsed] = useState(0);
  const busySinceRef = useRef<number | null>(null);
  const turnPhase = recording ? "recording" : transcribing ? "transcribing" : sending ? "sending" : isLoading ? "agent-busy" : "idle";
  const micLabel = turnPhase === "recording" ? (convoActive ? "End conversation" : "Stop recording") : convoActive ? "End conversation" : turnPhase === "transcribing" ? "Transcribing…" : turnPhase === "sending" ? "Sending…" : turnPhase === "agent-busy" ? "Agent working…" : "Speak (mic)";
  const busy = turnPhase === "sending" || turnPhase === "agent-busy";
  useEffect(() => {
    if (!busy) {
      busySinceRef.current = null;
      return;
    }
    if (busySinceRef.current === null) busySinceRef.current = Date.now();
    const id = setInterval(() => {
      if (busySinceRef.current !== null) {
        setElapsed(Math.floor((Date.now() - busySinceRef.current) / 1000));
      }
    }, 500);
    return () => clearInterval(id);
  }, [busy]);
  const flowStatus = recording
    ? liveTranscript
      ? "Listening — canvas is updating as you speak. Pause for a second and it sends itself."
      : "Listening — say a command like “Pick Mars”. The canvas updates as you speak."
    : transcribing
      ? "Heard you — transcribing with Muse Voice…"
      : busy
        ? "Agent confirming — your live preview is already on the canvas."
        : livePreview?.status === "confirmed"
          ? "Done — painted and confirmed."
          : "Ready — press Speak and just talk; no need to time a Stop click.";
  const shownTranscript = lastTranscript || view.transcript;
  // Auto-scroll to the latest turn: once a turn completes with a new result,
  // bring the section it changed into view below the sticky latest-turn
  // header (which keeps the transcript + host reply visible). Fires once
  // per result signature — never on every render, never mid-stream.
  const latestTurnRef = useRef<HTMLDivElement | null>(null);
  const scrolledSignatureRef = useRef<string | null>(null);
  const pendingTurnRef = useRef<{ signature: string; text: string; beat: Beat } | null>(null);
  const wasLoadingRef = useRef(false);
  const resultSignature = turnResultSignature(view, hostPrompt.text);
  // No silent turn: a completed turn that changed nothing (and is not a
  // re-pick, which already acknowledged) surfaces a visible error line.
  useEffect(() => {
    if (wasLoadingRef.current && !isLoading && pendingTurnRef.current) {
      const pending = pendingTurnRef.current;
      pendingTurnRef.current = null;
      // A live preview already painted this exact intent through the
      // same appliers, so an agent turn that "changes nothing" has in
      // fact confirmed the preview — never report it as a dead turn.
      const previewConfirmed = Boolean(previewKeyRef.current) && parseLiveIntent(pending.text)?.key === previewKeyRef.current;
      if (previewConfirmed) {
        setLivePreview((p) => (p ? { ...p, status: "confirmed" } : p));
      } else if (pending.signature === resultSignature) {
        const sel = view.selectedJurisdiction;
        const mentioned = DEMO_JURISDICTIONS.map((r) => r.jurisdiction).find((n) => pending.text.toLowerCase().includes(n.toLowerCase()));
        if (!(sel && mentioned && mentioned.toLowerCase() === sel.toLowerCase())) {
          setTurnError("Agent finished without changing anything — the turn may have hit a locked thread or an agent error. Nothing was changed; type the command again.");
        }
      } else {
        setLivePreview((p) => (p ? { ...p, status: "confirmed" } : p));
      }
      // Tool-only turn that advanced the beat (no new assistant text):
      // speak the fallback mission question once. speakHost's lastSpoken
      // guard keeps it to one utterance; a non-advanced beat stays silent.
      if (shouldSpeakFallbackQuestion(hostPrompt.source, pending.beat, view.currentBeat)) {
        speakHost(hostPrompt.text);
      }
      // One timing line per completed turn.
      turnTimingRef.current.done = performance.now();
      turnTimingRef.current.hostChars = hostPrompt.text.length;
      console.info(`[vvb-timing] turn ${summarizeTimings(turnTimingRef.current)}`);
    }
    wasLoadingRef.current = isLoading;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLoading, resultSignature]);
  // Smooth guided flow: the moment a beat-owned field changes — a live
  // preview mid-speech counts — glide the viewport to that section with
  // Lenis. Host-only streaming text never moves the camera, and
  // reduced-motion users get an immediate jump instead of a glide.
  const lenisRef = useRef<Lenis | null>(null);
  useLenis((lenis) => {
    lenisRef.current = lenis;
  });
  useEffect(() => {
    if (scrolledSignatureRef.current === null) {
      scrolledSignatureRef.current = resultSignature;
      return;
    }
    const previousSignature = scrolledSignatureRef.current;
    if (previousSignature === resultSignature) return;
    scrolledSignatureRef.current = resultSignature;
    if (!beatFieldChanged(previousSignature, resultSignature)) return;
    const beat = firstChangedBeat(previousSignature, resultSignature, view.currentBeat);
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const scrollToTarget = () => {
      const el = document.querySelector(`[data-beat="${beat}"]`) as HTMLElement | null;
      if (!el) return;
      if (lenisRef.current) {
        // Land the section just below the (variably tall) sticky dock.
        const dockH = latestTurnRef.current?.offsetHeight ?? 90;
        lenisRef.current.scrollTo(el, { offset: -(dockH + 16), duration: reduced ? 0 : 1.35, immediate: reduced });
      } else {
        el.scrollIntoView({ behavior: reduced ? "auto" : "smooth", block: "start" });
      }
    };
    scrollToTarget();
    // One bounded settle pass: Pixi canvases can shift layout just after
    // a turn lands, which would otherwise strand the scroll short.
    const settle = setTimeout(() => {
      if (scrolledSignatureRef.current === resultSignature) scrollToTarget();
    }, 900);
    return () => clearTimeout(settle);
  }, [resultSignature, view.currentBeat]);

  return (
    <main style={{ maxWidth: "900px", margin: "0 auto", padding: "1rem 2rem 2rem" }}>
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

      <div ref={latestTurnRef} data-testid="latest-turn" style={{ position: "sticky", top: "0.5rem", zIndex: 30, background: "#0b1026", borderRadius: "12px", boxShadow: "0 8px 24px rgba(0,0,0,0.45)" }}>
      <section aria-label="Voice input" data-testid="voice-input" data-phase={turnPhase} style={{ margin: 0, padding: "0.45rem 0.7rem", position: "relative" }}>
        <div style={{ display: "flex", gap: "0.5rem", alignItems: "center", flexWrap: "wrap" }}>
        <button onClick={toggleRecording} disabled={!recording && !convoActive && (transcribing || sending || isLoading)} data-testid="mic-button">
          {micLabel}
        </button>{" "}
        <span data-testid="convo-status" role="status">{convoActive ? (recording ? "Conversation live — listening" : busy ? "Conversation live — agent is answering" : "Conversation live") : "Conversation off — press Speak to start"}</span>
        <span data-testid="turn-phase" role="status">{turnPhase === "recording" ? "Recording…" : turnPhase === "transcribing" ? "Transcribing…" : turnPhase === "sending" ? "Sending…" : turnPhase === "agent-busy" ? `Agent working… ${elapsed}s` : "Ready"}</span>
        <button type="button" data-testid="dock-expand" aria-expanded={dockOpen} onClick={() => setDockOpen((v) => !v)}>
          {dockOpen ? "Close controls" : "Controls"}
        </button>
        </div>
        {dockOpen ? (
        <div data-testid="dock-popout" style={{ position: "absolute", top: "calc(100% + 6px)", left: 0, right: 0, background: "#0b1026", border: "1px solid #2c376e", borderRadius: "12px", padding: "0.8rem", boxShadow: "0 18px 40px rgba(0,0,0,0.6)", zIndex: 40 }}>
        <input
          value={typed}
          disabled={recording || transcribing || sending || isLoading}
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
          disabled={recording || transcribing || sending || isLoading || !typed.trim()}
          onClick={async () => {
            await sendToAgent(typed);
            setTyped("");
          }}
        >
          {busy ? "Agent working…" : "Send to agent"}
        </button>
        <button
          type="button"
          data-testid="undo-button"
          disabled={historySize === 0}
          onClick={() => { undoLast(); }}
        >
          Undo
        </button>{" "}
        <span><button
          type="button"
          data-testid="restart-conversation"
          onClick={() => window.location.reload()}
        >
          Restart conversation
        </button>{" "}
        <button
          type="button"
          data-testid="sound-toggle"
          aria-pressed={soundOn}
          onClick={() => setSoundOn((v) => !v)}
        >
          {soundOn ? "Sound: on" : "Sound: off"}
        </button>{" "}
        <button
          type="button"
          data-testid="voice-toggle"
          aria-pressed={voiceOn}
          onClick={() => {
            if (voiceOn) cancelSpeech();
            setVoiceOn((v) => !v);
          }}
        >
          {voiceOn ? "Agent voice: on" : "Agent voice: off"}
        </button>{" "}
        <button
          type="button"
          data-testid="convo-toggle"
          aria-pressed={convoOn}
          onClick={() => {
            const next = !convoOn;
            setConvoOn(next);
            if (!next) {
              convoRef.current = false;
              setConvoActive(false);
              dropQueuedTurn();
            }
          }}
        >
          {convoOn ? "Conversation: auto-listen on" : "Conversation: auto-listen off"}
        </button>{" "}
        <span>Voice: system (curated)</span></span>
        <p data-testid="recording-hint">Say one short command — it paints live as you speak, and sends itself when you pause. Stop recording still works if you prefer it.</p>
        <p data-testid="flow-status" role="status">{flowStatus}</p>
        {recording || liveTranscript || livePreview ? (
          <div data-testid="live-voice-panel" style={{ marginTop: "0.3rem" }}>
            {recording ? (
              <div data-testid="mic-meter" aria-label={`Microphone level, recording ${recordSeconds} seconds`}>
                <div style={{ display: "flex", gap: "3px", alignItems: "flex-end", height: "22px" }} aria-hidden="true">
                  {[0.15, 0.35, 0.55, 0.75, 0.95].map((bar) => (
                    <span key={bar} style={{ width: "10px", height: `${6 + bar * 16}px`, borderRadius: "2px", background: micLevel >= bar ? "#ffd166" : "#2c376e", transition: "background 120ms" }} />
                  ))}
                  <span style={{ marginLeft: "0.5rem", fontSize: "0.85rem" }}>● Recording {recordSeconds}s{micLevel > 0.05 ? " — hearing you" : " — listening…"}</span>
                </div>
              </div>
            ) : null}
            {liveTranscript ? (
              <p data-testid="live-transcript" style={{ margin: "0.4rem 0 0" }}>Hearing: <q>{liveTranscript}</q></p>
            ) : recording ? (
              <p data-testid="live-transcript" style={{ margin: "0.4rem 0 0" }}>Listening… start with “Pick Mars”.</p>
            ) : null}
            {livePreview ? (
              <p data-testid="live-preview" role="status" style={{ margin: "0.4rem 0 0", display: "inline-block", border: "1px solid #ffd166", borderRadius: "999px", padding: "0.2rem 0.7rem" }}>
                {livePreview.status === "confirmed" ? `Confirmed: ${livePreview.label}` : `heard: “${liveTranscript || livePreview.label}”…${livePreview.status === "confirming" ? " confirming with the agent…" : " (provisional)"}`}
              </p>
            ) : null}
          </div>
        ) : null}
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
        </div>) : null}
        {busy && !recording ? <p data-testid="agent-busy" role="status">Agent working…</p> : null}
        {turnError ? <p data-testid="turn-error" role="alert">{turnError}</p> : null}
        {transcribeFailure ? (
          <div data-testid="transcribe-failure">
            <p role="alert">
              {transcribeFailure.plain}{" "}
              <span data-testid="transcribe-failure-detail">Transcribe failed: {transcribeFailure.detail}</span>
            </p>
            {hasLastAudio ? (
              <button
                type="button"
                data-testid="retry-transcribe"
                disabled={recording || transcribing || sending || isLoading}
                onClick={retryTranscribe}
              >
                Retry
              </button>
            ) : (
              <p data-testid="typed-fallback-hint">Type the command below to send it without voice.</p>
            )}
          </div>
        ) : null}
        {notice ? <p>{notice}</p> : null}
        {shownTranscript && dockOpen ? (
          <p data-testid="last-transcript">
            Last transcript: <q>{shownTranscript}</q>
          </p>
        ) : null}
      </section>
      </div>

      <section data-testid="host-prompt" aria-label="Host prompt">
        <h2>Host (unverified conversation)</h2>
        <p data-testid="host-prompt-text">{hostPrompt.text}</p>
        {ack ? <p data-testid="host-ack" role="status">{ack}</p> : null}
        <p>Host speech only — not a grounded fact card. Verify facts on the grounded cards below.</p>
      </section>

      <section data-testid="mission-banner" data-beat={mission.beat} data-celebrated={celebrated ? "true" : "false"} aria-label="Current mission" style={celebrated ? { border: "2px solid #ffd166", boxShadow: "0 0 0 3px #ffd16655" } : undefined}>
        <div style={{ display: "flex", gap: "0.6rem", alignItems: "center", flexWrap: "wrap" }}>
          <h2 style={{ margin: 0 }}>Mission {mission.step} of {mission.total}: {mission.title}</h2>
          <span style={{ border: "1px solid currentColor", borderRadius: "999px", padding: "0.1rem 0.6rem", fontSize: "0.8rem" }}>{doneCount} of 6 missions done</span>
        </div>
        <div aria-hidden="true" style={{ height: "8px", background: "#2c376e", borderRadius: "999px", marginTop: "0.5rem", overflow: "hidden" }}>
          <div style={{ width: `${Math.round((doneCount / 6) * 100)}%`, height: "100%", background: "#ffd166", transition: "width 400ms" }} />
        </div>
        <p data-testid="mission-prompt">{mission.prompt}</p>
        {celebrated ? <p data-testid="mission-celebrated" role="status">Mission complete: {celebrated} — next mission unlocked.</p> : null}
        <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
          {mission.chips.map((chip) => (
            <button
              key={chip.label}
              type="button"
              data-testid={`mission-chip-${chip.label}`}
              disabled={recording || transcribing || sending || isLoading}
              onClick={async () => { await sendToAgent(chip.command); }}
            >
              {chip.label}
            </button>
          ))}
        </div>
      </section>

      <div data-beat="jurisdiction" data-beat-active={view.currentBeat === "jurisdiction"}>
      <GalaxyHero
        rows={view.jurisdictions}
        selected={view.selectedJurisdiction}
        onSelect={handleSelectJurisdiction}
      />

      <JurisdictionTable
        rows={view.jurisdictions}
        selected={view.selectedJurisdiction}
        focus={view.focusJurisdiction}
        focusReason={view.focusReason}
        onSelect={handleSelectJurisdiction}
      />
      </div>

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

      <TrustStrip result={verification} />

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
      <ReactLenis root options={{ lerp: 0.09, duration: 1.2, smoothWheel: true }}>
        <Canvas />
      </ReactLenis>
    </CopilotKit>
  );
}
