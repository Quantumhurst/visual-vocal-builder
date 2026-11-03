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
import HostVoicePicker from "./HostVoicePicker";
import BuildQueuePanel from "./BuildQueuePanel";
import {
  DEMO_COMPANY_NAME,
  DEMO_JURISDICTIONS,
} from "../lib/demo-data";
import { FILING_STEPS_PACK, S85_PACK } from "../lib/knowledge";
import type { SharedState } from "../lib/state";
import TrustStrip from "./TrustStrip";
import { verifyPaintedCards } from "../lib/verifier";
import { getHostQuestion, resolveHostPrompt, shortFounderNames, shouldSpeakFallbackQuestion, type Beat } from "../lib/host-questions";
import { checklistHostLine, equityConfirmationLine, nextObjectiveHostLine } from "../lib/build-host";
import { isChangeAnswer, isConfirmationAnswer } from "../lib/confirmation";
import { FILING_GUARD_REPLY, isFilingGuardQuestion } from "../lib/filing-guard";
import { FIRST_SPEAK_GREETING, hasFirstSpeakGreeting, markFirstSpeakGreeting } from "../lib/first-speak";
import { AGENT_ACTIONS } from "../lib/agent-actions";
import { INITIAL_STATE, withDefaults, resolveFounderIndex, applyEquity, applyChecklistItem, applyChecklistItems, applyAdvanceChecklist, applyJurisdiction, applyRolloverFact, applyFilingSteps, applyLawyerSummary, applyFocusJurisdiction, applyStartOver, cheapestByNumber, applyOwnerCount, applyChecklistCount } from "../lib/state-updates";
import { pushHistory, popHistory, statesEqual, type HistoryEntry } from "../lib/history";
import { describeChange, currentStateSummary } from "../lib/describe-change";
import { REQUIRED_BEATS, beatProgress } from "../lib/beat-progress";
import { concatFloat32, toPcm16k } from "../lib/pcm";
import {
  clearedVoiceErrors,
  hasRetryAudio,
  makeTranscribeFailure,
  type TranscribeFailure,
  ASR_TIMEOUT_MS,
  AGENT_WATCHDOG_MS,
  isEmptyTranscript,
  emptyTranscriptReply,
  noSpeechReply,
  shouldTriggerNoSpeech,
  shouldCapUtterance,
} from "../lib/voice-reliability";
import { loadPcmWorklet, micFailureNotice } from "../lib/mic";
import { checklistNoopReply, isNothingDoneAnswer, isCompanyNameQuestion, companyNameReply, isNameApproval, isNameCancel } from "../lib/checklist-answers";
import { turnResultSignature } from "../lib/scroll";
import confetti from "canvas-confetti";
import { MAX_PCM_BYTES } from "../lib/request-guard";
import { parseLiveIntent, rmsLevel, nextVoiceActivity, shouldAutoStop, IDLE_ACTIVITY, SILENCE_TO_STOP_MS, INTENT_SILENCE_TO_STOP_MS, MIN_SPEECH_MS, type LiveIntent, type VoiceActivity } from "../lib/live-intent";
import { queueTurn, flushQueuedTurn, QUEUED_TURN_NOTICE } from "../lib/turn-queue";
import { cueForChange, CUES, type CueName } from "../lib/sound-cues";
import { missionFor } from "../lib/mission";
import { colonyPalette, colonyProgress } from "../lib/colony";
import { MODULES, flightPlan, flightStatusLabel, formatClock, moduleFor, shipLabel } from "../lib/game-ui";
import { spokenHostText } from "../lib/spoken-text";
import { HOST_VOICE_STORAGE_KEY, defaultHostVoice, isSelectableVoice, pickVoice, prosodyFor, resolveVoiceSelection } from "../lib/voice-select";
import { summarizeTimings, type TurnTimings } from "../lib/turn-timing";




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

// The host voice is the browser/OS system voice. The picker stores a
// voiceURI (not an index) so it survives OS updates; a stale URI falls
// back to the curated automatic pick. The storage key lives in
// lib/voice-select.ts so the picker and the speech path agree.

// The canvas is the interface: tool calls do not need a second chat card.
// Registering an empty renderer keeps CopilotKit from warning about each
// tool call while leaving the visible cockpit untouched.
const renderNothing = () => <></>;

// Clear, deterministic commands are handled locally. They still use the
// exact same state appliers as the agent; skipping the model only removes
// the 3–19 s think time, not any grounding or invariant work.
const FAST_INTENT_KINDS: ReadonlySet<LiveIntent["kind"]> = new Set([
  "jurisdiction",
  "equity",
  "checklist-advance",
  "owner-count",
  "cheapest",
  "undo",
  "start-over",
  "lawyer-summary",
]);

const activeVoiceTurnRef = { current: false };

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
  const { appendMessage, isLoading, messages, stopGeneration } = useCopilotChatInternal();
  const [recording, setRecording] = useState(false);
  const [typed, setTyped] = useState("");
  const [notice, setNotice] = useState("");
  const [sending, setSending] = useState(false);
  const [transcribing, setTranscribing] = useState(false);
  const [lastTranscript, setLastTranscript] = useState("");
  const [ack, setAck] = useState("");
  // A locally spoken host line for the deterministic fast lane. It also
  // becomes the visible host prompt, so the text and the voice agree.
  const [localHost, setLocalHost] = useState("");
  const [namePromptActive, setNamePromptActive] = useState(false);
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
  const committedKeyRef = useRef<string | null>(null);
  const recordingRef = useRef(false);
  const webSpeechFailedRef = useRef(false);
  const recognitionRef = useRef<{ stop: () => void; onresult: unknown; onerror: unknown; onend: unknown } | null>(null);
  const liveTranscriptRef = useRef("");
  const confirmationTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const peakLevelRef = useRef(0);
  const noSpeechAttemptsRef = useRef(0);
  const asrSocketRef = useRef<WebSocket | null>(null);
  const streamingReadyRef = useRef(false);
  const activeTurnIdRef = useRef(0);
  const isTurnListeningRef = useRef(false);

  function clearConfirmationTimer() {
    if (confirmationTimerRef.current !== null) {
      clearTimeout(confirmationTimerRef.current);
      confirmationTimerRef.current = null;
    }
  }

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
  // True while the host voice is actually speaking. The mic stays closed
  // during this window, and the deck says so instead of claiming LIVE.
  const [hostSpeaking, setHostSpeaking] = useState(false);
  // Continuous conversation (OpenClaw pattern): talk, agent answers
  // out loud, mic re-opens by itself. On by default; a manual Stop
  // ends it. The full control set lives in a pop-out, not the bar.
  const [convoOn, setConvoOn] = useState(true);
  const [convoActive, setConvoActive] = useState(false);
  const convoRef = useRef(false);
  const [dockOpen, setDockOpen] = useState(false);
  // Game shell: which system panel is open, which viewport is up, and a
  // light mission clock. These are presentation state only — every fact
  // still comes from the same shared state and appliers.
  const [activeModule, setActiveModule] = useState<SharedState["currentBeat"]>("jurisdiction");
  const [stageTab, setStageTab] = useState<"galaxy" | "colony">("galaxy");
  // Equity/owner changes pause here: the split is already applied through
  // the one invariant path, but the cockpit does not advance to BUILD
  // until the user confirms the visible split.
  const [equityConfirm, setEquityConfirm] = useState(false);
  // Optional archive (s.85 / fees) is collapsed by default; opening an
  // optional system or clicking one of its tabs reveals it.
  const [archiveOpen, setArchiveOpen] = useState(false);
  const [missionClock, setMissionClock] = useState(0);
  // A short cinematic for a new home base: the state change is immediate,
  // but a rocket/warp layer covers the viewport switch for ~2.6s.
  const [travel, setTravel] = useState<{ planet: string; id: number } | null>(null);
  const travelFrameRef = useRef<number | null>(null);
  const travelTokenRef = useRef(0);
  // Turn timing: stamped as a turn flows, one summary line per turn.
  const turnTimingRef = useRef<TurnTimings>({});

  function stampTiming(field: keyof TurnTimings, value?: number) {
    if (turnTimingRef.current[field] === undefined) {
      (turnTimingRef.current as Record<string, number>)[field as string] =
        value ?? performance.now();
      if (typeof window !== "undefined") {
        (window as unknown as { __vvbLastTiming?: TurnTimings }).__vvbLastTiming = { ...turnTimingRef.current };
      }
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
  // The first TALK press is a greeting, not a recording: it announces the
  // home-base question once per session, then opens the mic. The ref is
  // the synchronous guard; sessionStorage is the cross-reload marker.
  const firstSpeakHandledRef = useRef(false);
  const lastSpokenRef = useRef("");
  const prevDoneCountRef = useRef(-1);
  // Voice pre-warm: cache the picked system voice, re-pick once when
  // the browser finishes loading voices, preload on first gesture.
  const cachedVoiceRef = useRef<SpeechSynthesisVoice | null>(null);
  const chosenVoiceUriRef = useRef<string | null>(null);
  const utterCancelledRef = useRef(false);
  // Keep a reference to the live utterance: Chrome can drop an unreferenced
  // utterance before firing onend, leaving speechSynthesis.speaking stuck
  // true and the mic closed forever. The watchdog is the last resort.
  const utteranceRef = useRef<SpeechSynthesisUtterance | null>(null);
  const speechWatchdogRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const rearmTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
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

  function readStoredVoiceUri(): string | null {
    try {
      const stored = window.localStorage.getItem(HOST_VOICE_STORAGE_KEY);
      const voices = window.speechSynthesis?.getVoices() ?? [];
      // No saved choice: land on Karen when the machine exposes her.
      if (!stored) {
        return defaultHostVoice(voices)?.voiceURI ?? null;
      }
      if (stored === "auto") return null;
      if (voices.length === 0) return stored;
      const chosen = resolveVoiceSelection(voices, stored);
      if (chosen?.voiceURI === stored) return stored;
      // A stale or unreliable saved voice is removed so the next read
      // applies the Karen default rather than leaving the host silent.
      window.localStorage.removeItem(HOST_VOICE_STORAGE_KEY);
      return defaultHostVoice(voices)?.voiceURI ?? null;
    } catch {
      return null;
    }
  }

  function refreshCachedVoice() {
    if (typeof window === "undefined" || !window.speechSynthesis) return;
    const voices = window.speechSynthesis.getVoices();
    let selected = chosenVoiceUriRef.current;
    // Sanitize a stale ref only after the browser has published voices;
    // before that, an empty list would look like every voice vanished.
    if (selected && voices.length > 0 && !voices.some((voice) => voice.voiceURI === selected && isSelectableVoice(voice))) {
      chosenVoiceUriRef.current = null;
      try {
        window.localStorage.removeItem(HOST_VOICE_STORAGE_KEY);
      } catch {
        // Storage is optional.
      }
      selected = null;
    }
    const picked = resolveVoiceSelection(voices, selected ?? readStoredVoiceUri());
    if (picked) cachedVoiceRef.current = picked;
  }

  function selectHostVoice(uri: string) {
    if (typeof window === "undefined" || !window.speechSynthesis) return;
    const list = window.speechSynthesis.getVoices();
    const chosen = uri === "auto" ? pickVoice(list) : resolveVoiceSelection(list, uri);
    const nextUri = uri === "auto" ? "auto" : chosen?.voiceURI ?? "auto";
    chosenVoiceUriRef.current = nextUri === "auto" ? null : nextUri;
    cachedVoiceRef.current = chosen;
    try {
      window.localStorage.setItem(HOST_VOICE_STORAGE_KEY, nextUri);
    } catch {
      // Storage is optional; the choice still applies this session.
    }
    playCue("highlight");
  }

  function previewHostVoice() {
    if (!voiceOn || typeof window === "undefined" || !window.speechSynthesis) return;
    refreshCachedVoice();
    speakNative("This is your host voice. Pick your home base — Mars, Europa, or Andromeda Galaxy?");
  }

  function toggleControls() {
    if (!dockOpen) refreshCachedVoice();
    setDockOpen((value) => !value);
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

  function clearSpeechWatchdog() {
    if (speechWatchdogRef.current !== null) {
      clearTimeout(speechWatchdogRef.current);
      speechWatchdogRef.current = null;
    }
  }

  function clearRearmTimer() {
    if (rearmTimerRef.current !== null) {
      clearTimeout(rearmTimerRef.current);
      rearmTimerRef.current = null;
    }
  }

  function cancelSpeech() {
    utterCancelledRef.current = true;
    clearSpeechWatchdog();
    clearRearmTimer();
    utteranceRef.current = null;
    setHostSpeaking(false);
    try {
      window.speechSynthesis?.cancel();
    } catch {
      // ignore
    }
  }

  // On-end re-arm (primary path; the poll below is fallback only). Wait a
  // short beat after the host stops before opening the mic: Chrome can
  // still be draining the last words, and hearing its own confirmation
  // line caused the 4-owner confirm loop. A cancelled utterance never
  // re-arms: cancelSpeech always runs first and marks it.
  function requestRearm() {
    if (!convoRef.current) return;
    if (recordingRef.current) return;
    if (busyRef.current || turnErrorRef.current) return;
    clearRearmTimer();
    rearmTimerRef.current = setTimeout(() => {
      rearmTimerRef.current = null;
      if (!convoRef.current) return;
      if (recordingRef.current) return;
      if (busyRef.current || turnErrorRef.current) return;
      stampTiming("rearm");
      console.info(`[vvb-timing] rearm ${summarizeTimings(turnTimingRef.current)}`);
      void startRecording();
    }, 420);
  }

  // Voice-out is the curated system voice only: pick the best English
  // voice actually on this machine (enhanced/natural beats the robotic
  // default) with question/statement prosody. No downloads, no model.
  function speakNative(text: string, onDone?: () => void) {
    if (typeof window === "undefined" || !window.speechSynthesis) return false;
    const spoken = spokenHostText(text);
    if (!spoken) return false;
    if (typeof window !== "undefined") {
      const win = window as unknown as { __vvbLastSpoken?: string; __vvbAllSpoken?: string[] };
      win.__vvbLastSpoken = spoken;
      win.__vvbAllSpoken = win.__vvbAllSpoken ?? [];
      win.__vvbAllSpoken.push(spoken);
    }
    try {
      refreshCachedVoice();
      const voice = cachedVoiceRef.current ?? pickVoice(window.speechSynthesis.getVoices());
      const { rate, pitch } = prosodyFor(spoken);
      const utter = new SpeechSynthesisUtterance(spoken);
      if (voice) utter.voice = voice;
      utter.rate = rate;
      utter.pitch = pitch;
      clearSpeechWatchdog();
      utterCancelledRef.current = false;
      utteranceRef.current = utter;
      setHostSpeaking(true);
      const finishSpeech = () => {
        // A cancelled/replaced utterance can fire onend after a new one
        // has started; it must never tear down the current speech state.
        if (utteranceRef.current !== utter) return;
        clearSpeechWatchdog();
        utteranceRef.current = null;
        setHostSpeaking(false);
        if (utterCancelledRef.current) return;
        // First-Speak owns its post-speech action (open the mic after the
        // greeting). Run it before requestRearm so startRecording can
        // cancel/close cleanly without a second auto-rearm racing it.
        onDone?.();
        requestRearm();
      };
      utter.onend = () => {
        stampTiming("speechEnd");
        finishSpeech();
      };
      utter.onerror = () => {
        if (utteranceRef.current === utter) {
          setNotice("Host voice could not play — open Controls, choose Auto, and press PREVIEW.");
        }
        finishSpeech();
      };
      // Chrome can park speechSynthesis in a paused state after a cancel
      // or a page transition; resume before every utterance. Do not call
      // cancel() immediately before speak() — Chrome can drop that new
      // utterance, which looks exactly like "no voice".
      try {
        window.speechSynthesis.resume();
      } catch {
        // ignore
      }
      window.speechSynthesis.speak(utter);
      // Chrome can lose onend (especially if the utterance is GC'd). Never
      // leave the conversation saying LIVE with the mic closed: after a
      // generous estimate, cut the line and open the mic.
      speechWatchdogRef.current = setTimeout(() => {
        speechWatchdogRef.current = null;
        if (utteranceRef.current !== utter) return;
        try {
          window.speechSynthesis?.cancel();
        } catch {
          // ignore
        }
        finishSpeech();
      }, Math.min(9000, 2000 + spoken.length * 55));
      return true;
    } catch {
      setHostSpeaking(false);
      return false;
    }
  }

  function speakHost(text: string) {
    if (!voiceOn || !unlockedRef.current || typeof window === "undefined" || !window.speechSynthesis) return;
    const spoken = spokenHostText(text);
    if (!spoken || spoken === lastSpokenRef.current) return;
    lastSpokenRef.current = spoken;
    cancelSpeech();
    speakNative(text);
  }
  function foundersChanged(before: SharedState, after: SharedState): boolean {
    if (before.founders.length !== after.founders.length) return true;
    return before.founders.some(
      (founder, index) => founder.percent !== after.founders[index]?.percent,
    );
  }

  function commit(label: string, fn: (s: SharedState) => SharedState): string {
    const before = withDefaults(stateRef.current);
    const after = fn(before);
    const changed = !statesEqual(before, after);
    if (changed) {
      historyRef.current = pushHistory(historyRef.current, before, label, performance.now());
      setHistorySize(historyRef.current.length);
      // Move the cockpit with the change, in the same event/handler that
      // made it (never in an effect): open the beat that changed and put
      // the star map up only while the walk is still on home base.
      setActiveModule(after.currentBeat);
      setStageTab(after.currentBeat === "jurisdiction" ? "galaxy" : "colony");
      // Picking a world leaves currentBeat on "jurisdiction" while the
      // next objective is the equity split: land the colony and open the
      // crew manifest. A re-pick (no selection change) does not move.
      const selectionChanged = Boolean(
        after.selectedJurisdiction && before.selectedJurisdiction !== after.selectedJurisdiction,
      );
      if (
        after.currentBeat === "jurisdiction" &&
        after.selectedJurisdiction &&
        before.selectedJurisdiction !== after.selectedJurisdiction
      ) {
        setActiveModule("equity");
        setStageTab("colony");
      }
      // Equity/owner changes pause on confirmation before the required
      // walk advances. The split is already applied through the one
      // invariant path, so the card shows the real normalized totals.
      const beforeNext = beatProgress(before).nextBeat;
      const afterNext = beatProgress(after).nextBeat;
      const equityChanged = foundersChanged(before, after);
      if (after.currentBeat === "equity" && equityChanged) {
        setEquityConfirm(true);
        setActiveModule("equity");
        setStageTab("colony");
        setLocalHost(equityConfirmationLine(after));
      } else {
        if (after.currentBeat !== "equity" && equityChanged) setEquityConfirm(false);
        // Required-task handoff: when a change completes the current
        // required beat, open the next one in the same handler. 5/5
        // moves to LAUNCH; equity waits for confirmation above.
        if (afterNext !== "complete" && afterNext !== beforeNext) {
          setActiveModule(afterNext);
          setStageTab(afterNext === "jurisdiction" ? "galaxy" : "colony");
        }
      }
      if (selectionChanged && after.selectedJurisdiction) {
        const planet = after.selectedJurisdiction;
        const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
        if (!reduced) {
          // Wait for the heavy colony/equity render to paint before
          // starting the cinematic. Otherwise a slow render eats most of
          // the animation before the first frame is visible.
          const token = ++travelTokenRef.current;
          if (travelFrameRef.current !== null) cancelAnimationFrame(travelFrameRef.current);
          travelFrameRef.current = requestAnimationFrame(() => {
            travelFrameRef.current = requestAnimationFrame(() => {
              travelFrameRef.current = null;
              if (travelTokenRef.current !== token) return;
              setTravel({ planet, id: performance.now() });
            });
          });
        }
      }
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
    setEquityConfirm(false);
    setActiveModule(restored.selectedJurisdiction && restored.currentBeat === "jurisdiction" ? "equity" : restored.currentBeat);
    setStageTab(restored.selectedJurisdiction ? "colony" : "galaxy");
    playCue("adjust");
    // Labels like "live-preview" are internal; the summary already says
    // exactly what changed. Never speak internal state-machine jargon.
    const line = `Undid the last change. ${summary}`;
    setLocalHost(line);
    return line;
  }

  // THE one shared-state update path for equity (beat 2 invariant).
  // Slider drags call this directly; the voice-agent action below calls
  // the same function. Both normalize through setFounderShare(), so
  // neither surface can leave the split inconsistent — it totals 100%.
  function updateEquity(index: number, percent: number, via: string) {
    commit("slider", (s) => applyEquity(s, index, percent, via));
  }

  // The owner-count control and the agent action share this one path.
  function updateOwnerCount(count: number) {
    commit("owners", (s) => applyOwnerCount(s, count));
  }

  // THE one shared-state update path for the checklist (beat 3):
  // clicks and voice-agent actions both go through here.
  function updateChecklistItem(itemId: string, done: boolean) {
    commit("click", (s) => applyChecklistItem(s, itemId, done));
    const current = withDefaults(stateRef.current);
    if (itemId === "check-name" && done) {
      const built = current.checklist.filter((i) => i.done).length;
      const total = current.checklist.length;
      const undoneNext = current.checklist.find((i) => !i.done);
      setLocalHost(
        `Company name confirmed as Galactic Bagels Inc. (fictional) — ${built} of ${total} structures online.${undoneNext ? ` Next: ${undoneNext.label}.` : ""}`
      );
    } else {
      setLocalHost(checklistHostLine(current));
    }
  }

  // The explicit gate between "the split changed" and "move to BUILD".
  // The state is already normalized; this only acknowledges it and then
  // advances the required walk.
  function confirmEquitySelection() {
    if (!equityConfirm) return;
    const state = withDefaults(stateRef.current);
    const next = beatProgress(state).nextBeat;
    const owners = state.founders.length;
    const split = state.founders.map((founder) => `${founder.percent}%`).join(" / ");
    const nextLine =
      next === "complete"
        ? "Mission complete — colony founded."
        : nextObjectiveHostLine(state);
    const line = `${owners} ${owners === 1 ? "owner" : "owners"} confirmed — ${split}. ${nextLine}`;
    setEquityConfirm(false);
    setActiveModule(next === "complete" ? "summary" : next);
    setStageTab(next === "jurisdiction" ? "galaxy" : "colony");
    setLocalHost(line);
    playCue("highlight");
    if (voiceOn && unlockedRef.current) {
      lastSpokenRef.current = spokenHostText(line);
      speakNative(line);
    }
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

    if (status === "live") {
      if (intent.key !== previewKeyRef.current) {
        previewKeyRef.current = intent.key;
        stampTiming("firstPaint");
        setLivePreview({ key: intent.key, label: intent.label, status: "live" });
      }
      return intent;
    }

    // status === "confirming": commit only on speechComplete, keyed by turnId / intent key
    previewKeyRef.current = intent.key;
    if (intent.key !== committedKeyRef.current) {
      committedKeyRef.current = intent.key;
      if (intent.kind === "jurisdiction") {
        commit("live-preview", (s) => applyJurisdiction(s, intent.jurisdiction));
      } else if (intent.kind === "equity") {
        const base = withDefaults(stateRef.current);
        const index = resolveFounderIndex(base.founders, intent.founder);
        if (index >= 0) commit("live-preview", (s) => applyEquity(s, index, intent.percent, "voice-live"));
      } else if (intent.kind === "checklist-advance") {
        commit("live-preview", (s) => applyChecklistCount(s, intent.count));
      } else if (intent.kind === "owner-count") {
        commit("live-preview", (s) => applyOwnerCount(s, intent.count));
      } else if (intent.kind === "cheapest") {
        const cheapest = cheapestByNumber(DEMO_JURISDICTIONS);
        commit("live-preview", (s) => applyFocusJurisdiction(s, cheapest.name, "cheapest by number (DEMO)"));
      } else if (intent.kind === "lawyer-summary") {
        prepareLawyerPackage();
      }
    }
    setLivePreview({ key: intent.key, label: intent.label, status: "confirmed" });
    return intent;
  }

  function handleLiveTranscript(text: string, isFinal = false) {
    const trimmed = text.trim();
    if (!trimmed) return;
    liveTranscriptRef.current = trimmed;
    stampTiming("firstPartial");
    setLiveTranscript(trimmed);

    // Ground-truth voice activity: browser speech recognition identified real words.
    // Count recognised words as speech and reset no-speech attempt counter.
    const now = performance.now();
    activityRef.current = {
      hasSpoken: true,
      speechMs: Math.max(activityRef.current.speechMs, MIN_SPEECH_MS),
      lastSpeechAt: now,
    };
    noSpeechAttemptsRef.current = 0;

    if (equityConfirm && isConfirmationAnswer(trimmed)) {
      intentMatchedRef.current = true;
      setLivePreview({ key: "confirm-equity", label: "Confirming equity split…", status: "live" });
      // Fast endpointing: short affirmative answers ("yes", "confirm", "split")
      // should finish and advance immediately in ~450ms (or 150ms on final), not wait 16+ seconds.
      clearConfirmationTimer();
      confirmationTimerRef.current = setTimeout(() => {
        if (recordingRef.current && !finishingRef.current) {
          void finishRecording();
        }
      }, isFinal ? 150 : 450);
      return;
    }

    if (namePromptActive && isNameApproval(trimmed)) {
      intentMatchedRef.current = true;
      setLivePreview({ key: "approve-name", label: "Approving company name: Galactic Bagels Inc. (fictional)…", status: "live" });
      clearConfirmationTimer();
      confirmationTimerRef.current = setTimeout(() => {
        if (recordingRef.current && !finishingRef.current) {
          void finishRecording();
        }
      }, isFinal ? 150 : 450);
      return;
    }
    clearConfirmationTimer();

    if (isCompanyNameQuestion(trimmed)) {
      intentMatchedRef.current = true;
      setLivePreview({ key: "company-name-q", label: "Fictional company: Galactic Bagels Inc. (fictional)", status: "live" });
      if (isFinal) {
        setTimeout(() => {
          if (recordingRef.current && !finishingRef.current) void finishRecording();
        }, 150);
      }
      return;
    }

    const intent = applyLiveIntent(trimmed, "live");
    // Adaptive endpointing: a recognised command shortens the stop pause
    // to 600 ms. Questions keep 1100 ms — a slow ask needs its full pause.
    if (intent && intent.kind !== "rollover-question" && intent.kind !== "filing-question") {
      intentMatchedRef.current = true;
      if (isFinal) {
        setTimeout(() => {
          if (recordingRef.current && !finishingRef.current) void finishRecording();
        }, 150);
      }
    }
  }

  // Beat 1 action: the agent's authoritative jurisdiction write. It
  // lands on the same applyJurisdiction path as the live preview, so
  // confirming a preview changes nothing twice.
  useCopilotAction({
    render: renderNothing,
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
  });

  // Beat 2 voice path: "make me 70%" -> same updateEquity() the slider
  // drags use, so 60/40 with a 70% request lands on 70/30, total 100%.
  useCopilotAction({
    render: renderNothing,
    name: AGENT_ACTIONS.setFounderEquity,
    description:
      "Set one DEMO owner's equity percent (e.g. the user says 'make me 70%'). The other owner(s) auto-adjust so the split always totals 100%. Owners are the readable founders list; there may be 1–5.",
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

  useCopilotAction({
    name: AGENT_ACTIONS.setOwnerCount,
    description:
      "Set the number of fictional company owners (1-5). Shrinking the team redistributes the removed share; growing adds owners at 0%; the equity split always totals 100%. Use when the user says it is just them, or names a number of owners/founders.",
    parameters: [
      {
        name: "count",
        type: "number",
        description: "Number of owners, 1 to 5.",
        required: true,
      },
    ],
    handler: async ({ count }) => {
      logToolCall();
      return commit("owners", (s) => applyOwnerCount(s, Number(count)));
    },
  });

  // Beat 3 voice paths: check/uncheck one item, or advance the walk.
  useCopilotAction({
    render: renderNothing,
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
    render: renderNothing,
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
    render: renderNothing,
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
    render: renderNothing,
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
    render: renderNothing,
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
    render: renderNothing,
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
    render: renderNothing,
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
    render: renderNothing,
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
    setLocalHost("Summary prepared — copy or download it; nothing is sent.");
  }

  useCopilotAction({
    render: renderNothing,
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
    setLocalHost(nextObjectiveHostLine(withDefaults(stateRef.current)));
  }

  // The fast lane's spoken/visible line. It is derived from the state
  // after the command and always includes the next useful question, so
  // the conversation keeps moving without the model.
  function localFastLine(intent: LiveIntent, state: SharedState): string {
    const next = beatProgress(state).nextBeat;
    const question = next === "complete"
      ? ""
      : getHostQuestion(next, shortFounderNames(state.founders), state.selectedJurisdiction);

    switch (intent.kind) {
      case "jurisdiction":
        return question || `${intent.jurisdiction} locked in.`;
      case "equity":
      case "owner-count":
        // Equity changes pause on the confirmation card; do not append
        // the next task's question and make the user feel rushed.
        return equityConfirmationLine(state);
      case "checklist-advance": {
        const built = state.checklist.filter((item) => item.done).length;
        const total = state.checklist.length;
        if (next === "checklist") {
          return `${built} of ${total} structures online. Tick the next step or finish the build.`;
        }
        return `${built} of ${total} structures online.${question ? ` ${question}` : ""}`;
      }
      case "cheapest": {
        const cheapest = cheapestByNumber(DEMO_JURISDICTIONS);
        const currency = cheapest.sameCurrency
          ? "All three demo fees use the same fictional currency."
          : "Currencies are fictional and don't convert.";
        return `DEMO cheapest by number: ${cheapest.name} (${cheapest.fee}). ${currency}${question ? ` ${question}` : ""}`;
      }
      case "lawyer-summary":
        return "Summary prepared — copy or download it; nothing is sent.";
      default:
        return "";
    }
  }

  function answerLocally(
    reply: string,
    trimmed: string,
    options?: {
      module?: SharedState["currentBeat"];
      stageTab?: "galaxy" | "colony";
      cue?: CueName;
      mutate?: (prev: SharedState) => SharedState;
    },
  ) {
    previewKeyRef.current = null;
    pendingTurnRef.current = null;
    setLivePreview(null);
    setLiveTranscript(trimmed);
    setLastTranscript(trimmed);
    if (options?.mutate) {
      commit("agent", options.mutate);
    } else {
      setState((prev) => ({ ...withDefaults(prev), transcript: trimmed }));
    }
    setLocalHost(reply);
    setAck("");
    if (options?.module) setActiveModule(options.module);
    if (options?.stageTab) setStageTab(options.stageTab);
    if (options?.cue) playCue(options.cue);
    if (voiceOn && unlockedRef.current) {
      lastSpokenRef.current = spokenHostText(reply);
      speakNative(reply);
    }
  }

  async function sendToAgent(text: string, fromVoice = false) {
    const trimmed = text.trim();
    if (!trimmed) {
      if (fromVoice) {
        const line = emptyTranscriptReply();
        setLocalHost(line);
        if (voiceOn && unlockedRef.current) {
          lastSpokenRef.current = spokenHostText(line);
          speakNative(line);
        }
      }
      return;
    }
    noSpeechAttemptsRef.current = 0;
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

    // Equity/owner changes are gated: the card asks for confirmation
    // before the required walk advances. A new owner/equity command is
    // still allowed (it updates the split and the card); undo/start over
    // remain escape hatches; other commands wait for the confirmation.
    if (equityConfirm) {
      const pendingIntent = parseLiveIntent(trimmed);
      const isConfirm = isConfirmationAnswer(trimmed) || (!isChangeAnswer(trimmed) && /\b(?:confirm(?:ed)?|the split)\b/i.test(trimmed));
      if (isConfirm) {
        previewKeyRef.current = null;
        pendingTurnRef.current = null;
        setLivePreview(null);
        setLiveTranscript(trimmed);
        setLastTranscript(trimmed);
        setState((prev) => ({ ...withDefaults(prev), transcript: trimmed }));
        setAck("");
        confirmEquitySelection();
        return;
      }
      if (isChangeAnswer(trimmed)) {
        answerLocally(
          "No problem — change the owner count or drag a slider, then confirm.",
          trimmed,
          { module: "equity", stageTab: "colony", cue: "adjust" },
        );
        return;
      }
      const stateNow = withDefaults(stateRef.current);
      const sameOwnerCount =
        pendingIntent?.kind === "owner-count" &&
        pendingIntent.count === stateNow.founders.length;
      if (sameOwnerCount) {
        // Repeating the same owner count is a confirmation, not a new
        // split. This breaks the "4 owners → confirm" echo loop.
        previewKeyRef.current = null;
        pendingTurnRef.current = null;
        setLivePreview(null);
        setLiveTranscript(trimmed);
        setLastTranscript(trimmed);
        setState((prev) => ({ ...withDefaults(prev), transcript: trimmed }));
        setAck("");
        confirmEquitySelection();
        return;
      }
      const canAdjust =
        pendingIntent?.kind === "owner-count" || pendingIntent?.kind === "equity";
      const canEscape =
        pendingIntent?.kind === "undo" || pendingIntent?.kind === "start-over";
      if (!canAdjust && !canEscape) {
        // The split is already applied; the next command is an implicit
        // confirmation. Do not add another prompt or block the walk.
        setEquityConfirm(false);
        setLocalHost("");
      }
    }

    // This answer is fixed safety copy, not a fact lookup and not a
    // state change. Answer it locally so the guard turn never waits on
    // the model.
    if (isFilingGuardQuestion(trimmed)) {
      answerLocally(FILING_GUARD_REPLY, trimmed, { cue: "adjust" });
      return;
    }

    // "None" / "zero" / "not yet" is a valid answer to the checklist
    // question, but it changes no shared state, so the agent has nothing
    // to call. Acknowledge it from the real board and show the build
    // queue instead of sending a dead turn and reporting an agent error.
    if (beatProgress(view).nextBeat === "checklist" && isNothingDoneAnswer(trimmed)) {
      answerLocally(checklistNoopReply(view), trimmed, {
        module: "checklist",
        stageTab: "colony",
        cue: "adjust",
      });
      return;
    }

    // Querying the company name: answer locally with the fictional demo name instantly
    if (isCompanyNameQuestion(trimmed)) {
      answerLocally(companyNameReply(), trimmed, { cue: "adjust" });
      return;
    }

    // When prompted to pick/approve the company name:
    if (namePromptActive) {
      setNamePromptActive(false);
      if (isNameApproval(trimmed)) {
        previewKeyRef.current = null;
        pendingTurnRef.current = null;
        setLivePreview(null);
        setLiveTranscript(trimmed);
        setLastTranscript(trimmed);
        commit("checklist", (s) => applyChecklistItem(s, "check-name", true));
        const current = withDefaults(stateRef.current);
        const built = current.checklist.filter((i) => i.done).length;
        const total = current.checklist.length;
        const undoneNext = current.checklist.find((i) => !i.done);
        const line = `Company name confirmed as Galactic Bagels Inc. (fictional) — ${built} of ${total} structures online.${undoneNext ? ` Next: ${undoneNext.label}.` : ""}`;
        setLocalHost(line);
        setAck("");
        setActiveModule("checklist");
        setStageTab("colony");
        if (voiceOn && unlockedRef.current) {
          lastSpokenRef.current = spokenHostText(line);
          speakNative(line);
        }
        return;
      }
      if (isNameCancel(trimmed)) {
        answerLocally(
          "No problem — we can pick the company name later. Which checklist item shall we do next?",
          trimmed,
          { module: "checklist", stageTab: "colony", cue: "adjust" },
        );
        return;
      }
      // If user suggested a custom name (e.g. "Call it Cosmic Donuts", "Starlight Coffee")
      const customMatch = trimmed.match(/^(?:call\s+it|name\s+it|let'?s\s+(?:call|name)\s+it|how\s+about)\s+(.+)$/i);
      const isCustomSuggestion = Boolean(customMatch || (!parseLiveIntent(trimmed) && trimmed.split(/\s+/).length <= 4));
      if (isCustomSuggestion) {
        const rawName = customMatch ? customMatch[1] : trimmed;
        const cleaned = rawName.replace(/[.!?]+$/, "").trim();
        const customName = `${cleaned} (fictional)`;
        previewKeyRef.current = null;
        pendingTurnRef.current = null;
        setLivePreview(null);
        setLiveTranscript(trimmed);
        setLastTranscript(trimmed);
        commit("checklist", (s) => applyChecklistItem(s, "check-name", true));
        const current = withDefaults(stateRef.current);
        const built = current.checklist.filter((i) => i.done).length;
        const total = current.checklist.length;
        const undoneNext = current.checklist.find((i) => !i.done);
        const line = `Company name confirmed as ${customName} — ${built} of ${total} structures online.${undoneNext ? ` Next: ${undoneNext.label}.` : ""}`;
        setLocalHost(line);
        setAck("");
        setActiveModule("checklist");
        setStageTab("colony");
        if (voiceOn && unlockedRef.current) {
          lastSpokenRef.current = spokenHostText(line);
          speakNative(line);
        }
        return;
      }
    }

    // Direct company name checklist step:
    const isExplicitTick = /\b(?:tick(?:\s+off)?|mark|check)\s+(?:the\s+|a\s+)?(?:company\s+)?name\b/i.test(trimmed);
    const isPickName =
      /^(?:(?:pick|choose|set)\s+)?(?:the\s+|a\s+)?(?:company\s+)?name[.!?]*$/i.test(trimmed) ||
      /\b(?:pick|choose|set)\s+(?:the\s+|a\s+)?company\s+name\b/i.test(trimmed) ||
      /^(?:the\s+|a\s+)?(?:company\s+)?name[.!?]*$/i.test(trimmed);

    if (isPickName && !isExplicitTick && !isCompanyNameQuestion(trimmed)) {
      const isAlreadyDone = view.checklist.find((i) => i.id === "check-name")?.done;
      if (isAlreadyDone) {
        answerLocally(
          "Company name is already confirmed as Galactic Bagels Inc. (fictional). Which checklist item shall we do next?",
          trimmed,
        );
        return;
      }
      setNamePromptActive(true);
      answerLocally(
        "We have the fictional demo name ready: Galactic Bagels Inc. (fictional). Would you like to approve Galactic Bagels, or what name should we pick?",
        trimmed,
        { module: "checklist", stageTab: "colony", cue: "highlight" },
      );
      return;
    }

    if (isExplicitTick && !isCompanyNameQuestion(trimmed)) {
      previewKeyRef.current = null;
      pendingTurnRef.current = null;
      setLivePreview(null);
      setLiveTranscript(trimmed);
      setLastTranscript(trimmed);
      commit("checklist", (s) => applyChecklistItem(s, "check-name", true));
      const current = withDefaults(stateRef.current);
      const built = current.checklist.filter((i) => i.done).length;
      const total = current.checklist.length;
      const undoneNext = current.checklist.find((i) => !i.done);
      const line = `Company name confirmed as Galactic Bagels Inc. (fictional) — ${built} of ${total} structures online.${undoneNext ? ` Next: ${undoneNext.label}.` : ""}`;
      setLocalHost(line);
      setAck("");
      setActiveModule("checklist");
      setStageTab("colony");
      if (voiceOn && unlockedRef.current) {
        lastSpokenRef.current = spokenHostText(line);
        speakNative(line);
      }
      return;
    }

    const intent = parseLiveIntent(trimmed);
    const fast = Boolean(intent && FAST_INTENT_KINDS.has(intent.kind));

    // Immediate acknowledgment for the model path only. The fast lane
    // below answers immediately with its full host line instead of "on it".
    if (!fast && fromVoice && voiceOn) {
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
    // Paint instantly, confirm asynchronously. For a typed command there
    // is no interim preview, so reset the key and apply. For a spoken
    // command, the interim already applied this key: do NOT apply it
    // again (especially checklist ticks, which are not idempotent).
    if (!fromVoice) previewKeyRef.current = null;
    const applied = applyLiveIntent(trimmed, "confirming");
    setLiveTranscript(trimmed);
    setLastTranscript(trimmed);
    setState((prev) => ({ ...withDefaults(prev), transcript: trimmed }));

    // Deterministic commands do not need the model. Apply the same
    // appliers (already done above), speak/display the derived host line,
    // and return without a network turn or an agent queue slot.
    if (fast && applied) {
      let line = "";
      if (applied.kind === "undo") {
        line = undoLast();
      } else if (applied.kind === "start-over") {
        previewKeyRef.current = null;
        committedKeyRef.current = null;
        commit("start-over", (s) => applyStartOver(s));
        const next = beatProgress(stateRef.current).nextBeat;
        const question = next === "complete"
          ? ""
          : getHostQuestion(next, shortFounderNames(stateRef.current.founders), stateRef.current.selectedJurisdiction);
        line = `Fresh start.${question ? ` ${question}` : ""}`;
      } else {
        line = localFastLine(applied, stateRef.current);
      }
      pendingTurnRef.current = null;
      setLivePreview({ key: applied.key, label: applied.label, status: "confirmed" });
      setAck("");
      if (line) {
        setLocalHost(line);
        const spoken = spokenHostText(line);
        if (voiceOn && unlockedRef.current && spoken !== lastSpokenRef.current) {
          lastSpokenRef.current = spoken;
          speakNative(line);
        }
      }
      return;
    }

    // Model path: clear the local line so the agent's reply can take over.
    setLocalHost("");
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
    activeVoiceTurnRef.current = fromVoice;
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
      activeVoiceTurnRef.current = false;
      setSending(false);
    }
  }

  function ensureAsrStreamSocket() {
    if (asrSocketRef.current && (asrSocketRef.current.readyState === WebSocket.OPEN || asrSocketRef.current.readyState === WebSocket.CONNECTING)) {
      return;
    }
    if (typeof window === "undefined") return;
    try {
      const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
      const wsUrl = `${protocol}//${window.location.host}/api/asr-stream`;
      const ws = new WebSocket(wsUrl);
      asrSocketRef.current = ws;
      ws.binaryType = "arraybuffer";

      ws.onopen = () => {
        streamingReadyRef.current = true;
      };

      ws.onmessage = (event: MessageEvent) => {
        try {
          const raw = typeof event.data === "string" ? event.data : new TextDecoder().decode(event.data as ArrayBuffer);
          const msg = JSON.parse(raw) as Record<string, unknown>;
          const type = msg.type as string | undefined;
          if (type === "transcript") {
            const transcript = msg.transcript as string | undefined;
            if (transcript) {
              handleLiveTranscript(transcript, false);
            }
          } else if (type === "speechComplete") {
            const transcript = (msg.transcript as string | undefined) ?? "";
            onStreamingSpeechComplete(transcript, activeTurnIdRef.current);
          } else if (type === "ready") {
            streamingReadyRef.current = true;
          } else if (type === "error") {
            console.warn("[asr-stream] upstream error:", msg.message);
          }
        } catch {
          // ignore malformed
        }
      };

      ws.onclose = () => {
        streamingReadyRef.current = false;
        asrSocketRef.current = null;
      };

      ws.onerror = (err) => {
        console.warn("[asr-stream] socket error, falling back to buffered path", err);
        streamingReadyRef.current = false;
      };
    } catch (err) {
      console.warn("[asr-stream] failed to create socket, falling back to buffered path", err);
      streamingReadyRef.current = false;
    }
  }

  function onStreamingSpeechComplete(transcript: string, turnId: number) {
    if (turnId !== activeTurnIdRef.current) return;
    if (!recordingRef.current && !finishingRef.current) return;
    finishingRef.current = true;
    recordingRef.current = false;
    isTurnListeningRef.current = false;
    stopWebSpeech();
    setMicLevel(0);
    setRecording(false);
    stampTiming("finalTranscript");

    const trimmed = (transcript ?? "").trim();
    if (isEmptyTranscript(trimmed)) {
      finishingRef.current = false;
      const line = emptyTranscriptReply();
      setLocalHost(line);
      setNotice(line);
      if (voiceOn && unlockedRef.current) {
        lastSpokenRef.current = spokenHostText(line);
        speakNative(line);
      }
      return;
    }

    void (async () => {
      try {
        await sendToAgent(trimmed, true);
      } finally {
        finishingRef.current = false;
      }
    })();
  }

  function cleanupAudio() {
    clearConfirmationTimer();
    isTurnListeningRef.current = false;
    try {
      asrSocketRef.current?.close();
    } catch {
      // ignore
    }
    asrSocketRef.current = null;
    streamingReadyRef.current = false;
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
    const res = await fetch("/api/transcribe", {
      method: "POST",
      body: form,
      signal: AbortSignal.timeout(ASR_TIMEOUT_MS),
    });
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
      rec.onresult = (event: { results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal?: boolean }> }) => {
        let text = "";
        let isFinal = false;
        for (let i = 0; i < event.results.length; i++) {
          text += event.results[i][0]?.transcript ?? "";
          if (event.results[i].isFinal) isFinal = true;
        }
        handleLiveTranscript(text, isFinal);
      };
      rec.onerror = (event: { error?: string }) => {
        if (event.error !== "no-speech" && event.error !== "aborted") webSpeechFailedRef.current = true;
        recognitionRef.current = null;
      };
      rec.onend = () => {
        recognitionRef.current = null;
        if (
          recordingRef.current &&
          !finishingRef.current &&
          (intentMatchedRef.current || (equityConfirm && isConfirmationAnswer(liveTranscriptRef.current)))
        ) {
          void finishRecording();
          return;
        }
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
      clearSpeechWatchdog();
      clearRearmTimer();
      clearConfirmationTimer();
      utteranceRef.current = null;
      if (travelFrameRef.current !== null) cancelAnimationFrame(travelFrameRef.current);
      try {
        window.speechSynthesis?.cancel();
      } catch {
        // ignore
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
      if (isEmptyTranscript(transcript)) {
        const line = emptyTranscriptReply();
        setLocalHost(line);
        setNotice(line);
        if (voiceOn && unlockedRef.current) {
          lastSpokenRef.current = spokenHostText(line);
          speakNative(line);
        }
        return;
      }
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
    clearConfirmationTimer();
    if (finishingRef.current) return;
    finishingRef.current = true;
    recordingRef.current = false;
    isTurnListeningRef.current = false;
    stopWebSpeech();
    setMicLevel(0);
    setRecording(false);

    // If streaming ASR is active, speechComplete from Meta endpointing is the authority
    if (streamingReadyRef.current) {
      finishingRef.current = false;
      return;
    }

    const ctx = audioContextRef.current;
    const inputRate = ctx?.sampleRate ?? 0;
    const chunks = chunksRef.current;
    chunksRef.current = [];
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
      console.info(
        `[vvb-timing] turn ended, peak RMS: ${peakLevelRef.current.toFixed(4)}, speechMs: ${activityRef.current.speechMs.toFixed(0)}ms`,
      );
      await transcribeAndSend(buf);
    } finally {
      finishingRef.current = false;
    }
  }

  async function handleNoSpeechTimeout() {
    clearConfirmationTimer();
    if (finishingRef.current) return;
    finishingRef.current = true;
    recordingRef.current = false;
    isTurnListeningRef.current = false;
    stopWebSpeech();
    setMicLevel(0);
    setRecording(false);
    finishingRef.current = false;

    if (noSpeechAttemptsRef.current === 0) {
      noSpeechAttemptsRef.current = 1;
      const line = noSpeechReply();
      setLocalHost(line);
      setNotice(line);
      if (voiceOn && unlockedRef.current) {
        lastSpokenRef.current = spokenHostText(line);
        speakNative(line);
      }
    } else {
      convoRef.current = false;
      setConvoActive(false);
      noSpeechAttemptsRef.current = 0;
      setNotice("Conversation paused (no speech detected) — press TALK to resume.");
    }
  }

  // First TALK press only: consume the one-per-session marker. The
  // in-memory ref is checked first so a rapid double press cannot speak
  // twice even when sessionStorage is unavailable. The marker is written
  // before speech so an unsupported voice or a blocked storage API still
  // opens the mic on the same press instead of looping the greeting.
  function consumeFirstSpeakGreeting(): boolean {
    if (firstSpeakHandledRef.current) return false;
    firstSpeakHandledRef.current = true;
    let store: Storage | null = null;
    try {
      store = window.sessionStorage;
    } catch {
      store = null;
    }
    if (hasFirstSpeakGreeting(store)) return false;
    markFirstSpeakGreeting(store);
    return true;
  }

  async function toggleRecording() {
    if (recording) {
      // A manual stop ends the conversation, not just the turn.
      convoRef.current = false;
      setConvoActive(false);
      dropQueuedTurn();
      await finishRecording();
      cleanupAudio();
      return;
    }
    if (convoRef.current && (transcribing || sending || isLoading)) {
      // Ending a conversation while the agent is mid-turn: just stop
      // re-arming the mic; the current turn finishes on its own.
      convoRef.current = false;
      setConvoActive(false);
      dropQueuedTurn();
      cleanupAudio();
      return;
    }
    unlockedRef.current = true;
    if (convoOn) {
      convoRef.current = true;
      setConvoActive(true);
    }
    setDockOpen(false);

    // First Speak: greet with the existing home-base question, then open
    // the mic. This is presentation only — no shared state and no fact.
    if (consumeFirstSpeakGreeting()) {
      if (voiceOn && typeof window !== "undefined" && window.speechSynthesis) {
        refreshCachedVoice();
        if (speakNative(FIRST_SPEAK_GREETING, () => { void startRecording(); })) {
          return;
        }
      }
    }

    await startRecording();
  }

  async function ensureAudioPipeline() {
    if (audioContextRef.current && mediaStreamRef.current && workletNodeRef.current) {
      if (audioContextRef.current.state === "suspended") {
        await audioContextRef.current.resume();
      }
      return;
    }
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: true,
    });
    mediaStreamRef.current = stream;
    let ctx: AudioContext;
    try {
      ctx = new AudioContext({ sampleRate: 16000 });
    } catch {
      ctx = new AudioContext();
    }
    audioContextRef.current = ctx;
    await loadPcmWorklet((url) => ctx.audioWorklet.addModule(url));
    const node = new AudioWorkletNode(ctx, "pcm-capture");
    workletNodeRef.current = node;

    node.port.onmessage = (event: MessageEvent) => {
      const block = event.data as Float32Array;
      if (!block || block.length === 0) return;
      if (!isTurnListeningRef.current) return;

      chunksRef.current.push(block);
      const rate = audioContextRef.current?.sampleRate ?? 0;

      // Stream binary PCM16 over WebSocket to Meta ASR relay if connected
      if (asrSocketRef.current && asrSocketRef.current.readyState === WebSocket.OPEN) {
        let pcm: Int16Array;
        if (rate === 16000) {
          pcm = new Int16Array(block.length);
          for (let i = 0; i < block.length; i++) {
            const s = Math.max(-1, Math.min(1, block[i]));
            pcm[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
          }
        } else if (rate > 0) {
          pcm = toPcm16k(block, rate);
        } else {
          pcm = new Int16Array(0);
        }
        if (pcm.length > 0) {
          asrSocketRef.current.send(pcm.buffer);
        }
      }

      const level = rmsLevel(block);
      levelRef.current = level;
      peakLevelRef.current = Math.max(peakLevelRef.current, level);
      const now = performance.now();
      const listened = now - (turnTimingRef.current.micStart ?? now);

      // Guard 1: No speech detected after 8s -> close quietly, say "Didn't hear anything — say it again", re-arm once
      if (shouldTriggerNoSpeech(activityRef.current.hasSpoken, listened)) {
        void handleNoSpeechTimeout();
        return;
      }

      // Guard 2: Max utterance length (15s cap) -> force finish recording
      if (shouldCapUtterance(listened)) {
        void finishRecording();
        return;
      }

      activityRef.current = nextVoiceActivity(activityRef.current, level, now, rate > 0 ? (block.length / rate) * 1000 : 0);

      // Demote client RMS/silence gate:
      // When streaming ASR is active, Meta endpointing is the authority for turn end.
      // If streaming is not active, fall back to local auto-stop.
      if (!streamingReadyRef.current) {
        if (shouldAutoStop(activityRef.current, now, intentMatchedRef.current ? INTENT_SILENCE_TO_STOP_MS : SILENCE_TO_STOP_MS)) {
          void finishRecording();
          return;
        }
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
  }

  async function startRecording() {
    if (recordingRef.current) return;
    clearRearmTimer();
    clearConfirmationTimer();
    liveTranscriptRef.current = "";
    activeTurnIdRef.current += 1;
    recordingRef.current = true;
    isTurnListeningRef.current = true;
    turnTimingRef.current = { micStart: performance.now() };
    stampTiming("rearm");
    // Barge-in: the host stops talking the moment the user speaks.
    cancelSpeech();
    unlockedRef.current = true;
    clearTurnErrors();
    lastAudioRef.current = null;
    setHasLastAudio(false);
    activityRef.current = IDLE_ACTIVITY;
    levelRef.current = 0;
    peakLevelRef.current = 0;
    previewKeyRef.current = null;
    committedKeyRef.current = null;
    intentMatchedRef.current = false;
    setLiveTranscript("");
    setLivePreview(null);
    setMicLevel(0);
    setRecordSeconds(0);
    chunksRef.current = [];
    finishingRef.current = false;

    try {
      await ensureAudioPipeline();
      ensureAsrStreamSocket();
      setRecording(true);
      if (!streamingReadyRef.current) {
        startWebSpeech();
      }
    } catch (error) {
      cleanupAudio();
      recordingRef.current = false;
      isTurnListeningRef.current = false;
      setRecording(false);
      // End the loop on a failed capture. Otherwise the UI says
      // "conversation live" while the auto-listen effect retries the
      // same broken context forever. TALK or typing can start again.
      convoRef.current = false;
      setConvoActive(false);
      dropQueuedTurn();
      setNotice(micFailureNotice(error));
    }
  }

  const progress = beatProgress(view);
  const mission = missionFor(view);
  // The fallback host line follows the next objective, not the last beat
  // touched: after picking Mars the comms panel should ask about equity,
  // not repeat the home-base question. Agent text still outranks it.
  const fallbackBeat: Beat = mission.beat === "complete" ? view.currentBeat : mission.beat;
  const resolvedHostPrompt = resolveHostPrompt(messages as never, fallbackBeat, shortFounderNames(view.founders), view.selectedJurisdiction);
  const hostPrompt = localHost
    ? { text: localHost, source: "fallback" as const }
    : resolvedHostPrompt;
  const doneCount = progress.requiredDone;

  // First gesture unlocks audio/speech (browser autoplay policy) and
  // warms the curated system voice. Voice lists often arrive after first
  // paint, so re-pick when the browser publishes them. The picker child
  // owns the visible voice list; this effect only resolves the voice.
  useEffect(() => {
    const unlock = () => {
      unlockedRef.current = true;
      refreshCachedVoice();
    };
    const handleVoicesChanged = () => {
      refreshCachedVoice();
    };
    window.addEventListener("pointerdown", unlock);
    window.addEventListener("keydown", unlock);
    const synth = window.speechSynthesis;
    if (synth && typeof synth.addEventListener === "function") synth.addEventListener("voiceschanged", handleVoicesChanged);
    return () => {
      window.removeEventListener("pointerdown", unlock);
      window.removeEventListener("keydown", unlock);
      if (synth && typeof synth.removeEventListener === "function") synth.removeEventListener("voiceschanged", handleVoicesChanged);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
    if (!convoActive || recording || transcribing || sending || isLoading || hostSpeaking) return;
    if (turnError || transcribeFailure) {
      const t = setTimeout(() => {
        convoRef.current = false;
        setConvoActive(false);
        queuedTurnRef.current = null;
        setNotice("Conversation paused after an error — press Speak (mic) to resume.");
      }, 0);
      return () => clearTimeout(t);
    }
    // Re-arm on utterance onend/onerror and turn completion, not by polling speechSynthesis.speaking.
    // If not recording and lane is completely idle and no speech is active, request a re-arm.
    if (convoRef.current && !recordingRef.current && !hostSpeaking) {
      requestRearm();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [convoActive, recording, transcribing, sending, isLoading, turnError, transcribeFailure, hostSpeaking]);

  // Errors get a dull buzz, never silence.
  useEffect(() => {
    if (turnError || transcribeFailure) playCue("error");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [turnError, transcribeFailure]);

  // Agent watchdog (Fix 4): if the agent has been busy for over 25s, abort and reset
  useEffect(() => {
    if (!isLoading && !sending) return;
    const timer = setTimeout(() => {
      try {
        stopGeneration?.();
      } catch {
        // ignore
      }
      setSending(false);
      setNotice("");
      setTurnError("Agent took too long, try again");
    }, AGENT_WATCHDOG_MS);
    return () => clearTimeout(timer);
  }, [isLoading, sending, stopGeneration]);

  // Hands-free testing & mock-voice simulation hook:
  // Enables automated test playthroughs and mock audio runs to feed voice
  // commands, simulate speech recognition events, and test host speech hands-free.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const win = window as unknown as Record<string, unknown>;
    win.__vvbVoice = {
      isRecording: () => recordingRef.current,
      getPhase: () =>
        recording ? "recording" : transcribing ? "transcribing" : sending ? "sending" : isLoading ? "agent-busy" : "idle",
      isHostSpeaking: () => Boolean(hostSpeaking || isSpeechActive()),
      feedVoice: async (text: string) => {
        handleLiveTranscript(text);
        setMicLevel(0.85);
        await new Promise((resolve) => setTimeout(resolve, 250));
        stopWebSpeech();
        stampTiming("finalTranscript");
        isTurnListeningRef.current = false;
        recordingRef.current = false;
        setRecording(false);
        setMicLevel(0);
        await sendToAgent(text, true);
      },
      startConvo: () => {
        void toggleRecording();
      },
    };
    return () => {
      delete win.__vvbVoice;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recording, transcribing, sending, isLoading, hostSpeaking]);

  // Beat completion celebrates on the mission banner, with a
  // zero-gravity stardust burst over the page (skipped entirely for
  // reduced-motion users). Name the beat that actually completed, not the
  // mission that just became current: picking Mars clears Home base, it
  // does not clear the equity split the banner now asks for.
  const prevProgressRef = useRef(progress);
  useEffect(() => {
    if (prevDoneCountRef.current >= 0 && doneCount > prevDoneCountRef.current) {
      const justDone = MODULES.map((module) => module.id).find(
        (beat) => progress.done[beat] && !prevProgressRef.current.done[beat],
      );
      const label = justDone ? moduleFor(justDone).label : mission.title;
      const complete = justDone
        ? justDone === "checklist"
          ? view.checklist.every((item) => item.done)
          : progress.done[justDone]
        : true;
      setCelebrated(`${complete ? "MISSION CLEARED" : "OBJECTIVE UPDATED"} · ${label}`);
      // Selecting a home base already gets the rocket/travel cinematic;
      // confetti on top of it is noise, not celebration.
      if (justDone !== "jurisdiction" && justDone !== "equity" && !window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
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
      prevDoneCountRef.current = doneCount;
      prevProgressRef.current = progress;
      const t = setTimeout(() => setCelebrated(""), 2200);
      return () => clearTimeout(t);
    }
    prevDoneCountRef.current = doneCount;
    prevProgressRef.current = progress;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doneCount]);
  const [elapsed, setElapsed] = useState(0);
  const busySinceRef = useRef<number | null>(null);
  const turnPhase = recording ? "recording" : transcribing ? "transcribing" : sending ? "sending" : isLoading ? "agent-busy" : "idle";
  const busy = turnPhase === "sending" || turnPhase === "agent-busy";
  const micLabel =
    turnPhase === "recording"
      ? convoActive
        ? "End conversation"
        : "Stop recording"
      : convoActive
        ? busy
          ? "End conversation"
          : hostSpeaking
            ? "Listen now — interrupt the host"
            : "Listen now"
        : turnPhase === "transcribing"
          ? "Transcribing…"
          : turnPhase === "sending"
            ? "Sending…"
            : turnPhase === "agent-busy"
              ? "Agent working…"
              : "Talk (microphone)";
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
        : hostSpeaking
          ? "Host is speaking — the mic opens when the line finishes."
          : livePreview?.status === "confirmed"
            ? "Done — painted and confirmed."
            : "Talk or type a command — the canvas moves as you speak.";
  const shownTranscript = lastTranscript || view.transcript;
  // The pending-turn check: a completed turn that changed nothing (and is
  // not a re-pick, which already acknowledged) surfaces a visible error.
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

  // A confirmed preview is a receipt, not a permanent banner: clear it
  // after a beat so the deck returns to the live transcript / prompt.
  useEffect(() => {
    if (!livePreview || livePreview.status !== "confirmed") return;
    const timer = setTimeout(() => setLivePreview(null), 4000);
    return () => clearTimeout(timer);
  }, [livePreview]);

  // A travel cinematic is a moment, not a mode: clear it after the CSS
  // animation (2.6s) even if the browser throttles the animation itself.
  useEffect(() => {
    if (!travel) return;
    const timer = setTimeout(() => setTravel(null), 2600);
    return () => clearTimeout(timer);
  }, [travel]);

  // Shell wiring: the mission clock, following the beat into the systems
  // rail, switching the viewport when the walk moves from orbit to ground,
  // and keyboard shortcuts (Space = talk, 1–6 = systems, Esc = close).
  useEffect(() => {
    const id = setInterval(() => setMissionClock((seconds) => seconds + 1), 1000);
    return () => clearInterval(id);
  }, []);

  const toggleRecordingRef = useRef<() => void>(() => {});
  useEffect(() => {
    toggleRecordingRef.current = () => {
      void toggleRecording();
    };
  });

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey) return;
      const target = event.target instanceof HTMLElement ? event.target : null;
      // Never steal keys from a text field or a contenteditable surface.
      if (target?.closest("input, textarea, select, [contenteditable='true']")) return;
      if (event.code === "Space") {
        // Space on a button/link is that control's activation key.
        if (target?.closest("button, a")) return;
        event.preventDefault();
        toggleRecordingRef.current();
        return;
      }
      if (event.key >= "1" && event.key <= "6") {
        const shortcut = MODULES[Number(event.key) - 1];
        if (shortcut) {
          setActiveModule(shortcut.id);
          if (shortcut.optional) setArchiveOpen(true);
          playCue("highlight");
        }
        return;
      }
      if (event.key === "Escape") setDockOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const structures = colonyProgress(view.checklist);
  const flight = flightPlan(view, activeModule);
  // Judge view: four required missions stay in the open; the two
  // optional archive systems and the detailed plan stay tucked away.
  const requiredFlight = flight.filter((step) => !step.optional);
  const archiveFlight = flight.filter((step) => step.optional);
  const requiredModules = MODULES.filter((module) => !module.optional);
  const archiveModules = MODULES.filter((module) => module.optional);
  const activeMeta = moduleFor(activeModule);
  const activeStep = flight.find((step) => step.id === activeModule) ?? flight[0];
  const clockLabel = formatClock(missionClock);
  const equityLabel = view.founders.map((founder) => `${founder.percent}%`).join(" / ");
  const homeBase = view.selectedJurisdiction ?? "UNSET";
  const ship = shipLabel(view);
  const travelColor = travel
    ? `#${colonyPalette(travel.planet).accent.toString(16).padStart(6, "0")}`
    : "#7fe7ff";
  const canSend = !recording && !transcribing && !sending && !isLoading;
  const nextChecklistId = view.checklist.find((item) => !item.done)?.id ?? null;

  function selectStage(tab: "galaxy" | "colony") {
    setStageTab(tab);
    playCue("highlight");
  }

  function selectModule(id: SharedState["currentBeat"]) {
    setActiveModule(id);
    if (moduleFor(id).optional) setArchiveOpen(true);
    playCue("highlight");
  }


  return (
    <main className="game" data-stage={stageTab}>
      <header className="hud" aria-label="Mission header">
        <div className="brand">
          <span className="brand-orb-wrap" aria-hidden="true">
            <span className="brand-spin" />
            <span className="brand-mark">
              <span />
            </span>
          </span>
          <div className="brand-text">
            <p className="eyebrow">VVB-01 · ORBITAL FOUNDRY</p>
            <h1>Visual Vocal Builder</h1>
          </div>
        </div>

        <div className="hud-mission" aria-label={`${doneCount} of ${progress.requiredTotal} missions complete`}>
          <span className="hud-kicker">4 MISSIONS</span>
          <div className="hud-pips" role="group" aria-label="Required missions">
            {REQUIRED_BEATS.map((beat) => {
              const step = flight.find((entry) => entry.id === beat);
              const meta = moduleFor(beat);
              return (
                <button
                  key={beat}
                  type="button"
                  className={`hud-pip is-${step?.status ?? "pending"}`}
                  data-testid={`hud-pip-${beat}`}
                  aria-pressed={activeModule === beat}
                  onClick={() => selectModule(beat)}
                  title={`${meta.label} — ${step ? flightStatusLabel(step.status) : "PENDING"}`}
                >
                  <span className={`pip is-${step?.status ?? "pending"}`} aria-hidden="true" />
                  <span className="hud-pip-label">{meta.short}</span>
                </button>
              );
            })}
          </div>
          <strong className="hud-count">
            {doneCount}
            <span>/{progress.requiredTotal}</span>
          </strong>
        </div>
      </header>

      <div className="bridge">
        <aside className="rail rail-mission" aria-label="Mission control">
          {equityConfirm ? (
            <section
              className="panel objective objective-confirm"
              data-testid="mission-banner"
              data-equity-confirm="true"
              data-beat="equity"
              data-celebrated="false"
            >
              <div className="objective-head">
                <span className="eyebrow">CONFIRM CREW SPLIT</span>
                <span className="objective-step">2/4</span>
              </div>
              <h2>
                {view.founders.length} owner{view.founders.length === 1 ? "" : "s"} — {equityLabel}
              </h2>
              <p className="objective-prompt">
                Does this split look right? Confirm to move on, or choose another owner count / drag a slider.
              </p>
              <div className="confirm-actions" data-testid="equity-confirm">
                <button
                  type="button"
                  className="btn btn-primary"
                  data-testid="confirm-equity"
                  onClick={confirmEquitySelection}
                >
                  CONFIRM SPLIT
                </button>
                <button
                  type="button"
                  className="btn"
                  data-testid="edit-equity"
                  onClick={() => selectModule("equity")}
                >
                  KEEP EDITING
                </button>
              </div>
              <p className="objective-build-hint">Or say “confirm” / “change”.</p>
            </section>
          ) : (
          <section
            className="panel objective"
            data-testid="mission-banner"
            data-beat={mission.beat}
            data-celebrated={celebrated ? "true" : "false"}
          >
            <div className="objective-head">
              <span className="eyebrow">CURRENT OBJECTIVE</span>
              <span className="objective-step">
                {mission.step}/{mission.total}
              </span>
            </div>
            <h2>{mission.title}</h2>
            <p data-testid="mission-prompt" className="objective-prompt">
              {mission.prompt}
            </p>
            <div className="objective-meter" aria-hidden="true">
              <span style={{ width: `${Math.round((doneCount / progress.requiredTotal) * 100)}%` }} />
            </div>

            {/* The build mission is the one required task where the user
                has to choose among five steps. Keep the five options and
                the running 0/5..5/5 count in the left rail, not only in
                the systems panel, so the spoken question has visible
                answers. Clicks use the same updateChecklistItem path. */}
            {mission.beat === "checklist" ? (
              <BuildQueuePanel
                items={view.checklist}
                built={structures.built}
                total={structures.total}
                percent={structures.percent}
                nextItemId={nextChecklistId}
                onToggle={updateChecklistItem}
              />
            ) : null}

            {celebrated ? (
              <p data-testid="mission-celebrated" className="celebrate" role="status">
                {celebrated}
              </p>
            ) : null}

            {/* The four required missions are the only steps in the open.
                The detailed flight plan, its optional archive rows, and the
                mission chips live behind one disclosure. */}
            <details className="objective-more">
              <summary>
                <span className="eyebrow">PLAN &amp; QUICK ACTIONS</span>
                <span className="panel-note">
                  {doneCount}/{progress.requiredTotal} CLEARED
                </span>
              </summary>
              <div className="objective-more-body">
                <div className="chip-row">
                  {mission.chips.map((chip) => (
                    <button
                      key={chip.label}
                      type="button"
                      className="chip-btn"
                      data-testid={`mission-chip-${chip.label}`}
                      disabled={!canSend}
                      onClick={async () => {
                        await sendToAgent(chip.command);
                      }}
                    >
                      {chip.label}
                    </button>
                  ))}
                </div>
                <ol className="flight-list flight-list-compact" aria-label="Four-mission flight plan">
                  {requiredFlight.map((step) => (
                    <li key={step.id} className={`flight-item is-${step.status}`}>
                      <button
                        type="button"
                        onClick={() => selectModule(step.id)}
                        aria-pressed={activeModule === step.id}
                        data-testid={`flight-step-${step.id}`}
                      >
                        <span className="flight-code">{step.code}</span>
                        <span className="flight-main">
                          <strong>{step.label}</strong>
                          <span>{step.detail}</span>
                        </span>
                        <span className="flight-status">{flightStatusLabel(step.status)}</span>
                      </button>
                    </li>
                  ))}
                </ol>
                <details className="plan-archive">
                  <summary>
                    <span className="eyebrow">ARCHIVE · S.85 / FEES</span>
                    <span className="panel-note">OPTIONAL</span>
                  </summary>
                  <ol className="flight-list flight-list-compact" aria-label="Optional archive">
                    {archiveFlight.map((step) => (
                      <li key={step.id} className={`flight-item is-${step.status}`}>
                        <button
                          type="button"
                          onClick={() => selectModule(step.id)}
                          aria-pressed={activeModule === step.id}
                          data-testid={`flight-step-${step.id}`}
                        >
                          <span className="flight-code">{step.code}</span>
                          <span className="flight-main">
                            <strong>{step.label}</strong>
                            <span>{step.detail}</span>
                          </span>
                          <span className="flight-status">{flightStatusLabel(step.status)}</span>
                        </button>
                      </li>
                    ))}
                  </ol>
                </details>
              </div>
            </details>
          </section>
          )}
        </aside>

        <section className="stage" aria-label="Ship viewport">
          <div className="stage-head">
            <div className="stage-tabs" role="tablist" aria-label="Viewport">
              <button
                type="button"
                role="tab"
                aria-selected={stageTab === "galaxy"}
                className={stageTab === "galaxy" ? "is-active" : ""}
                onClick={() => selectStage("galaxy")}
              >
                STAR MAP
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={stageTab === "colony"}
                className={stageTab === "colony" ? "is-active" : ""}
                onClick={() => selectStage("colony")}
              >
                COLONY
              </button>
            </div>
            <div className="stage-live">
              <span className="live-dot" aria-hidden="true" />
              LIVE FEED
              <span className="stage-clock">T+{clockLabel}</span>
            </div>
          </div>

          <div className="stage-viewport">
            <div className="stage-scene-wrap" hidden={stageTab !== "galaxy"}>
              <GalaxyHero
                rows={view.jurisdictions}
                selected={view.selectedJurisdiction}
                onSelect={handleSelectJurisdiction}
              />
            </div>
            <div className="stage-scene-wrap" hidden={stageTab !== "colony"}>
              <ColonyView
                selected={view.selectedJurisdiction}
                checklist={view.checklist}
                founders={view.founders}
                lawyerPackage={view.lawyerPackage}
              />
            </div>
            <span className="reticle" aria-hidden="true" />
            <span className="scanlines" aria-hidden="true" />
          </div>

          <div className="stage-foot">
            <span>
              HOME BASE <strong>{homeBase}</strong>
            </span>
            <span>
              COLONY{" "}
              <strong>
                {structures.built}/{structures.total}
              </strong>
            </span>
            <span>
              CREW <strong>{equityLabel}</strong>
            </span>
            <span>
              SHIP <strong data-testid="ship-name">{ship}</strong>
            </span>
            <span>
              PHASE <strong>{activeMeta.label.toUpperCase()}</strong>
            </span>
          </div>

          {travel ? (
            <div className="warp" key={travel.id} data-testid="warp-transition">
              <div className="warp-stars warp-stars-a" aria-hidden="true" />
              <div className="warp-stars warp-stars-b" aria-hidden="true" />
              <div className="warp-flash" aria-hidden="true" />
              <div className="warp-target" aria-hidden="true">
                <span
                  className="warp-planet"
                  style={{
                    background: `radial-gradient(circle at 34% 30%, #fff 0 5%, ${travelColor} 36%, #0b1026 100%)`,
                    boxShadow: `0 0 70px ${travelColor}`,
                  }}
                />
                <span className="warp-ring" />
              </div>
              <div className="warp-rocket" aria-hidden="true">
                <svg viewBox="0 0 64 64" width="64" height="64">
                  <path
                    d="M32 4c8 7 12 17 12 28l-6 8H26l-6-8C20 21 24 11 32 4Z"
                    fill="#e9eeff"
                    stroke="#7fe7ff"
                    strokeWidth="1.6"
                  />
                  <circle cx="32" cy="24" r="5" fill="#08101f" stroke="#ffd166" strokeWidth="2" />
                  <path d="M26 40 18 52l10-3M38 40l8 12-10-3" fill="#ff6b7a" />
                  <path d="M32 46v13" stroke="#ffd166" strokeWidth="4" strokeLinecap="round" />
                </svg>
              </div>
              <div className="warp-copy" role="status">
                <span className="eyebrow">COURSE LOCKED</span>
                <strong>{travel.planet}</strong>
                <span className="warp-sub">ENTERING ORBIT</span>
              </div>
            </div>
          ) : null}
        </section>

        <aside className="rail rail-systems" aria-label="Ship systems">
          <div className="systems-nav">
            <div className="module-tabs is-core" role="tablist" aria-label="Four required missions">
              {requiredModules.map((entry) => {
                const step = flight.find((item) => item.id === entry.id);
                return (
                  <button
                    key={entry.id}
                    type="button"
                    role="tab"
                    aria-selected={activeModule === entry.id}
                    className={`module-tab is-${step?.status ?? "pending"}`}
                    onClick={() => selectModule(entry.id)}
                    title={entry.blurb}
                  >
                    <span className="module-glyph" aria-hidden="true">
                      {entry.glyph}
                    </span>
                    <span className="module-label">{entry.short}</span>
                    <span className="module-dot" aria-hidden="true" />
                  </button>
                );
              })}
            </div>

            <details
              className="archive-tabs"
              data-testid="archive-tabs"
              open={archiveOpen}
              onToggle={(event) => setArchiveOpen(event.currentTarget.open)}
            >
              <summary>
                <span className="archive-title">ARCHIVE</span>
                <span className="archive-note">S.85 · FEES · OPTIONAL</span>
                <span className="integrity-chevron" aria-hidden="true">
                  ⌄
                </span>
              </summary>
              <div className="module-tabs is-archive" role="tablist" aria-label="Optional archive systems">
                {archiveModules.map((entry) => {
                  const step = flight.find((item) => item.id === entry.id);
                  return (
                    <button
                      key={entry.id}
                      type="button"
                      role="tab"
                      aria-selected={activeModule === entry.id}
                      className={`module-tab is-${step?.status ?? "pending"}`}
                      onClick={() => selectModule(entry.id)}
                      title={entry.blurb}
                    >
                      <span className="module-glyph" aria-hidden="true">
                        {entry.glyph}
                      </span>
                      <span className="module-label">{entry.short}</span>
                      <span className="module-dot" aria-hidden="true" />
                    </button>
                  );
                })}
              </div>
            </details>
          </div>

          <div className="panel module-panel" data-active-module={activeModule}>
            <div className="module-head">
              <span className="eyebrow">
                SYSTEM {activeMeta.code} · {activeMeta.label.toUpperCase()}
              </span>
              <span className={`chip chip-${activeStep.status}`}>
                {flightStatusLabel(activeStep.status)}
              </span>
            </div>

            <div data-beat="jurisdiction" hidden={activeModule !== "jurisdiction"}>
              <JurisdictionTable
                rows={view.jurisdictions}
                selected={view.selectedJurisdiction}
                focus={view.focusJurisdiction}
                focusReason={view.focusReason}
                onSelect={handleSelectJurisdiction}
              />
            </div>

            <div data-beat="equity" hidden={activeModule !== "equity"}>
              <EquitySlider
                founders={view.founders}
                equityNote={view.equityNote}
                onShareChange={(index, percent) => updateEquity(index, percent, "slider")}
                onOwnerCountChange={updateOwnerCount}
              />
            </div>

            <div data-beat="checklist" hidden={activeModule !== "checklist"}>
              <FilingChecklist
                items={view.checklist}
                onToggle={updateChecklistItem}
                flags={checklistFlags}
              />
            </div>

            <div data-beat="rollover" hidden={activeModule !== "rollover"}>
              <RolloverFactCard
                card={view.rolloverCard}
                rolloverNote={view.rolloverNote}
                flagReason={rolloverFlag ? `${rolloverFlag.reason}: ${rolloverFlag.detail}` : null}
              />
            </div>

            <div data-beat="filingsteps" hidden={activeModule !== "filingsteps"}>
              <FilingSteps
                card={view.filingStepsCard}
                filingStepsNote={view.filingStepsNote}
                flagReason={filingFlag ? `${filingFlag.reason}: ${filingFlag.detail}` : null}
              />
            </div>

            <div data-beat="summary" hidden={activeModule !== "summary"}>
              <LawyerSummary
                view={view}
                companyName={DEMO_COMPANY_NAME}
                lawyerPackage={view.lawyerPackage}
                lawyerNote={view.lawyerNote}
                onPrepare={prepareLawyerPackage}
              />
            </div>
          </div>

          <TrustStrip result={verification} />
        </aside>
      </div>

      <footer className="deck" data-testid="command-deck" data-phase={turnPhase}>
        {dockOpen ? (
          <div className="deck-popout" data-testid="dock-popout">
            <div className="popout-head">
              <span className="eyebrow">FLIGHT CONTROLS</span>
              <button type="button" className="link-btn" onClick={() => setDockOpen(false)}>
                CLOSE
              </button>
            </div>
            <div className="popout-grid">
              <button
                type="button"
                className="btn"
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
                Conversation auto-listen: {convoOn ? "on" : "off"}
              </button>
              <button
                type="button"
                className="btn"
                data-testid="restart-conversation"
                onClick={() => window.location.reload()}
              >
                Restart conversation
              </button>
            </div>

            <div className="popout-section">
              <span className="eyebrow">QUICK COMMANDS</span>
              <div className="popout-chips">
                {EXAMPLE_COMMANDS.map((chip) => (
                  <button
                    key={chip.label}
                    type="button"
                    className="chip-btn"
                    data-testid={`example-chip-${chip.label}`}
                    disabled={!canSend}
                    onClick={async () => {
                      await sendToAgent(chip.command);
                    }}
                  >
                    {chip.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="popout-section">
              <span className="eyebrow">VOICE &amp; SOUND</span>
              <div className="popout-grid">
                <button
                  type="button"
                  className="hud-btn"
                  data-testid="sound-toggle"
                  aria-pressed={soundOn}
                  onClick={() => setSoundOn((value) => !value)}
                >
                  <span aria-hidden="true">{soundOn ? "◉" : "○"}</span> SFX
                </button>
                <button
                  type="button"
                  className="hud-btn"
                  data-testid="voice-toggle"
                  aria-pressed={voiceOn}
                  onClick={() => {
                    if (voiceOn) cancelSpeech();
                    setVoiceOn((value) => !value);
                  }}
                >
                  <span aria-hidden="true">{voiceOn ? "◉" : "○"}</span> VOX
                </button>
              </div>
              <HostVoicePicker
                voiceOn={voiceOn}
                onSelect={selectHostVoice}
                onPreview={previewHostVoice}
              />
              <p className="popout-clock" aria-label={`Mission clock ${clockLabel}`}>
                MISSION CLOCK T+{clockLabel}
              </p>
            </div>

            <p data-testid="recording-hint" className="micro">
              Say one short command — it paints live as you speak and sends itself when you pause.
              Space starts the mic; 1–6 opens a system panel.
            </p>
            {shownTranscript ? (
              <p data-testid="last-transcript" className="micro">
                Last transcript: <q>{shownTranscript}</q>
              </p>
            ) : null}
          </div>
        ) : null}

        <div className="deck-status">
          <span data-testid="turn-phase" role="status" className={`deck-phase phase-${turnPhase}`}>
            {turnPhase === "recording"
              ? "Recording…"
              : turnPhase === "transcribing"
                ? "Transcribing…"
                : turnPhase === "sending"
                  ? "Sending…"
                  : turnPhase === "agent-busy"
                    ? `Agent working… ${elapsed}s`
                    : "Ready"}
          </span>
          <span data-testid="convo-status" className="deck-convo" role="status">
            {convoActive
              ? recording
                ? "CONVERSATION LIVE — LISTENING"
                : hostSpeaking
                  ? "HOST SPEAKING — MIC WILL OPEN"
                  : busy
                    ? "CONVERSATION LIVE — AGENT ANSWERING"
                    : "CONVERSATION LIVE — MIC STANDBY"
              : "CONVERSATION OFF — PRESS TALK"}
          </span>
          <span data-testid="flow-status" className="deck-flow" role="status">
            {flowStatus}
          </span>
          {!voiceOn ? (
            <span className="deck-vox-off" data-testid="vox-off" role="status">
              VOX OFF
            </span>
          ) : null}
        </div>

        <div className="deck-host" data-testid="host-prompt" aria-label="Host prompt">
          <span className="deck-host-label">HOST · LIVE</span>
          <p data-testid="host-prompt-text" className="deck-host-text" title={hostPrompt.text}>
            {hostPrompt.text}
          </p>
          {ack ? (
            <p data-testid="host-ack" className="deck-host-ack" role="status">
              {ack}
            </p>
          ) : null}
          <span
            className="deck-host-note"
            title="Host speech is unverified conversation, not a grounded fact card."
          >
            unverified speech
          </span>
        </div>

        {turnError ? (
          <p data-testid="turn-error" className="alert" role="alert">
            {turnError}
          </p>
        ) : null}
        {transcribeFailure ? (
          <div data-testid="transcribe-failure" className="alert">
            <p role="alert">
              {transcribeFailure.plain}{" "}
              <span data-testid="transcribe-failure-detail">
                Transcribe failed: {transcribeFailure.detail}
              </span>
            </p>
            {hasLastAudio ? (
              <button
                type="button"
                className="btn"
                data-testid="retry-transcribe"
                disabled={recording || transcribing || sending || isLoading}
                onClick={retryTranscribe}
              >
                Retry
              </button>
            ) : (
              <p data-testid="typed-fallback-hint" className="micro">
                Type the command below to send it without voice.
              </p>
            )}
          </div>
        ) : null}
        {notice ? <p className="deck-notice">{notice}</p> : null}

        <div className="deck-main">
          <button
            type="button"
            className={`mic-orb${recording ? " is-live" : ""}${convoActive ? " is-convo" : ""}`}
            data-testid="mic-button"
            onClick={() => {
              void toggleRecording();
            }}
            disabled={!recording && !convoActive && (transcribing || sending || isLoading)}
            aria-label={micLabel}
            title={micLabel}
          >
            <span className="mic-ring" aria-hidden="true" />
            <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
              <path
                d="M12 15a4 4 0 0 0 4-4V6a4 4 0 0 0-8 0v5a4 4 0 0 0 4 4Z"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.7"
              />
              <path
                d="M5 11a7 7 0 0 0 14 0M12 18v3"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.7"
                strokeLinecap="round"
              />
            </svg>
            <span className="mic-caption">
              {recording ? "STOP" : convoActive && busy ? "WAIT" : "TALK"}
            </span>
          </button>

          <div className="deck-readout">
            <div className="deck-kicker">
              <span className="deck-mode">{convoActive ? "CONVERSATION" : "PUSH TO TALK"}</span>
              <span className="deck-hint">SPACE to talk · 1–6 systems</span>
            </div>
            <p className="transcript-line" data-testid="live-transcript">
              {recording && liveTranscript ? (
                <>
                  <span className="live-label">HEARD</span> <q>{liveTranscript}</q>
                </>
              ) : shownTranscript ? (
                <>
                  <span className="live-label">LAST</span> <q>{shownTranscript}</q>
                </>
              ) : (
                <span className="is-dim">Say “Pick Mars” — the canvas moves as you speak.</span>
              )}
            </p>

            {recording || livePreview ? (
              <div data-testid="live-voice-panel" className="live-panel">
                {recording ? (
                  <div
                    data-testid="mic-meter"
                    className="meter"
                    aria-label={`Microphone level, recording ${recordSeconds} seconds`}
                  >
                    {[0.15, 0.35, 0.55, 0.75, 0.95].map((bar) => (
                      <span key={bar} className={micLevel >= bar ? "is-on" : ""} />
                    ))}
                    <span className="meter-time">
                      ● {recordSeconds}s {micLevel > 0.05 ? "— HEARING YOU" : "— LISTENING"}
                    </span>
                  </div>
                ) : null}
                {livePreview ? (
                  <p data-testid="live-preview" className="live-preview" role="status">
                    {livePreview.status === "confirmed"
                      ? `Confirmed — ${livePreview.label.replace(/…$/, "")}`
                      : `${livePreview.label}${
                          livePreview.status === "confirming" ? " · confirming" : " · provisional"
                        }`}
                  </p>
                ) : null}
              </div>
            ) : null}
          </div>

          <div className="deck-input">
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
              aria-label="Type a command for the agent"
            />
            <button
              type="button"
              className="btn btn-primary"
              disabled={!canSend || !typed.trim()}
              onClick={async () => {
                await sendToAgent(typed);
                setTyped("");
              }}
            >
              {busy ? "WORKING" : "SEND"}
            </button>
          </div>

          <div className="deck-tools">
            <button
              type="button"
              className="btn"
              data-testid="undo-button"
              disabled={historySize === 0}
              onClick={() => {
                undoLast();
              }}
            >
              UNDO
            </button>
            <button
              type="button"
              className="btn"
              data-testid="dock-expand"
              aria-expanded={dockOpen}
              aria-label="Controls — host voice, sound, quick commands"
              title="Controls — host voice, sound, quick commands"
              onClick={toggleControls}
            >
              {dockOpen ? "CLOSE" : "CONTROLS"}
            </button>
          </div>
        </div>

        <p className="deck-legal">
          DEMO ONLY · NOT LEGAL ADVICE · NOT A FILING · NOTHING SUBMITTED · NO EMAIL
        </p>
      </footer>
    </main>
  );

}

export default function CanvasHost() {
  return (
    <CopilotKit
      runtimeUrl="/api/copilotkit"
      showDevConsole={false}
      enableInspector={false}
      headers={() => ({
        "X-Voice-Turn": activeVoiceTurnRef.current ? "1" : "0",
      })}
    >
      <Canvas />
    </CopilotKit>
  );
}
