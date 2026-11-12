"use client";

import { useEffect, useRef, useState } from "react";
import {
  CopilotKitProvider,
  UseAgentUpdate,
  useAgent,
  useAgentContext,
  useCopilotKit,
  useFrontendTool,
} from "@copilotkit/react-core/v2";
import { z } from "zod";
import ControlsPopout from "./ControlsPopout";
import DeckMain from "./DeckMain";
import DeckStatus from "./DeckStatus";
import TranscriptPanel from "./TranscriptPanel";
import { useBrowserVoiceChoice } from "./hooks/useBrowserVoiceChoice";
import { useNeuralPlayback } from "./hooks/useNeuralPlayback";
import { useSoundCues } from "./hooks/useSoundCues";
import { useHostSpeech } from "./hooks/useHostSpeech";
import { useTurnStore } from "./hooks/useTurnStore";
import { useMicCapture, type MicBlock } from "./hooks/useMicCapture";
import { canRearm, isBusy, micHot } from "../lib/turn-machine";
import HudHeader from "./HudHeader";
import MissionObjective from "./MissionObjective";
import ShipViewport from "./ShipViewport";
import SystemsRail from "./SystemsRail";
import {
  DEMO_COMPANY_NAME,
  DEMO_JURISDICTIONS,
} from "../lib/demo-data";
import { FILING_STEPS_PACK } from "../lib/knowledge";
import type { SharedState } from "../lib/state";
import { verifyPaintedCards } from "../lib/verifier";
import { getHostQuestion, resolveHostPrompt, shortFounderNames, shouldSpeakFallbackQuestion, type Beat } from "../lib/host-questions";
import { buildGuideLine, buildQuestionLine, buildRaisedLine, equityConfirmationLine, nameApprovedLine, nextObjectiveHostLine } from "../lib/build-host";
import { isChangeAnswer, isConfirmationAnswer } from "../lib/confirmation";
import { FILING_GUARD_REPLY, isFilingGuardQuestion } from "../lib/filing-guard";
import { DEFAULT_VOICE_SETTINGS, applyVoiceControl, normalizeVoiceSettings, parseVoiceControl, type VoiceControl, type VoiceSettings } from "../lib/voice-controls";
import { clearSavedSession, progressSummary, saveSession, type TranscriptEntry } from "../lib/persistence";
import { resumeSummary } from "../lib/resume";
import { withCommander } from "../lib/commander";
import { DOWNLOAD_BLOCKED_LINE, downloadedLine, planDownload, type DownloadKind } from "../lib/downloads";
import { FIRST_SPEAK_GREETING, hasFirstSpeakGreeting, markFirstSpeakGreeting } from "../lib/first-speak";
import { AGENT_ACTIONS } from "../lib/agent-actions";
import { withDefaults, resolveFounderIndex, applyEquity, applyChecklistItem, applyChecklistItems, applyAdvanceChecklist, applyJurisdiction, applyFilingSteps, applyLawyerSummary, applyFocusJurisdiction, applyStartOver, cheapestByNumber, applyOwnerCount, applyChecklistCount, applyCompanyName, parseSpokenCompanyName } from "../lib/state-updates";
import { pushHistory, popHistory, statesEqual, type HistoryEntry } from "../lib/history";
import { describeChange, currentStateSummary } from "../lib/describe-change";
import { beatProgress } from "../lib/beat-progress";
import {
  captionPhase,
  heardCaption,
  heardCaptionState,
  hostCaption,
} from "../lib/captions";
import {
  RECOVERY_REARM_MS,
  RecoveryTracker,
  recoveryNotice,
  isListeningStall,
  type RecoveryNotice,
} from "../lib/recovery";
import {
  CONTINUATION_GRACE_MS,
  mergeContinuation,
} from "../lib/slow-speech";
import {
  SUMMARY_READY_LINE,
  SUMMARY_START_LINE,
  SUMMARY_STEP_MS,
  nextSummaryProgress,
} from "../lib/summary-build";
import CaptionHistory from "./CaptionHistory";
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
import { micFailureNotice } from "../lib/mic";
import { isCompanyNameQuestion, companyNameReply, isNameApproval, isNameCancel } from "../lib/checklist-answers";
import { turnResultSignature } from "../lib/scroll";
import confetti from "canvas-confetti";
import { MAX_PCM_BYTES } from "../lib/request-guard";
import { parseLiveIntent, nextVoiceActivity, shouldAutoStop, autoStopSilence, IDLE_ACTIVITY, MIN_SPEECH_MS, type LiveIntent, type VoiceActivity } from "../lib/live-intent";
import { queueTurn, flushQueuedTurn, QUEUED_TURN_NOTICE } from "../lib/turn-queue";
import { AnnouncementBudget } from "../lib/announcements";
import { cueForChange, type CueName } from "../lib/sound-cues";
import { missionFor } from "../lib/mission";
import { colonyPalette, colonyProgress } from "../lib/colony";
import { MODULES, flightPlan, formatClock, moduleFor, shipLabel } from "../lib/game-ui";
import { spokenHostText } from "../lib/spoken-text";
import { stripAsrAnnotations } from "../lib/transcript";
import { resolveVoiceFinal } from "../lib/voice-final";
import { TOOL_TIMEOUT_MS, ToolTimeoutError, toolTimeoutLine, withToolTimeout } from "../lib/tool-timeout";
import { summarizeTimings, type TurnTimings } from "../lib/turn-timing";
import { HybridEndpointer } from "../lib/voice/hybrid-endpointer";
import { speechQueue } from "../lib/voice/surviving-speech-queue";
import { echoFilter } from "../lib/voice/echo-filter";
import { currentProviderInfo, loadProviderInfo } from "../lib/provider-client";
import { hostTts } from "../lib/host-tts";




// The host voice is the browser/OS system voice. The picker stores a
// voiceURI (not an index) so it survives OS updates; a stale URI falls
// back to the curated automatic pick. The storage key lives in
// lib/voice-select.ts so the picker and the speech path agree.

// The canvas is the interface: tool calls do not need a second chat card.
// v2 frontend tools render nothing unless a renderer is registered, so no
// placeholder renderer is needed — the visible cockpit stays untouched.

// Clear, deterministic commands are handled locally. They still use the
// exact same state appliers as the agent; skipping the model only removes
// the 3–19 s think time, not any grounding or invariant work.
const FAST_INTENT_KINDS: ReadonlySet<LiveIntent["kind"]> = new Set([
  "jurisdiction",
  "equity",
  "equity-split",
  "checklist-advance",
  "owner-count",
  "cheapest",
  "undo",
  "start-over",
  "lawyer-summary",
]);

const activeVoiceTurnRef = { current: false };

export type CanvasProps = {
  autoStart?: boolean;
  resumed?: boolean;
  initialState?: Partial<SharedState> | null;
  initialSettings?: Partial<VoiceSettings> | null;
  initialLog?: TranscriptEntry[] | null;
};

function Canvas({ autoStart = false, resumed = false, initialState, initialSettings, initialLog }: CanvasProps) {
  const [bootState] = useState<SharedState>(() => withDefaults(initialState));
  const [bootSettings] = useState<VoiceSettings>(() =>
    normalizeVoiceSettings(initialSettings ?? DEFAULT_VOICE_SETTINGS),
  );
  const { agent, isReady: agentReady } = useAgent({
    agentId: "vvb",
    updates: [
      UseAgentUpdate.OnStateChanged,
      UseAgentUpdate.OnMessagesChanged,
      UseAgentUpdate.OnRunStatusChanged,
    ],
  });
  const { copilotkit } = useCopilotKit();
  // v2 has no useCoAgent initialState: seed the runtime copy once the real
  // agent is ready, retrying across renders until the seed lands.
  const seededRef = useRef(false);
  useEffect(() => {
    if (seededRef.current || !agentReady || !agent) return;
    try {
      agent.setState(bootState as unknown as Record<string, unknown>);
      seededRef.current = true;
    } catch {
      // Provisional agent or a mid-connect swap — retry on the next render.
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agent, agentReady]);
  const state = (
    agent?.state as unknown as SharedState | undefined
  ) ?? undefined;
  function setState(next: SharedState) {
    agent?.setState(next as unknown as Record<string, unknown>);
  }
  // The canvas renders from a local authoritative copy. The runtime
  // agent state can land a beat after mount; in a voice-first flow the
  // user may already have spoken, and that late initial sync must never
  // erase a real selection (the "Mars locked in" line with an UNSET board
  // bug). Once this session writes locally, the local copy wins and the
  // agent is kept in sync through setState.
  const [localState, setLocalState] = useState<SharedState>(bootState);
  // A resumed boot is already authoritative: do not let a late initial
  // agent sync replace the saved run with an empty starting state.
  const localTouchedRef = useRef(Boolean(initialState));
  const view = localState;
  useEffect(() => {
    if (localTouchedRef.current || !state) return;
    const external = withDefaults(state);
    if (!statesEqual(external, stateRef.current)) {
      stateRef.current = external;
      setLocalState(external);
    }
  }, [state]);
  // Day 5: separate verifier over the painted cards (pure, on state
  // change, outside the voice turn path — it never blocks a turn).
  const verification = verifyPaintedCards(view);
  const filingFlag = verification.verdicts.find(
    (v) => v.cardKind === "filingSteps" && v.status === "flagged",
  );
  const checklistFlags: Record<string, string> = {};
  for (const v of verification.verdicts) {
    if (v.cardKind === "checklist" && v.status === "flagged") {
      checklistFlags[v.cardId] = `${v.reason}: ${v.detail}`;
    }
  }
  // v2 agent wire: messages and run status come straight off the bound
  // agent; sending is addMessage + copilotkit.runAgent (which also runs
  // the registered frontend tools), stopping is abortRun.
  const messages = agent?.messages ?? [];
  const isLoading = agent?.isRunning ?? false;
  function stopGeneration() {
    agent?.abortRun();
  }
  // The conversation turn (lib/turn-machine.ts). turn.get() is the
  // synchronous truth for timers and audio callbacks; turnState renders.
  const { store: turn, state: turnState } = useTurnStore();
  // Capturing (the pipeline is live), not merely requested.
  const recording = turnState.mic === "open";
  // True while the host voice is actually speaking. The mic stays closed
  // during this window, and the deck says so instead of claiming LIVE.
  const hostSpeaking = turnState.hostSpeaking;
  // True during the gap between a host line ending (or a recovery) and the
  // mic reopening. The caption says MIC RE-ARMING instead of pretending LIVE.
  const rearming = turnState.rearm !== "none";
  // Conversation auto-listen: the mic re-opens by itself after each turn.
  const convoActive = turnState.convo;
  const [typed, setTyped] = useState("");
  const [notice, setNotice] = useState("");
  const [sending, setSending] = useState(false);
  const [transcribing, setTranscribing] = useState(false);
  const [lastTranscript, setLastTranscript] = useState("");
  const [ack, setAck] = useState("");
  // One polite live region for the short turn story ("Heard…" + result).
  // The per-turn budget keeps a screen reader from hearing every visual
  // status churn, while errors/notices keep their own alert/status roles.
  const [announcement, setAnnouncement] = useState<{ id: number; text: string } | null>(null);
  // A locally spoken host line for the deterministic fast lane. It also
  // becomes the visible host prompt, so the text and the voice agree.
  // A resumed run opens with the saved progress line on screen and spoken,
  // not the generic "prepare the summary" fallback for a summary that is
  // already prepared.
  const [localHost, setLocalHost] = useState(() =>
    resumed ? withCommander(resumeSummary(bootState)) : "",
  );
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
  const finishingRef = useRef(false);
  const messageIdRef = useRef(0);
  const activityRef = useRef<VoiceActivity>(IDLE_ACTIVITY);
  const previewKeyRef = useRef<string | null>(null);
  const committedKeyRef = useRef<string | null>(null);
  const webSpeechFailedRef = useRef(false);
  const recognitionRef = useRef<{ stop: () => void; onresult: unknown; onerror: unknown; onend: unknown } | null>(null);
  const liveTranscriptRef = useRef("");
  const confirmationTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const listeningStallShownRef = useRef(false);
  const noSpeechAttemptsRef = useRef(0);
  const asrSocketRef = useRef<WebSocket | null>(null);
  // Which engines the server is configured for (lib/provider.ts). Until
  // the answer arrives this is the safe default that works with either.
  const providerRef = useRef(currentProviderInfo());
  const streamingReadyRef = useRef(false);
  const activeTurnIdRef = useRef(0);
  const asrLastEventAtRef = useRef(0);
  const bufferedFallbackTurnRef = useRef<number | null>(null);
  const completedStreamingTurnRef = useRef<number | null>(null);
  const isTurnListeningRef = useRef(false);
  const announcementBudgetRef = useRef(new AnnouncementBudget());
  const announcementIdRef = useRef(0);
  const announceTurnRef = useRef(0);
  const lastAnnouncedOutcomeRef = useRef("");

  useEffect(() => {
    let alive = true;
    void loadProviderInfo().then((info) => {
      if (alive) providerRef.current = info;
    });
    return () => {
      alive = false;
    };
  }, []);

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
  // Voice settings are the single source for rate, volume, cues, pacing,
  // and on/off. They are changeable by voice and persisted with the run.
  const [settings, setSettings] = useState<VoiceSettings>(bootSettings);
  const settingsRef = useRef(settings);
  const voiceOn = settings.voiceOn;
  const soundOn = settings.soundOn;
  // Full transcript: every heard command and every host line, available
  // on screen and by voice ("show transcript").
  const [log, setLog] = useState<TranscriptEntry[]>(() => (initialLog ?? []).slice(-240));
  const logRef = useRef(log);
  useEffect(() => {
    logRef.current = log;
  }, [log]);
  const [transcriptOpen, setTranscriptOpen] = useState(false);
  const transcriptOpenRef = useRef(false);
  useEffect(() => {
    transcriptOpenRef.current = transcriptOpen;
  }, [transcriptOpen]);
  function setTranscriptVisibility(open: boolean) {
    transcriptOpenRef.current = open;
    setTranscriptOpen(open);
  }
  // Recovery is visible state, never a console-only warning. The tracker
  // counts consecutive recoveries so the copy can escalate while the mic
  // keeps re-arming (a paused mic is a stall in a hands-free loop).
  const [recovery, setRecovery] = useState<RecoveryNotice | null>(null);
  const recoveryTrackerRef = useRef(new RecoveryTracker());
  const recoveryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // A clearly unfinished final ("I would like to pick …") is held here
  // and merged with the next final instead of being sent as a command.
  const [continuation, setContinuation] = useState<{ text: string } | null>(null);
  const heldUtteranceRef = useRef<{ text: string; at: number } | null>(null);
  const continuationTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Async summary build: the package is prepared in short timer slices so
  // the voice loop and mic stay responsive. The caption shows progress;
  // the start and the finished package are both spoken.
  const [summaryBuild, setSummaryBuild] = useState<{ pct: number; ready: boolean } | null>(null);
  const summaryBuildRef = useRef<{ token: number; timer: ReturnType<typeof setTimeout> | null } | null>(null);
  const summaryBuildTokenRef = useRef(0);
  const summarySpeakTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const summaryDeliverAttemptsRef = useRef(0);
  const [savedNotice, setSavedNotice] = useState("");
  useEffect(() => {
    settingsRef.current = settings;
  }, [settings]);

  function updateVoiceSettings(patch: Partial<VoiceSettings>) {
    const next = normalizeVoiceSettings({ ...settingsRef.current, ...patch });
    settingsRef.current = next;
    setSettings(next);
    return next;
  }

  function appendLog(role: TranscriptEntry["role"], text: string) {
    const clean = (text ?? "").trim();
    if (!clean) return;
    setLog((prev) => {
      const last = prev[prev.length - 1];
      if (last && last.role === role && last.text === clean) return prev;
      return [...prev, { role, text: clean, at: Date.now() }].slice(-240);
    });
  }

  // The primary HEARD line follows the latest captured turn, including
  // controls and the early name approval. Without this, the log would
  // advance while the big caption stayed on the previous command.
  function recordHeardTurn(text: string) {
    const clean = (text ?? "").trim();
    if (!clean) return;
    setLiveTranscript(clean);
    setLastTranscript(clean);
    writeShared({ ...withDefaults(stateRef.current), transcript: clean });
  }

  // Recovery is a visible part of the loop: a clear headline, the fact
  // that nothing was changed, and one next step. The mic is re-armed by
  // the app; the user never has to find a button to get back in.
  function clearRecovery() {
    recoveryTrackerRef.current.clear();
    setRecovery(null);
    if (recoveryTimerRef.current !== null) {
      clearTimeout(recoveryTimerRef.current);
      recoveryTimerRef.current = null;
    }
    turn.dispatch({ type: "RECOVERY_CLEAR" });
  }

  function surfaceRecovery(kind: Parameters<typeof recoveryNotice>[0], detail = "") {
    const decision = recoveryTrackerRef.current.record(kind, detail);
    setRecovery(decision.notice);
    if (decision.escalate) {
      setNotice("Voice keeps dropping — the mic stays open. Say “help” if you want the control list.");
    }
    turn.dispatch({ type: "RECOVERY", kind, rearm: decision.rearm });
    if (turn.get().rearm !== "recovery") return;
    if (recoveryTimerRef.current !== null) clearTimeout(recoveryTimerRef.current);
    recoveryTimerRef.current = setTimeout(() => {
      recoveryTimerRef.current = null;
      // The machine applies the recovery rule (lib/turn-machine.ts
      // canRecoveryRearm): conversation on, mic closed, nothing in
      // flight, host quiet. It does not wait on the error it recovers.
      const before = turn.get();
      const after = turn.dispatch({ type: "REARM_FIRE", via: "recovery" });
      if (before.mic === "closed" && after.mic === "opening") void openMic();
    }, RECOVERY_REARM_MS);
  }

  // Slow speech can split one thought across two recognizer finals. Only
  // a final that is visibly unfinished is held; commands, questions, and
  // yes/no answers go straight through.
  function clearHeldUtterance() {
    heldUtteranceRef.current = null;
    setContinuation(null);
    if (continuationTimerRef.current !== null) {
      clearTimeout(continuationTimerRef.current);
      continuationTimerRef.current = null;
    }
  }

  function holdContinuation(text: string) {
    const clean = text.trim();
    if (!clean) return;
    heldUtteranceRef.current = { text: clean, at: performance.now() };
    setContinuation({ text: clean });
    setLiveTranscript(clean);
    setLastTranscript(clean);
    setNotice("");
    if (continuationTimerRef.current !== null) clearTimeout(continuationTimerRef.current);
    continuationTimerRef.current = setTimeout(() => {
      continuationTimerRef.current = null;
      if (!heldUtteranceRef.current) return;
      // Never send half a thought as a command. Keep the mic open and
      // say what is happening; the held words stay visible.
      setNotice("I caught the start of that. Finish the thought — I’m still listening.");
    }, CONTINUATION_GRACE_MS);
    requestRearm();
  }

  function takeHeldTranscript(nextText: string): string {
    const held = heldUtteranceRef.current;
    if (!held) return nextText;
    const withinGrace = performance.now() - held.at <= CONTINUATION_GRACE_MS;
    clearHeldUtterance();
    if (!withinGrace) return nextText;
    return mergeContinuation(held.text, nextText);
  }

  // One slow-speech decision for every speech path (Meta streaming, the
  // browser recogniser, buffered transcription). Returns the text to send,
  // or null when the final was held and the mic re-armed for the rest.
  function holdOrMerge(text: string): string | null {
    const decision = resolveVoiceFinal(text, heldUtteranceRef.current?.text);
    clearHeldUtterance();
    if (decision.action === "hold") {
      logEvent(`holding unfinished final ${JSON.stringify(decision.text)}`);
      holdContinuation(decision.text);
      return null;
    }
    return decision.text;
  }

  // Continuous conversation (OpenClaw pattern): talk, agent answers
  // out loud, mic re-opens by itself. On by default; a manual Stop
  // ends it. The full control set lives in a pop-out, not the bar.
  const [convoOn, setConvoOn] = useState(true);
  const [dockOpen, setDockOpen] = useState(false);
  // Game shell: which system panel is open, which viewport is up, and a
  // light mission clock. These are presentation state only — every fact
  // still comes from the same shared state and appliers.
  const [activeModule, setActiveModule] = useState<SharedState["currentBeat"]>(() => {
    const beat = missionFor(bootState).beat;
    // A completed saved run opens its launch package, keeping a legacy
    // saved beat from selecting a module that is no longer in the nav.
    return beat === "complete" ? "summary" : beat;
  });
  const [stageTab, setStageTab] = useState<"galaxy" | "colony">(
    bootState.selectedJurisdiction ? "colony" : "galaxy",
  );
  // Equity/owner changes pause here: the split is already applied through
  // the one invariant path, but the cockpit does not advance to BUILD
  // until the user confirms the visible split.
  const [equityConfirm, setEquityConfirm] = useState(false);
  // Optional filing archive is collapsed by default; opening it reveals
  // the fees reference, which never blocks the required walk.
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

  const endpointerRef = useRef<HybridEndpointer | null>(null);
  const equityConfirmRef = useRef(equityConfirm);
  useEffect(() => {
    equityConfirmRef.current = equityConfirm;
  }, [equityConfirm]);
  function logToolCall() {
    stampTiming("firstToolCall");
  }

  // Every agent tool runs through this timeout. A stalled tool surfaces
  // the same visible RECOVERY banner as any other dropped turn and returns
  // a plain result so the model can finish instead of hanging the loop.
  async function runTool(
    name: string,
    work: () => Promise<unknown> | unknown,
  ): Promise<unknown> {
    logToolCall();
    try {
      return await withToolTimeout(name, work);
    } catch (error) {
      if (error instanceof ToolTimeoutError) {
        const line = toolTimeoutLine(name, error.timeoutMs);
        setTurnError(line);
        surfaceRecovery("tool-timeout", line);
        return line;
      }
      throw error;
    }
  }

  // The conversation loop re-arms the mic only once the host has
  // finished speaking, so it never cancels the reply mid-flight.
  function isSpeechActive(): boolean {
    return host.isActive();
  }
  const [celebrated, setCelebrated] = useState("");
  const unlockedRef = useRef(false);
  // Host audio engines (components/hooks): Web Audio for the Gemini neural
  // voice, the browser/OS voice choice, and the synthesised sound cues.
  const neural = useNeuralPlayback(settingsRef, settings.volume);
  const voiceChoice = useBrowserVoiceChoice();
  const refreshCachedVoice = voiceChoice.refresh;
  const playCue = useSoundCues(settingsRef, unlockedRef);
  // The first TALK press is a greeting, not a recording: it announces the
  // home-base question once per session, then opens the mic. The ref is
  // the synchronous guard; sessionStorage is the cross-reload marker.
  const firstSpeakHandledRef = useRef(false);
  const lastSpokenRef = useRef("");
  const lastHostLineRef = useRef("");
  const eventsRef = useRef<string[]>([]);
  function logEvent(line: string) {
    eventsRef.current.push(`${Math.round(performance.now())} ${line}`);
    if (eventsRef.current.length > 300) eventsRef.current.shift();
    if (typeof window !== "undefined") {
      (window as unknown as { __vvbEvents?: string[] }).__vvbEvents = [...eventsRef.current];
    }
  }
  // The host's voice (components/hooks/useHostSpeech.ts).
  const host = useHostSpeech({
    turn,
    settingsRef,
    providerRef,
    neural,
    voiceChoice,
    lastHostLineRef,
    appendLog,
    logEvent,
    stampTiming,
    setNotice,
    surfaceRecovery,
    clearSilentRecovery: () => setRecovery((current) => (current?.kind === "host-silent" ? null : current)),
    requestRearm,
    onCancel: clearRearmTimer,
  });
  const hostSilent = host.hostSilent;
  // The microphone hardware (components/hooks/useMicCapture.ts).
  const mic = useMicCapture({
    isListening: () => isTurnListeningRef.current,
    isHostAudible: () => turn.get().hostSpeaking || speechQueue.isSpeaking(),
    streamSocket: () => asrSocketRef.current,
    onBlock: onMicBlock,
  });
  const prevDoneCountRef = useRef(-1);
  // Voice pre-warm: cache the picked system voice, re-pick once when
  // the browser finishes loading voices, preload on first gesture.
  const rearmTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Single-slot pending turn: a command sent while the agent is busy is
  // parked here (latest wins) and flushed once when idle — never silently
  // dropped, never double-sent, never sent after the conversation ends.
  const queuedTurnRef = useRef<{ text: string; convoWasActive: boolean } | null>(null);
  // Adaptive endpointing: set once a live intent (not a question) has
  // matched in the current recording, shortening the stop pause.
  const intentMatchedRef = useRef(false);

  // One short turn story for screen readers: "Heard: …" plus, when VOX is
  // off, the host line. Visual statuses stay visible but are not live; the
  // budget caps the turn at two messages. Errors/notices keep their own
  // alert/status roles and are announced once by the browser.
  function pushAnnouncement(turn: number, text: string) {
    const clean = (text ?? "").trim();
    if (!clean) return;
    if (!announcementBudgetRef.current.allow(turn, clean)) return;
    announcementIdRef.current += 1;
    setAnnouncement({ id: announcementIdRef.current, text: clean });
  }

  function announceHeard(text: string, fromVoice = true) {
    const clean = (text ?? "").trim();
    if (!clean) return;
    announceTurnRef.current += 1;
    pushAnnouncement(
      announceTurnRef.current,
      `${fromVoice ? "Heard" : "Command"}: ${clean}`,
    );
  }

  function announceOutcome(text: string) {
    const clean = (text ?? "").trim();
    if (!clean) return;
    if (voiceOn || notice) return; // TTS or the live notice already carries it.
    const turn = announceTurnRef.current || (announceTurnRef.current = 1);
    pushAnnouncement(turn, clean);
  }

  function dropQueuedTurnNotice() {
    setNotice((n) => (n === QUEUED_TURN_NOTICE ? "" : n));
  }

  function dropQueuedTurn() {
    queuedTurnRef.current = null;
    dropQueuedTurnNotice();
  }

  function selectHostVoice(uri: string) {
    if (voiceChoice.select(uri)) playCue("highlight");
  }

  function previewHostVoice() {
    if (typeof window === "undefined" || !window.speechSynthesis) return;
    host.setHostSilent(false);
    if (!settingsRef.current.voiceOn || settingsRef.current.volume <= 0.01) {
      updateVoiceSettings({ voiceOn: true, volume: Math.max(0.25, settingsRef.current.volume) });
    }
    refreshCachedVoice();
    const line = "This is your host voice. Say “Pick Mars” when you hear me.";
    setLocalHost(line);
    speakNative(line);
  }

  function toggleControls() {
    if (!dockOpen) refreshCachedVoice();
    setDockOpen((value) => !value);
  }

  function clearRearmTimer() {
    if (rearmTimerRef.current !== null) {
      clearTimeout(rearmTimerRef.current);
      rearmTimerRef.current = null;
    }
    if (turn.get().rearm === "pending") turn.dispatch({ type: "REARM_CANCEL" });
  }

  function cancelSpeech() {
    host.cancel();
  }

  // On-end re-arm (primary path; the poll below is fallback only). Wait a
  // short beat after the host stops before opening the mic: Chrome can
  // still be draining the last words, and hearing its own confirmation
  // line caused the 4-owner confirm loop. A cancelled utterance never
  // re-arms: cancelSpeech always runs first and marks it.
  function requestRearm() {
    // The machine owns the rule (lib/turn-machine.ts canRearm). The speech
    // queue is checked here too: it can still be draining after the host
    // flag drops.
    if (!canRearm(turn.get()) || speechQueue.isSpeaking()) return;
    if (rearmTimerRef.current !== null) clearTimeout(rearmTimerRef.current);
    turn.dispatch({ type: "REARM_REQUEST" });
    rearmTimerRef.current = setTimeout(() => {
      rearmTimerRef.current = null;
      if (speechQueue.isSpeaking()) {
        if (turn.get().rearm === "pending") turn.dispatch({ type: "REARM_CANCEL" });
        return;
      }
      const before = turn.get();
      const after = turn.dispatch({ type: "REARM_FIRE", via: "pending" });
      if (before.mic !== "closed" || after.mic !== "opening") return;
      stampTiming("rearm");
      console.info(`[vvb-timing] rearm ${summarizeTimings(turnTimingRef.current)}`);
      void openMic();
    }, 420);
  }

  // Speaks one host line (components/hooks/useHostSpeech.ts): paint
  // first, neural voice when available, browser voice as the fallback,
  // and a visible fault if no voice ever starts.
  function speakNative(
    text: string,
    onDone?: () => void,
    options: { retry?: number; useDefaultVoice?: boolean } = {},
  ) {
    return host.speak(text, onDone, options);
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

  // One local write path for the canvas. Every state change updates the
  // view immediately and pushes the same object to the agent.
  function writeShared(next: SharedState) {
    localTouchedRef.current = true;
    stateRef.current = next;
    setLocalState(next);
    setState(next);
  }

  function commit(label: string, fn: (s: SharedState) => SharedState): string {
    const before = withDefaults(stateRef.current);
    const after = fn(before);
    const changed = !statesEqual(before, after);
    // An equity change paints a confirmation line. A voice/agent change
    // must also speak that exact line; the slider path stays silent so a
    // drag does not chatter.
    let equitySpeechLine = "";
    logEvent(`commit ${label} changed=${changed} sel=${String(after.selectedJurisdiction)} name=${JSON.stringify(after.companyName)}`);
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
        equitySpeechLine = equityConfirmationLine(after);
        setLocalHost(equitySpeechLine);
      } else {
        if (after.currentBeat !== "equity" && equityChanged) setEquityConfirm(false);
        // Required-task handoff: when a change completes the current
        // required beat, open the next one in the same handler. The name
        // moves to CREW, 5/5 moves to LAUNCH; equity waits for the split
        // confirmation above.
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
    writeShared(after);
    stampTiming("firstPaint");
    const cue = cueForChange(before, after);
    if (cue) playCue(cue);
    if (
      equitySpeechLine &&
      label !== "slider" &&
      voiceOn &&
      unlockedRef.current &&
      spokenHostText(equitySpeechLine) !== lastSpokenRef.current
    ) {
      lastSpokenRef.current = spokenHostText(equitySpeechLine);
      speakNative(equitySpeechLine);
    }
    return describeChange(before, after);
  }
  function undoLast(): string {
    cancelSummaryBuild();
    const { stack, entry } = popHistory(historyRef.current);
    const current = withDefaults(stateRef.current);
    if (!entry) return `Nothing to undo. Current state: ${currentStateSummary(current)}.`;
    historyRef.current = stack;
    setHistorySize(stack.length);
    const restored: SharedState = { ...entry.state, transcript: current.transcript };
    const summary = describeChange(current, restored);
    writeShared(restored);
    setEquityConfirm(false);
    setActiveModule(restored.selectedJurisdiction && restored.currentBeat === "jurisdiction" ? "equity" : restored.currentBeat);
    setStageTab(restored.selectedJurisdiction ? "colony" : "galaxy");
    playCue("adjust");
    // Labels like "live-preview" are internal; the summary already says
    // exactly what changed. Never speak internal state-machine jargon.
    const line = `Undid the last change. ${summary}`;
    setLocalHost(line);
    lastHostLineRef.current = spokenHostText(line);
    appendLog("host", spokenHostText(line));
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
    const before = withDefaults(stateRef.current);
    const clicked = before.checklist.find((item) => item.id === itemId);
    commit("click", (s) => applyChecklistItem(s, itemId, done));
    const current = withDefaults(stateRef.current);
    const line = done && clicked ? buildRaisedLine(current, clicked.label) : buildQuestionLine(current);
    setLocalHost(line);
    if (voiceOn && unlockedRef.current && spokenHostText(line) !== lastSpokenRef.current) {
      lastSpokenRef.current = spokenHostText(line);
      speakNative(line);
    }
  }

  // The explicit gate between "the split changed" and "move to BUILD".
  // The state is already normalized; this only acknowledges it and then
  // advances the required walk.
  function confirmEquitySelection() {
    if (!equityConfirm && !equityConfirmRef.current) return;
    const state = withDefaults(stateRef.current);
    const next = beatProgress(state).nextBeat;
    const owners = state.founders.length;
    const split = state.founders.map((founder) => `${founder.percent}%`).join(" / ");
    let nextLine =
      next === "complete"
        ? "Mission complete — colony founded."
        : nextObjectiveHostLine(state);
    if (next === "checklist") {
      // Keep the handoff to two sentences: the spoken cap would drop the
      // instruction to say yes if the full build question were appended.
      const nextItem = state.checklist.find((item) => !item.done);
      nextLine = `Say “yes” to raise the ${nextItem?.label ?? "next structure"}.`;
    }
    const line = `${owners} ${owners === 1 ? "owner" : "owners"} confirmed — ${split}. ${nextLine}`;
    const milestoneLine = withCommander(line);
    setEquityConfirm(false);
    setActiveModule(next === "complete" ? "summary" : next);
    setStageTab(next === "jurisdiction" ? "galaxy" : "colony");
    setLocalHost(milestoneLine);
    playCue("highlight");
    if (voiceOn && unlockedRef.current) {
      lastSpokenRef.current = spokenHostText(milestoneLine);
      speakNative(milestoneLine);
    }
  }

  useEffect(() => {
    endpointerRef.current = new HybridEndpointer(
      () => ({
        equityConfirm: equityConfirmRef.current,
        namePromptActive: false,
      }),
      {
        stabilityMs: 250,
        silenceMs: 350,
        rmsThreshold: 0.015,
        onFastCommit: (turnId, cmd, rawText) => {
          if (cmd.kind === "CONFIRM_EQUITY") {
            announceHeard(rawText);
            clearConfirmationTimer();
            previewKeyRef.current = null;
            committedKeyRef.current = null;
            pendingTurnRef.current = null;
            setLivePreview(null);
            setLiveTranscript(rawText);
            setLastTranscript(rawText);
            writeShared({ ...withDefaults(stateRef.current), transcript: rawText });
            setAck("");
            confirmEquitySelection();
          } else if (cmd.kind === "APPROVE_NAME") {
            void sendToAgent(rawText, true);
          }
        },
        onModelCommit: (turnId, finalTranscript) => {
          onStreamingSpeechComplete(finalTranscript, turnId);
        },
      },
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Grounding for the agent: fictional company/places, current equity and
  // checklist state, and the optional filing pack's fact ids + topics.
  useAgentContext({
    description:
      "Fictional demo company, places, equity split, checklist state, and optional filing knowledge-pack fact index for the incorporation demo",
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
      } else if (intent.kind === "equity-split") {
        // A bare "70/30" only has an unambiguous owner order for two
        // founders. With 3–5 owners, leave it to the agent.
        const base = withDefaults(stateRef.current);
        if (base.founders.length !== 2) return null;
        commit("live-preview", (s) => applyEquity(s, 0, intent.first, "voice-live-split"));
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
    const trimmed = stripAsrAnnotations(text);
    if (!trimmed) return;
    // Real words mean the recovery banner has done its job; the tracker
    // is reset only by a turn that actually completes.
    setRecovery(null);
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

    if (equityConfirmRef.current && isConfirmationAnswer(trimmed)) {
      intentMatchedRef.current = true;
      setLivePreview({ key: "confirm-equity", label: "Confirming equity split…", status: "live" });
      // Fast endpointing: short affirmative answers ("yes", "confirm", "split")
      // should finish and advance immediately in ~350ms (or 150ms on final), not wait 16+ seconds.
      clearConfirmationTimer();
      confirmationTimerRef.current = setTimeout(() => {
        if (micHot(turn.get()) && !finishingRef.current) {
          if (streamingReadyRef.current && endpointerRef.current) {
            endpointerRef.current.forceFastCommitNow(trimmed);
          } else {
            void finishRecording();
          }
        }
      }, isFinal ? 150 : 350);
      return;
    }

    clearConfirmationTimer();

    if (beatProgress(stateRef.current).nextBeat === "name" && isNameApproval(trimmed)) {
      intentMatchedRef.current = true;
      setLivePreview({ key: "approve-name", label: "Approving Galactic Bagels Inc. (fictional)…", status: "live" });
      if (isFinal) {
        setTimeout(() => {
          if (micHot(turn.get()) && !finishingRef.current) void finishRecording();
        }, 150);
      }
      return;
    }

    if (isCompanyNameQuestion(trimmed)) {
      intentMatchedRef.current = true;
      setLivePreview({ key: "company-name-q", label: "Fictional company: Galactic Bagels Inc. (fictional)", status: "live" });
      if (isFinal) {
        setTimeout(() => {
          if (micHot(turn.get()) && !finishingRef.current) void finishRecording();
        }, 150);
      }
      return;
    }

    const intent = applyLiveIntent(trimmed, "live");
    // Adaptive endpointing: a recognised command shortens the stop pause
    // to 600 ms. Questions keep 1100 ms — a slow ask needs its full pause.
    if (intent && intent.kind !== "filing-question") {
      intentMatchedRef.current = true;
      if (isFinal) {
        setTimeout(() => {
          if (micHot(turn.get()) && !finishingRef.current) void finishRecording();
        }, 150);
      }
    }
  }

  // Beat 1 action: the agent's authoritative jurisdiction write. It
  // lands on the same applyJurisdiction path as the live preview, so
  // confirming a preview changes nothing twice.
  useFrontendTool({
    name: AGENT_ACTIONS.showJurisdictionComparison,
    description:
      "Show the fictional jurisdiction comparison table and optionally select one of the fictional places (Mars, Europa, Andromeda Galaxy). Call this when the user asks to compare jurisdictions, choose a place to incorporate, or start incorporating the fictional company.",
    parameters: z.object({
      jurisdiction: z.string().optional().describe(
        "Name of the fictional place the user picked, if they named one.",
      ),
    }),
    handler: async ({ jurisdiction }) =>
      runTool("showJurisdictionComparison", () =>
        commit("jurisdiction", (s) => applyJurisdiction(s, jurisdiction ?? null)),
      ),
  });

  // Beat 2 voice path: "make me 70%" -> same updateEquity() the slider
  // drags use, so 60/40 with a 70% request lands on 70/30, total 100%.
  useFrontendTool({
    name: AGENT_ACTIONS.setFounderEquity,
    description:
      "Set one DEMO owner's equity percent (e.g. the user says 'make me 70%'). The other owner(s) auto-adjust so the split always totals 100%. Owners are the readable founders list; there may be 1–5.",
    parameters: z.object({
      founder: z.string().describe("Founder name, or 'me' for the first founder."),
      percent: z.number().describe("Target percent for that founder, 0-100."),
    }),
    handler: async ({ founder, percent }) =>
      runTool("setFounderEquity", () => {
        const base = withDefaults(stateRef.current);
        const index = resolveFounderIndex(base.founders, founder ?? "");
        if (index < 0) {
          return `Nothing changed: no founder matched "${founder}". Founders are ${base.founders.map((f) => f.name).join(", ")}. Nothing was edited; please ask again with one of those names. Current state: ${currentStateSummary(base)}.`;
        }
        return commit("equity", (s) => applyEquity(s, index, Number(percent), "voice"));
      }),
  });

  useFrontendTool({
    name: AGENT_ACTIONS.setOwnerCount,
    description:
      "Set the number of fictional company owners (1-5). Shrinking the team redistributes the removed share; growing adds owners at 0%; the equity split always totals 100%. Use when the user says it is just them, or names a number of owners/founders.",
    parameters: z.object({
      count: z.number().describe("Number of owners, 1 to 5."),
    }),
    handler: async ({ count }) =>
      runTool("setOwnerCount", () => commit("owners", (s) => applyOwnerCount(s, Number(count)))),
  });

  // Beat 3 voice paths: check/uncheck one item, or advance the walk.
  useFrontendTool({
    name: AGENT_ACTIONS.setChecklistItem,
    description:
      "Check or uncheck one filing-checklist item by its id (ids are in the readable checklist state). Use when the user answers a checklist step or asks to mark one done/not done.",
    parameters: z.object({
      itemId: z.string().describe("Checklist item id."),
      done: z.boolean().describe("True to check, false to uncheck."),
    }),
    handler: async ({ itemId, done }) =>
      runTool("setChecklistItem", () =>
        commit("checklist", (s) => applyChecklistItem(s, itemId, Boolean(done))),
      ),
  });

  useFrontendTool({
    name: AGENT_ACTIONS.setChecklistItems,
    description:
      "Check or uncheck several filing-checklist items at once by their ids (ids are in the readable checklist state). Use when the user asks to tick off multiple items in one command.",
    parameters: z.object({
      itemIds: z.array(z.string()).describe("Checklist item ids."),
      done: z.boolean().describe("True to check, false to uncheck."),
    }),
    handler: async ({ itemIds, done }) =>
      runTool("setChecklistItems", () => {
        const ids = Array.isArray(itemIds) ? itemIds.map(String) : [];
        return commit("checklist", (s) => applyChecklistItems(s, ids, Boolean(done)));
      }),
  });

  useFrontendTool({
    name: AGENT_ACTIONS.undoLastChange,
    description:
      "Reverse the last canvas change (voice, slider, or click). Call when the user says undo that, revert, or go back. Never claim an undo without calling this.",
    handler: async () => runTool("undoLastChange", () => undoLast()),
  });

  useFrontendTool({
    name: AGENT_ACTIONS.startOver,
    description:
      "Reset the canvas only (selection, equity, checklist, cards, lawyer package) and keep the chat history. Call when the user says start over or fresh start. Never claim a reset without calling this.",
    handler: async () =>
      runTool("startOver", () => {
        cancelSummaryBuild();
        return commit("start-over", (s) => applyStartOver(s));
      }),
  });

  useFrontendTool({
    name: AGENT_ACTIONS.compareJurisdictions,
    description:
      "Answer a comparison question about the three fictional places (Mars, Europa, Andromeda Galaxy) from the DEMO rows and set a DEMO highlight. The highlight never changes the user's selected jurisdiction. DEMO values may be quoted verbatim, labeled DEMO, for these three fictional places only.",
    parameters: z.object({
      question: z.string().optional().describe("The user's comparison question."),
      focus: z.string().optional().describe("Fictional place to DEMO-highlight, if one fits; otherwise omit."),
    }),
    handler: async ({ question, focus }) =>
      runTool("compareJurisdictions", () => {
        const cheapest = cheapestByNumber(DEMO_JURISDICTIONS);
        const focusName = focus ?? cheapest.name;
        const result = commit("compare", (s) =>
          applyFocusJurisdiction(s, focusName, question ?? "comparison"),
        );
        const rowsText = DEMO_JURISDICTIONS.map(
          (r) => `${r.jurisdiction} — ${r.filingFee}, ${r.timeline}`,
        ).join("; ");
        return `DEMO jurisdictions: ${rowsText}. DEMO cheapest by number: ${cheapest.name} (${cheapest.fee}). Currencies are fictional and don't convert (sameCurrency: ${cheapest.sameCurrency}), so there's no true cheapest. ${result}`;
      }),
  });

  useFrontendTool({
    name: AGENT_ACTIONS.advanceChecklist,
    description:
      "Mark the first not-yet-done filing-checklist item done and move the walk forward. Use as the user answers each checklist step.",
    handler: async () =>
      runTool("advanceChecklist", () => commit("checklist", (s) => applyAdvanceChecklist(s))),
  });

  // Day 3: grounded filing-steps/fees card. The handler looks every
  // fact up in the filing-steps pack — card text is pack text verbatim
  // with pack/fact grounding. Any unknown factId renders NO card.
  useFrontendTool({
    name: AGENT_ACTIONS.showFilingSteps,
    description:
      "Show grounded filing steps and fees facts. Call with factIds from the readable filingStepsFacts index when the user asks about filing steps, process order, or fees. Never invent steps or fees; only pack facts become cards.",
    parameters: z.object({
      factIds: z.array(z.string()).describe("Fact ids from the filingStepsFacts index."),
      question: z.string().optional().describe("The user's question."),
    }),
    handler: async ({ factIds, question }) =>
      runTool("showFilingSteps", () => {
        const ids = Array.isArray(factIds) ? factIds.map(String) : [];
        return commit("filingsteps", (s) => applyFilingSteps(s, ids, question));
      }),
  });

  // Day 3: lawyer-summary package display. The Prepare button and this
  // agent action share buildLawyerSummary() over shared state — one
  // package, rendered on the canvas. Prep only; nothing is sent.
  function approveCompanyName(rawName?: string) {
    commit("name", (s) => applyCompanyName(s, rawName));
    const current = withDefaults(stateRef.current);
    const line = withCommander(nameApprovedLine(current));
    setLocalHost(line);
    setAck("");
    setActiveModule("equity");
    setStageTab("colony");
    if (voiceOn && unlockedRef.current) {
      lastSpokenRef.current = spokenHostText(line);
      speakNative(line);
    }
  }

  function cancelSummaryBuild() {
    summaryBuildTokenRef.current += 1;
    if (summaryBuildRef.current?.timer) clearTimeout(summaryBuildRef.current.timer);
    summaryBuildRef.current = null;
    if (summarySpeakTimerRef.current !== null) clearTimeout(summarySpeakTimerRef.current);
    summarySpeakTimerRef.current = null;
    summaryDeliverAttemptsRef.current = 0;
    setSummaryBuild(null);
  }

  function speakSummaryWhenFree(token: number) {
    if (token !== summaryBuildTokenRef.current) return;
    const busyNow =
      micHot(turn.get()) ||
      isBusy(turn.get()) ||
      turn.get().hostSpeaking ||
      speechQueue.isSpeaking();
    if (busyNow) {
      summaryDeliverAttemptsRef.current += 1;
      if (summaryDeliverAttemptsRef.current < 40) {
        summarySpeakTimerRef.current = setTimeout(() => speakSummaryWhenFree(token), 500);
        return;
      }
    }
    summarySpeakTimerRef.current = null;
    setSummaryBuild(null);
    const line = withCommander(SUMMARY_READY_LINE);
    setLocalHost(line);
    lastSpokenRef.current = spokenHostText(line);
    if (voiceOn && unlockedRef.current) speakNative(line);
  }

  function finishSummaryBuild(token: number) {
    if (token !== summaryBuildTokenRef.current) return;
    summaryBuildRef.current = null;
    const current = withDefaults(stateRef.current);
    const next = beatProgress(current).nextBeat;
    if (next !== "summary" && next !== "complete") {
      setSummaryBuild(null);
      const line = `Not yet — ${nextObjectiveHostLine(current)}`;
      setLocalHost(line);
      if (voiceOn && unlockedRef.current) {
        lastSpokenRef.current = spokenHostText(line);
        speakNative(line);
      }
      return;
    }
    setSummaryBuild({ pct: 100, ready: true });
    commit("summary", (s) => applyLawyerSummary(s));
    speakSummaryWhenFree(token);
  }

  function prepareLawyerPackage(force = false) {
    const current = withDefaults(stateRef.current);
    const next = beatProgress(current).nextBeat;
    if (next !== "summary" && next !== "complete") {
      const line = `Not yet — ${nextObjectiveHostLine(current)}`;
      setLocalHost(line);
      if (voiceOn && unlockedRef.current && spokenHostText(line) !== lastSpokenRef.current) {
        lastSpokenRef.current = spokenHostText(line);
        speakNative(line);
      }
      return;
    }
    if (summaryBuildRef.current) return; // already building
    if (!force && current.lawyerPackage) {
      setLocalHost(SUMMARY_READY_LINE);
      if (voiceOn && unlockedRef.current && spokenHostText(SUMMARY_READY_LINE) !== lastSpokenRef.current) {
        lastSpokenRef.current = spokenHostText(SUMMARY_READY_LINE);
        speakNative(SUMMARY_READY_LINE);
      }
      return;
    }

    cancelSummaryBuild();
    const token = summaryBuildTokenRef.current;
    summaryDeliverAttemptsRef.current = 0;
    setSummaryBuild({ pct: 0, ready: false });
    setLocalHost(SUMMARY_START_LINE);
    lastSpokenRef.current = spokenHostText(SUMMARY_START_LINE);
    if (voiceOn && unlockedRef.current) speakNative(SUMMARY_START_LINE);

    let pct = 0;
    const step = () => {
      if (token !== summaryBuildTokenRef.current) return;
      pct = nextSummaryProgress(pct);
      if (pct >= 100) {
        finishSummaryBuild(token);
        return;
      }
      setSummaryBuild({ pct, ready: false });
      summaryBuildRef.current = { token, timer: setTimeout(step, SUMMARY_STEP_MS) };
    };
    summaryBuildRef.current = { token, timer: setTimeout(step, SUMMARY_STEP_MS) };
  }

  useFrontendTool({
    name: AGENT_ACTIONS.prepareLawyerSummary,
    description:
      "Prepare the lawyer-summary package (jurisdiction choice, equity split, checklist state) and display it on the canvas. Use when the user asks to prepare, show, or send-to-lawyer the summary. This only prepares the package for the user to forward; it never sends email.",
    handler: async () =>
      runTool("prepareLawyerSummary", () => {
        prepareLawyerPackage(true);
        return "Building the lawyer summary — one moment.";
      }),
  });

  // Short spoken/visible host feedback for downloads and the safe
  // transcript close. These lines are not milestones, so no Commander.
  function hostFeedback(line: string) {
    setLocalHost(line);
    if (voiceOn && unlockedRef.current) {
      lastSpokenRef.current = spokenHostText(line);
      speakNative(line);
    }
  }

  function saveTextFile(filename: string, text: string): boolean {
    if (typeof window === "undefined") return false;
    try {
      const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = filename;
      link.rel = "noopener";
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1500);
      return true;
    } catch {
      return false;
    }
  }

  // What to save (or why not) is decided in lib/downloads.ts; this only
  // saves the file and speaks the outcome.
  function downloadNow(kind: DownloadKind) {
    const plan = planDownload(kind, withDefaults(stateRef.current), logRef.current);
    if (!plan.ok) {
      hostFeedback(plan.line);
      return;
    }
    if (!saveTextFile(plan.filename, plan.text)) {
      hostFeedback(DOWNLOAD_BLOCKED_LINE);
      return;
    }
    hostFeedback(downloadedLine(plan.filename));
  }

  function downloadSummaryNow() {
    downloadNow("summary");
  }

  function downloadTranscriptNow() {
    downloadNow("transcript");
  }

  function downloadPackageNow() {
    downloadNow("package");
  }

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
    const line = withCommander(nextObjectiveHostLine(withDefaults(stateRef.current)));
    setLocalHost(line);
    if (voiceOn && unlockedRef.current && spokenHostText(line) !== lastSpokenRef.current) {
      lastSpokenRef.current = spokenHostText(line);
      speakNative(line);
    }
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
        return withCommander(question || `${intent.jurisdiction} locked in.`);
      case "equity":
      case "equity-split":
      case "owner-count":
        // Equity changes pause on the confirmation card; do not append
        // the next task's question and make the user feel rushed.
        return equityConfirmationLine(state);
      case "checklist-advance": {
        // The guided build path intercepts answers before this local fast
        // line; this remains a safe fallback after a direct tick.
        return buildQuestionLine(state);
      }
      case "cheapest": {
        const cheapest = cheapestByNumber(DEMO_JURISDICTIONS);
        const currency = cheapest.sameCurrency
          ? "All three demo fees use the same fictional currency."
          : "Currencies are fictional and don't convert.";
        return `DEMO cheapest by number: ${cheapest.name} (${cheapest.fee}). ${currency}${question ? ` ${question}` : ""}`;
      }
      case "lawyer-summary":
        // The async builder owns the spoken start and completion lines.
        // Never speak "summary prepared" before the package has landed.
        return state.lawyerPackage ? SUMMARY_READY_LINE : "";
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
      writeShared({ ...withDefaults(stateRef.current), transcript: trimmed });
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

  function missionSayLine(): string {
    const current = withDefaults(stateRef.current);
    const mission = missionFor(current);
    if (mission.beat === "complete") {
      return "Mission complete — the summary is ready and nothing was filed. Say “yes” to download the package, or say “show transcript”.";
    }
    return `Step ${mission.step} of ${mission.total}: ${mission.title}. Say “${mission.voiceCue}”.`;
  }

  function helpLine(): string {
    const current = withDefaults(stateRef.current);
    if (beatProgress(current).nextBeat === "checklist") {
      const next = current.checklist.find((item) => !item.done);
      const step = current.checklist.filter((item) => item.done).length + 1;
      return `Structure ${step} of ${current.checklist.length}: ${next?.label ?? "next structure"} — say “yes” to raise it. Other commands: help, repeat, stop, slower, test voice, start over.`;
    }
    return `${missionSayLine()} You can always say help, repeat that, stop, slower, test voice, or start over.`;
  }

  // Every voice control is handled locally: no model, no state change for
  // help/repeat/stop, and one short confirmation for a settings change.
  // Returns true when the turn was consumed.
  function handleVoiceControl(control: VoiceControl): boolean {
    switch (control.kind) {
      case "help": {
        const line = helpLine();
        setLocalHost(line);
        if (voiceOn) speakNative(line);
        return true;
      }
      case "repeat": {
        const line = lastHostLineRef.current;
        if (!line) {
          const fallback = missionSayLine();
          setLocalHost(fallback);
          if (voiceOn) speakNative(fallback);
          return true;
        }
        cancelSpeech();
        setLocalHost(line);
        if (voiceOn) speakNative(line);
        return true;
      }
      case "stop": {
        // Immediate silence. The mic stays available so "continue" is
        // understood; nothing is repeated and no new filler is spoken.
        cancelSpeech();
        cancelSummaryBuild();
        clearHeldUtterance();
        // Visible, not spoken: stop means stop. The line is still part of
        // the caption record and "repeat that" can replay it.
        const line = "Stopped. I'm still listening — say “continue” when you're ready.";
        setLocalHost(line);
        lastHostLineRef.current = spokenHostText(line);
        appendLog("host", spokenHostText(line));
        if (turn.get().convo && !micHot(turn.get())) {
          setTimeout(() => {
            if (turn.get().convo && !micHot(turn.get())) void startRecording();
          }, 260);
        }
        return true;
      }
      case "continue": {
        turn.dispatch({ type: "CONVO_START" });
        setNotice("");
        clearHeldUtterance();
        const line = nextObjectiveHostLine(withDefaults(stateRef.current));
        setLocalHost(line);
        if (voiceOn) {
          speakNative(line, () => {
            if (turn.get().convo && !micHot(turn.get())) void startRecording();
          });
        } else if (!micHot(turn.get())) {
          void startRecording();
        }
        return true;
      }
      case "show-transcript": {
        setTranscriptVisibility(true);
        hostFeedback("Transcript open — say “download transcript” or “close”.");
        return true;
      }
      case "hide-transcript": {
        setTranscriptVisibility(false);
        hostFeedback("Transcript hidden. Say “show transcript” to open it again.");
        return true;
      }
      case "close-transcript": {
        if (!transcriptOpenRef.current) {
          hostFeedback("The transcript is not open.");
          return true;
        }
        // Close only the transcript window. There is deliberately no
        // window.close()/tab-close path anywhere in this handler.
        setTranscriptVisibility(false);
        hostFeedback("Transcript closed. Back to the journey.");
        return true;
      }
      case "download": {
        if (transcriptOpenRef.current) {
          // The open transcript wins over the summary.
          downloadTranscriptNow();
          return true;
        }
        if (withDefaults(stateRef.current).lawyerPackage.trim()) {
          downloadSummaryNow();
          return true;
        }
        hostFeedback("Nothing to download yet — prepare the lawyer summary or open the transcript first.");
        return true;
      }
      case "download-summary": {
        downloadSummaryNow();
        return true;
      }
      case "download-transcript": {
        downloadTranscriptNow();
        return true;
      }
      case "download-package": {
        downloadPackageNow();
        return true;
      }
      case "save": {
        const ok = saveSession(withDefaults(stateRef.current), settingsRef.current, log);
        const line = ok
          ? "Saved. Close the tab whenever you need a break — say “Resume” on the landing screen to pick up here."
          : "I could not save in this browser. The run is still on screen; keep the tab open.";
        setSavedNotice(ok ? "Saved just now" : "Save unavailable");
        setLocalHost(line);
        if (voiceOn) speakNative(line);
        return true;
      }
      case "status": {
        const line = `${missionSayLine()} ${progressSummary(withDefaults(stateRef.current))}.`;
        setLocalHost(line);
        if (voiceOn) speakNative(line);
        return true;
      }
      case "test-voice": {
        host.setHostSilent(false);
        if (!settingsRef.current.voiceOn || settingsRef.current.volume <= 0.01) {
          updateVoiceSettings({ voiceOn: true, volume: Math.max(0.25, settingsRef.current.volume) });
        }
        const line = "This is the host voice. If you can hear this, say “continue”.";
        setLocalHost(line);
        setNotice("");
        cancelSpeech();
        speakNative(line);
        return true;
      }
      case "start-over": {
        clearSavedSession();
        cancelSummaryBuild();
        clearHeldUtterance();
        commit("start-over", (s) => applyStartOver(s));
        setTranscriptVisibility(false);
        setEquityConfirm(false);
        const line = withCommander(`Fresh start. ${nextObjectiveHostLine(withDefaults(stateRef.current))}`);
        setLocalHost(line);
        if (voiceOn) speakNative(line);
        return true;
      }
      default: {
        const { settings: nextSettings, reply } = applyVoiceControl(settingsRef.current, control);
        settingsRef.current = nextSettings;
        setSettings(nextSettings);
        if (nextSettings.slowMode !== settings.slowMode) {
          // Slow mode uses the buffered path so the local, generous
          // silence window is the authority instead of Meta's endpoint.
          try {
            asrSocketRef.current?.close();
          } catch {
            // ignore
          }
          asrSocketRef.current = null;
          streamingReadyRef.current = false;
        }
        if (control.kind === "mute" || control.kind === "voice-off") cancelSpeech();
        if (reply) {
          setLocalHost(reply);
          speakNative(reply);
        }
        return true;
      }
    }
  }

  async function sendToAgent(text: string, fromVoice = false) {
    let trimmed = stripAsrAnnotations(text);
    // A slow speaker's held beginning is completed by this final. Merge
    // before any parser runs, so "I would like to pick" + "Mars" is one
    // command, not two dead turns. A typed command abandons the hold.
    if (fromVoice && heldUtteranceRef.current) {
      trimmed = stripAsrAnnotations(takeHeldTranscript(trimmed));
    } else if (!fromVoice) {
      clearHeldUtterance();
    }
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
    // A real command or control clears the recovery banner and resets the
    // consecutive-failure count. Errors raised by this turn start a new
    // count, so one bad turn never poisons the rest of the session.
    clearRecovery();
    // Always-available voice controls run before the busy gate and before
    // any journey handling, so help, repeat, stop, slower, and start over
    // are understood in every state.
    logEvent(`sendToAgent ${JSON.stringify(trimmed)} phase=${micHot(turn.get()) ? "rec" : "idle"}`);
    const control = parseVoiceControl(trimmed);
    if (control) {
      logEvent(`control ${control.kind}`);
      announceHeard(trimmed, fromVoice);
      appendLog("you", trimmed);
      recordHeardTurn(trimmed);
      handleVoiceControl(control);
      return;
    }
    noSpeechAttemptsRef.current = 0;
    // Long-lived audio callbacks can call this from an older render. Read
    // the live state and confirmation gate through refs, never stale
    // render-time state, or a spoken "confirm" is answered as a model turn.
    const live = withDefaults(stateRef.current);
    // Busy lane: park one turn (latest wins) with a visible notice instead
    // of the old silent drop. The flush effect below sends it once idle.
    if (sending || isLoading) {
      queuedTurnRef.current = queueTurn(queuedTurnRef.current, trimmed, turn.get().convo);
      setNotice(QUEUED_TURN_NOTICE);
      return;
    }
    // Announce the final transcript once for this turn. Queued turns are
    // announced when they are actually flushed, not twice at park + flush.
    announceHeard(trimmed, fromVoice);
    appendLog("you", trimmed);
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
    if (equityConfirmRef.current) {
      const pendingIntent = parseLiveIntent(trimmed);
      const isConfirm = isConfirmationAnswer(trimmed) || (!isChangeAnswer(trimmed) && /\b(?:confirm(?:ed)?|the split)\b/i.test(trimmed));
      if (isConfirm) {
        previewKeyRef.current = null;
        pendingTurnRef.current = null;
        setLivePreview(null);
        setLiveTranscript(trimmed);
        setLastTranscript(trimmed);
        writeShared({ ...withDefaults(stateRef.current), transcript: trimmed });
        setAck("");
        confirmEquitySelection();
        return;
      }
      if (isChangeAnswer(trimmed)) {
        answerLocally(
          "No problem — say the percentages you want, choose another owner count, or drag a slider.",
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
        writeShared({ ...withDefaults(stateRef.current), transcript: trimmed });
        setAck("");
        confirmEquitySelection();
        return;
      }
      const canAdjust =
        pendingIntent?.kind === "owner-count" ||
        pendingIntent?.kind === "equity" ||
        pendingIntent?.kind === "equity-split";
      const canEscape =
        pendingIntent?.kind === "undo" || pendingIntent?.kind === "start-over";
      if (!canAdjust && !canEscape) {
        // The split is already applied; the next command is an implicit
        // confirmation. Do not add another prompt or block the walk.
        setEquityConfirm(false);
        setLocalHost("");
      }
    }

    // The summary has landed and the host asked for a spoken yes/no.
    // Answer locally: yes downloads the one-command package, no leaves
    // the summary on screen. No model turn and no extra prompt.
    const completedSummary =
      beatProgress(live).nextBeat === "complete" && live.lawyerPackage.trim().length > 0;
    if (completedSummary && isConfirmationAnswer(trimmed)) {
      recordHeardTurn(trimmed);
      previewKeyRef.current = null;
      pendingTurnRef.current = null;
      setLivePreview(null);
      setAck("");
      downloadPackageNow();
      return;
    }
    if (completedSummary && isChangeAnswer(trimmed)) {
      recordHeardTurn(trimmed);
      previewKeyRef.current = null;
      pendingTurnRef.current = null;
      setLivePreview(null);
      setAck("");
      hostFeedback("No download. The summary is still on screen — nothing was filed or sent.");
      return;
    }

    // This answer is fixed safety copy, not a fact lookup and not a
    // state change. Answer it locally so the guard turn never waits on
    // the model.
    if (isFilingGuardQuestion(trimmed)) {
      answerLocally(FILING_GUARD_REPLY, trimmed, { cue: "adjust" });
      return;
    }

    // Querying the company name: answer locally with the fictional demo name instantly
    if (isCompanyNameQuestion(trimmed)) {
      answerLocally(companyNameReply(), trimmed, { cue: "adjust" });
      return;
    }

    // Mission 2: the company name has its own approval beat immediately
    // after the home base and before equity. Handled locally so the exact
    // approval can never stall on a model.
    if (beatProgress(live).nextBeat === "name") {
      const proposed = parseSpokenCompanyName(trimmed);
      if (isNameApproval(trimmed) || proposed) {
        recordHeardTurn(trimmed);
        approveCompanyName(proposed ?? DEMO_COMPANY_NAME);
        return;
      }
      if (isNameCancel(trimmed)) {
        answerLocally(
          `No problem — the name can wait. Say “Approve Galactic Bagels” or “Call it <your name>” when you're ready.`,
          trimmed,
          { module: "name", stageTab: "colony", cue: "highlight" },
        );
        return;
      }
      answerLocally(
        `I still need the company name. Say “Approve Galactic Bagels”, or “Call it” and a fictional name.`,
        trimmed,
        { module: "name", stageTab: "colony", cue: "highlight" },
      );
      return;
    }

    // Mission 4 is an interview: one structure, one explicit yes. A bulk
    // "finish the build" or an unrelated sentence must never tick several
    // structures or guess an answer. Undo stays an escape hatch.
    if (!equityConfirmRef.current && beatProgress(live).nextBeat === "checklist") {
      const nextItem = live.checklist.find((item) => !item.done);
      const lower = trimmed.toLowerCase();
      const undo = /^(?:actually[,\s]+)?(?:please\s+)?(?:undo|revert|take (?:that|it) back|scratch that)\b/.test(lower);
      if (nextItem && !undo) {
        const tellMore = /\b(?:tell me more|what is it|what does (?:that|it) mean|explain|more info|details)\b/.test(lower);
        const bulk = /\b(?:finish the build|build all|all five|tick off all|complete the build|raise all)\b/.test(lower);
        const negative = isChangeAnswer(trimmed);
        const affirmative =
          isConfirmationAnswer(trimmed) ||
          /^(?:yes|yep|yeah|sure|ok|okay|raise|build|place|deploy|assemble|construct|do it|go ahead|put it up|go for it|proceed)\b/.test(lower);
        if (tellMore) {
          answerLocally(buildGuideLine(nextItem), trimmed, {
            module: "checklist",
            stageTab: "colony",
            cue: "highlight",
          });
          return;
        }
        if (bulk) {
          // Never bulk-complete the build. Ask the current question again.
          answerLocally(buildQuestionLine(live), trimmed, {
            module: "checklist",
            stageTab: "colony",
            cue: "highlight",
          });
          return;
        }
        if (affirmative) {
          previewKeyRef.current = null;
          pendingTurnRef.current = null;
          setLivePreview(null);
          setLiveTranscript(trimmed);
          setLastTranscript(trimmed);
          commit("checklist", (s) => applyChecklistItem(s, nextItem.id, true));
          writeShared({ ...withDefaults(stateRef.current), transcript: trimmed });
          const current = withDefaults(stateRef.current);
          const line = buildRaisedLine(current, nextItem.label);
          setLocalHost(line);
          setAck("");
          if (settingsRef.current.voiceOn && unlockedRef.current) {
            lastSpokenRef.current = spokenHostText(line);
            speakNative(line);
          }
          return;
        }
        if (negative) {
          answerLocally(buildQuestionLine(live), trimmed, {
            module: "checklist",
            stageTab: "colony",
            cue: "highlight",
          });
          return;
        }
        // Nothing recognisable as an answer: ask again. Do not let the
        // agent invent a tick from an ordinary sentence.
        answerLocally(buildQuestionLine(live), trimmed, {
          module: "checklist",
          stageTab: "colony",
          cue: "highlight",
        });
        return;
      }
    }

    const intent = parseLiveIntent(trimmed);
    const fast = Boolean(intent && FAST_INTENT_KINDS.has(intent.kind));
    logEvent(`intent ${intent?.kind ?? "none"} fast=${fast}`);

    // No spoken "On it." filler on the model path. A spoken
    // acknowledgement would start before the reply arrives, so the caption
    // would show one line while the ear heard another. The THINKING phase
    // and the think cue carry that moment, and the reply is the first
    // spoken line after the turn.
    // Paint instantly, confirm asynchronously. Authoritative commit for this turn:
    // reset keys so state appliers (e.g. jurisdiction pick) always execute.
    previewKeyRef.current = null;
    committedKeyRef.current = null;
    const applied = applyLiveIntent(trimmed, "confirming");
    setLiveTranscript(trimmed);
    setLastTranscript(trimmed);
    writeShared({ ...withDefaults(stateRef.current), transcript: trimmed });

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
        line = withCommander(`Fresh start.${question ? ` ${question}` : ""}`);
      } else {
        line = localFastLine(applied, stateRef.current);
      }
      pendingTurnRef.current = null;
      setLivePreview({ key: applied.key, label: applied.label, status: "confirmed" });
      setAck("");
      if (line) {
        setLocalHost(line);
        const spoken = spokenHostText(line);
        if (settingsRef.current.voiceOn && unlockedRef.current && spoken !== lastSpokenRef.current) {
          lastSpokenRef.current = spoken;
          speakNative(line);
        }
      }
      return;
    }

    // Model path: clear the local line so the agent's reply can take over.
    setLocalHost("");
    const sel = live.selectedJurisdiction;
    const mentioned = DEMO_JURISDICTIONS.map((r) => r.jurisdiction).find((name) => trimmed.toLowerCase().includes(name.toLowerCase()));
    if (sel && mentioned && mentioned.toLowerCase() === sel.toLowerCase()) {
      setAck(`${sel} again — confirming ${sel} as your home base.`);
    } else {
      setAck("");
    }
    pendingTurnRef.current = { signature: turnResultSignature(live, hostPrompt.text), text: trimmed, beat: live.currentBeat };
    playCue("think");
    setSending(true);
    messageIdRef.current += 1;
    activeVoiceTurnRef.current = fromVoice;
    try {
      agent?.addMessage({
        id: `msg-${messageIdRef.current}`,
        role: "user",
        content: trimmed,
      });
      if (agent) await copilotkit.runAgent({ agent });
    } catch (error) {
      const detail = error instanceof Error ? error.message : "the agent run failed";
      setTurnError(`Agent error: ${detail}. Nothing was changed by that turn — say the command again.`);
      surfaceRecovery("agent-error", detail);
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
    // Realtime streaming transcription exists only for the Meta provider.
    if (!providerRef.current.streamingAsr) return;
    try {
      const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
      const wsUrl = `${protocol}//${window.location.host}/api/asr-stream`;
      const ws = new WebSocket(wsUrl);
      asrSocketRef.current = ws;
      ws.binaryType = "arraybuffer";

      ws.onopen = () => {
        streamingReadyRef.current = true;
        logEvent("asr socket open");
      };

      ws.onmessage = (event: MessageEvent) => {
        try {
          const raw = typeof event.data === "string" ? event.data : new TextDecoder().decode(event.data as ArrayBuffer);
          const msg = JSON.parse(raw) as Record<string, unknown>;
          const type = msg.type as string | undefined;

          if (type === "speechStart") {
            asrLastEventAtRef.current = performance.now();
            logEvent(`asr speechStart ${String(msg.turnId)}`);
            const turnId = msg.turnId as number | undefined;
            if (turnId !== undefined) {
              activeTurnIdRef.current = turnId;
              endpointerRef.current?.setActiveTurnId(turnId);
            }
            endpointerRef.current?.handleMetaEvent(msg);
          } else if (type === "transcript") {
            asrLastEventAtRef.current = performance.now();
            const transcript = msg.transcript as string | undefined;
            const turnId = (msg.turnId as number | undefined) ?? activeTurnIdRef.current;
            if (bufferedFallbackTurnRef.current === turnId) return;
            if (completedStreamingTurnRef.current === turnId) return;
            logEvent(`asr transcript ${JSON.stringify(transcript)}`);
            if (transcript) {
              // Only treat words as self-echo while the host is actually
              // speaking. Once the host stops, the user's reply is theirs.
              const hostActive = turn.get().hostSpeaking || speechQueue.isSpeaking();
              if (echoFilter.checkWhileHostActive(hostActive, turnId, transcript)) {
                return;
              }
              handleLiveTranscript(transcript, false);
              endpointerRef.current?.onTranscript(transcript);
            }
            endpointerRef.current?.handleMetaEvent(msg);
          } else if (type === "speechEnd") {
            const turnId = (msg.turnId as number | undefined) ?? activeTurnIdRef.current;
            if (echoFilter.isTurnIgnored(turnId)) return;
            endpointerRef.current?.handleMetaEvent(msg);
          } else if (type === "speechComplete") {
            asrLastEventAtRef.current = performance.now();
            const transcript = (msg.transcript as string | undefined) ?? "";
            logEvent(`asr speechComplete ${JSON.stringify(transcript)}`);
            const turnId = (msg.turnId as number | undefined) ?? activeTurnIdRef.current;
            if (bufferedFallbackTurnRef.current === turnId) return;
            if (completedStreamingTurnRef.current === turnId) return;
            if (
              echoFilter.checkWhileHostActive(
                turn.get().hostSpeaking || speechQueue.isSpeaking(),
                turnId,
                transcript,
              )
            ) {
              return;
            }
            if (endpointerRef.current) {
              endpointerRef.current.handleMetaEvent(msg);
            } else {
              onStreamingSpeechComplete(transcript, turnId);
            }
          } else if (type === "ready") {
            streamingReadyRef.current = true;
            // A new Meta session restarts its turn ids; do not carry old
            // tombstones across sessions.
            completedStreamingTurnRef.current = null;
            bufferedFallbackTurnRef.current = null;
            logEvent("asr relay ready");
          } else if (type === "error") {
            console.warn("[asr-stream] upstream error:", msg.message);
          }
        } catch {
          // ignore malformed
        }
      };

      ws.onclose = () => {
        const wasReady = streamingReadyRef.current;
        streamingReadyRef.current = false;
        asrSocketRef.current = null;
        logEvent("asr socket closed");
        // A live socket that drops mid-turn is a recovery event, not a
        // console line. The buffered fallback carries the audio.
        if (wasReady && turn.get().convo && micHot(turn.get()) && !finishingRef.current) {
          surfaceRecovery("stream-lost");
        }
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
    if (endpointerRef.current?.isFastCommitted(turnId)) {
      return;
    }
    // Meta can deliver a late duplicate final after the next turn has
    // already opened. Only the first final for a turn may speak or paint.
    if (completedStreamingTurnRef.current === turnId) {
      logEvent(`duplicate speechComplete ignored ${turnId}`);
      return;
    }
    completedStreamingTurnRef.current = turnId;
    finishingRef.current = true;
    turn.dispatch({ type: "MIC_CLOSED" });
    isTurnListeningRef.current = false;
    stopWebSpeech();
    setMicLevel(0);
    stampTiming("finalTranscript");

    const trimmed = (transcript ?? "").trim();
    logEvent(`model commit ${JSON.stringify(trimmed)}`);
    void (async () => {
      try {
        if (isEmptyTranscript(trimmed)) {
          // No speech in this turn: keep the current host line, but never
          // go back to a silent LISTENING. Surface the gap and re-arm.
          if (!activityRef.current.hasSpoken) {
            surfaceRecovery("empty-turn", "The turn ended without speech.");
            return;
          }
          // The user did speak but streaming lost the words; the buffered
          // audio is the same utterance, so try the batch recogniser.
          const retried = await sendBufferedChunks();
          if (retried) return;
          const line = emptyTranscriptReply();
          setLocalHost(line);
          setNotice(line);
          surfaceRecovery("empty-turn", "Streaming and the batch fallback both returned no words.");
          if (voiceOn && unlockedRef.current) {
            lastSpokenRef.current = spokenHostText(line);
            speakNative(line);
          }
          return;
        }

        // --- Slow-speech continuation ----------------------------------
        // A recognizer final is not always a complete thought. The shared
        // decision (lib/voice-final.ts) merges a held beginning, or holds a
        // visibly unfinished final and keeps the mic open.
        const finalText = holdOrMerge(trimmed);
        if (finalText === null) return;
        await sendToAgent(finalText, true);
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
    mic.stop();
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
        if (turn.get().hostSpeaking || speechQueue.isSpeaking()) return;
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
        if (streamingReadyRef.current) {
          // Meta streaming is active: its endpointing and HybridEndpointer
          // are the authority. The browser recogniser must never tear
          // down the streaming turn early.
          return;
        }
        // Meta (stream down): the recogniser is a preview, so only a
        // matched command ends the turn. Gemini: its words are the turn.
        const turnReady =
          providerRef.current.provider === "meta"
            ? intentMatchedRef.current || (equityConfirmRef.current && isConfirmationAnswer(liveTranscriptRef.current))
            : liveTranscriptRef.current.trim().length > 0;
        if (
          micHot(turn.get()) &&
          !finishingRef.current &&
          turnReady
        ) {
          void finishRecording();
          return;
        }
        // Chrome ends recognition after a pause; re-arm while the mic
        // is still hot so a second sentence is heard too.
        if (micHot(turn.get()) && !webSpeechFailedRef.current) {
          setTimeout(() => {
            if (micHot(turn.get())) startWebSpeech();
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
      clearRearmTimer();
      clearConfirmationTimer();
      if (recoveryTimerRef.current !== null) clearTimeout(recoveryTimerRef.current);
      if (continuationTimerRef.current !== null) clearTimeout(continuationTimerRef.current);
      if (summaryBuildRef.current?.timer) clearTimeout(summaryBuildRef.current.timer);
      if (summarySpeakTimerRef.current !== null) clearTimeout(summarySpeakTimerRef.current);
      recoveryTimerRef.current = null;
      continuationTimerRef.current = null;
      summaryBuildRef.current = null;
      summarySpeakTimerRef.current = null;
      summaryBuildTokenRef.current += 1;
      host.dispose();
      if (travelFrameRef.current !== null) cancelAnimationFrame(travelFrameRef.current);
      neural.dispose();
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
      setMicLevel(Math.min(1, mic.level() * 3.5));
    }, 200);
    const clock = setInterval(() => setRecordSeconds((s) => s + 1), 1000);
    return () => {
      clearInterval(meter);
      clearInterval(clock);
    };
  }, [recording, mic]);

  // A long turn with audible speech but no transcript is a visible
  // recovery, not an endless LISTENING screen. The mic is left open: a
  // slow speaker may still be mid-thought.
  useEffect(() => {
    if (!recording) {
      listeningStallShownRef.current = false;
      return;
    }
    if (listeningStallShownRef.current) return;
    if (
      isListeningStall({
        recording: true,
        hasTranscript: Boolean(liveTranscript),
        heardAudio: mic.peak() > 0.02,
        listenedMs: recordSeconds * 1000,
      })
    ) {
      listeningStallShownRef.current = true;
      surfaceRecovery("listening-stall");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recording, recordSeconds, liveTranscript]);

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
      const text = holdOrMerge(stripAsrAnnotations(transcript));
      if (text !== null) await sendToAgent(text, true);
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

  // Buffered fallback for the streaming path. The worklet keeps every
  // captured block, so when Meta streaming ends a turn empty — or never
  // reports a turn at all — the same audio can still be transcribed
  // through the reliable batch endpoint instead of dropping the turn.
  // Returns true when the turn was sent (even if the transcript is empty).
  async function sendBufferedChunks(): Promise<boolean> {
    const { chunks, rate: inputRate } = mic.takeBuffered();
    if (chunks.length === 0) return false;
    if (!inputRate || inputRate <= 0) return false;
    const samples = concatFloat32(chunks);
    if (samples.length === 0) return false;
    const pcm = toPcm16k(samples, inputRate);
    if (pcm.byteLength === 0 || pcm.byteLength % 2 !== 0) return false;
    const buf = new ArrayBuffer(pcm.byteLength);
    new Int16Array(buf).set(pcm);
    lastAudioRef.current = buf;
    setHasLastAudio(true);
    await transcribeAndSend(buf);
    return true;
  }

  async function finishRecording() {
    clearConfirmationTimer();
    if (finishingRef.current) return;
    finishingRef.current = true;

    // Meta streaming: check for a pending fast-commit to fire first.
    if (streamingReadyRef.current) {
      if (endpointerRef.current?.forceFastCommitNow(liveTranscriptRef.current)) {
        finishingRef.current = false;
        return;
      }
      turn.dispatch({ type: "MIC_CLOSED" });
      isTurnListeningRef.current = false;
      stopWebSpeech();
      setMicLevel(0);
      // Streaming never delivered this turn. Keep the audio usable: send
      // the buffered utterance through the batch recogniser. Tombstone the
      // streamed turn so a late Meta final cannot run the command twice.
      bufferedFallbackTurnRef.current = activeTurnIdRef.current;
      completedStreamingTurnRef.current = activeTurnIdRef.current;
      try {
        await sendBufferedChunks();
      } finally {
        finishingRef.current = false;
      }
      return;
    }

    turn.dispatch({ type: "MIC_CLOSED" });
    isTurnListeningRef.current = false;
    stopWebSpeech();
    setMicLevel(0);

    // Gemini: the browser recogniser already has the words, so the turn
    // goes straight to the brain with no transcription round trip. With no
    // recogniser (Firefox, Safari) the buffered audio below is transcribed.
    // Meta: the recogniser is only a preview; Meta's transcript decides.
    const recognized = providerRef.current.provider === "meta" ? "" : liveTranscriptRef.current.trim();
    if (recognized) {
      mic.discardBuffered();
      stampTiming("finalTranscript");
      try {
        const text = holdOrMerge(recognized);
        if (text !== null) await sendToAgent(text, true);
      } finally {
        finishingRef.current = false;
      }
      return;
    }

    const { chunks, rate: inputRate } = mic.takeBuffered();
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
        `[vvb-timing] turn ended, peak RMS: ${mic.peak().toFixed(4)}, speechMs: ${activityRef.current.speechMs.toFixed(0)}ms`,
      );
      await transcribeAndSend(buf);
    } finally {
      finishingRef.current = false;
    }
  }

  async function handleNoSpeechTimeout() {
    clearConfirmationTimer();
    // Silence while the app is actively building or speaking is not a
    // stalled turn. The no-speech guard must not cut into the async
    // summary start/completion.
    if (summaryBuildRef.current || summarySpeakTimerRef.current || turn.get().hostSpeaking) return;
    if (finishingRef.current) return;
    finishingRef.current = true;
    turn.dispatch({ type: "MIC_CLOSED" });
    isTurnListeningRef.current = false;
    stopWebSpeech();
    setMicLevel(0);
    // If the user did speak but streaming never reported a turn, the
    // buffered audio still holds the utterance. Transcribe it rather
    // than claiming silence.
    if (activityRef.current.hasSpoken) {
      try {
        const sent = await sendBufferedChunks();
        if (sent) {
          noSpeechAttemptsRef.current = 0;
          finishingRef.current = false;
          return;
        }
      } catch {
        // Fall through to the visible no-speech line.
      }
    }
    finishingRef.current = false;

    const attempts = noSpeechAttemptsRef.current;
    noSpeechAttemptsRef.current = attempts + 1;
    if (attempts === 0) {
      const line = noSpeechReply();
      setLocalHost(line);
      if (settingsRef.current.voiceOn && unlockedRef.current) {
        lastSpokenRef.current = spokenHostText(line);
        speakNative(line);
      }
    }
    // The visible recovery banner carries the state; a second notice line
    // would repeat it above the captions.
    surfaceRecovery("no-speech", attempts === 0 ? "" : "The new turn heard no words; the mic is open again.");
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
      turn.dispatch({ type: "CONVO_END" });
      dropQueuedTurn();
      await finishRecording();
      cleanupAudio();
      return;
    }
    if (turn.get().convo && (transcribing || sending || isLoading)) {
      // Ending a conversation while the agent is mid-turn: just stop
      // re-arming the mic; the current turn finishes on its own.
      turn.dispatch({ type: "CONVO_END" });
      dropQueuedTurn();
      cleanupAudio();
      return;
    }
    unlockedRef.current = true;
    if (convoOn) {
      turn.dispatch({ type: "CONVO_START" });
    }
    setDockOpen(false);

    // First Speak: greet with the existing home-base question, then open
    // the mic. This is presentation only — no shared state and no fact.
    if (consumeFirstSpeakGreeting()) {
      if (voiceOn && typeof window !== "undefined" && window.speechSynthesis) {
        refreshCachedVoice();
        const greeting = withCommander(FIRST_SPEAK_GREETING);
        setLocalHost(greeting);
        if (speakNative(greeting, () => { void startRecording(); })) {
          return;
        }
      }
    }

    await startRecording();
  }

  // The turn's decisions for each captured block (components/hooks/
  // useMicCapture.ts owns the hardware): no-speech, the length cap, the
  // streaming watchdog, and local end-of-speech.
  function onMicBlock({ level, now, blockMs }: MicBlock) {
    endpointerRef.current?.onAudioRms(level, now);
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

    // Guard 3 (streaming watchdog): the user spoke, the mic is quiet,
    // and Meta has not reported a turn for several seconds. Do not wait
    // forever or drop the turn: transcribe the buffered audio instead.
    if (
      streamingReadyRef.current &&
      activityRef.current.hasSpoken &&
      activityRef.current.lastSpeechAt !== null &&
      now - activityRef.current.lastSpeechAt > 1800 &&
      now - asrLastEventAtRef.current > 3800
    ) {
      logEvent("streaming watchdog → buffered fallback");
      void finishRecording();
      return;
    }

    activityRef.current = nextVoiceActivity(activityRef.current, level, now, blockMs);

    // Demote client RMS/silence gate:
    // When streaming ASR is active, Meta endpointing is the authority for turn end.
    // If streaming is not active, fall back to local auto-stop.
    if (!streamingReadyRef.current) {
      const silence = autoStopSilence(settingsRef.current.slowMode, intentMatchedRef.current);
      if (shouldAutoStop(activityRef.current, now, silence)) {
        void finishRecording();
        return;
      }
    }

    if (mic.bufferedPcmBytes() > MAX_PCM_BYTES) {
      void finishRecording();
    }
  }

  // Open the mic for a new turn (the user asked, or a greeting ended).
  // A fired re-arm has already moved the machine to "opening" and calls
  // openMic directly.
  async function startRecording() {
    if (micHot(turn.get())) return;
    turn.dispatch({ type: "MIC_REQUEST" });
    await openMic();
  }

  async function openMic() {
    mic.resetTurn();
    asrLastEventAtRef.current = performance.now();
    bufferedFallbackTurnRef.current = null;
    logEvent(`startRecording streaming=${streamingReadyRef.current} socket=${asrSocketRef.current?.readyState ?? -1}`);
    clearRearmTimer();
    clearConfirmationTimer();
    liveTranscriptRef.current = "";
    activeTurnIdRef.current += 1;
    endpointerRef.current?.setActiveTurnId(activeTurnIdRef.current);
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
    previewKeyRef.current = null;
    committedKeyRef.current = null;
    intentMatchedRef.current = false;
    listeningStallShownRef.current = false;
    setLiveTranscript("");
    setLivePreview(null);
    setMicLevel(0);
    setRecordSeconds(0);
    finishingRef.current = false;

    try {
      await mic.ensure();
      if (settingsRef.current.slowMode) {
        // Slow mode: the local, generous silence window is the authority.
        // No streaming socket, so Meta cannot end the turn on a short pause.
        try {
          asrSocketRef.current?.close();
        } catch {
          // ignore
        }
        asrSocketRef.current = null;
        streamingReadyRef.current = false;
      } else {
        ensureAsrStreamSocket();
      }
      turn.dispatch({ type: "MIC_OPEN" });
      playCue("listen");
      // Gemini: the browser recogniser supplies the live words. Meta:
      // streaming transcription is the authority, and the browser
      // recogniser is only a preview while the stream is down.
      if (!streamingReadyRef.current) startWebSpeech();
    } catch (error) {
      cleanupAudio();
      isTurnListeningRef.current = false;
      // End the loop on a failed capture. Otherwise the UI says
      // "conversation live" while the auto-listen effect retries the
      // same broken context forever. TALK or typing can start again.
      turn.dispatch({ type: "MIC_FAILED" });
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
  const voiceAudiblyOn = settings.voiceOn && settings.volume > 0.01;

  // The visible host line is always the thing the transcript records and
  // "repeat that" replays. It uses the same spokenHostText cap as the TTS
  // path, so the caption equals the audio.
  //
  // While an agent turn is in flight, the fallback question is provisional:
  // the reply will replace it. Logging that provisional line would put a
  // sentence in the caption history that was never said. Spoken lines are
  // still logged by speakNative itself, before the mute check.
  useEffect(() => {
    const text = hostCaption(hostPrompt.text);
    if (!text) return;
    // With voice on, every line that is actually said is logged by
    // speakNative. Logging the visible prompt here too would record the
    // provisional fallback question an agent turn shows while thinking —
    // words the ear never heard. With voice off, the screen is the only
    // channel, so the visible line is the record.
    if (voiceOn) return;
    lastHostLineRef.current = text;
    const timer = setTimeout(() => appendLog("host", text), 0);
    return () => clearTimeout(timer);
  }, [hostPrompt.text, voiceOn]);

  // Autosave: a break never loses the run. The write is debounced so a
  // slider drag or a live tick does not hammer localStorage. Loading a
  // saved run is fail-safe (lib/persistence.ts).
  useEffect(() => {
    const timer = setTimeout(() => {
      const ok = saveSession(withDefaults(view), settingsRef.current, logRef.current);
      setSavedNotice(ok ? `Autosaved ${new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}` : "Autosave unavailable");
    }, 350);
    return () => clearTimeout(timer);
  }, [view, settings, log]);

  // Learn which provider the server runs, then fetch the host's likely
  // next line ahead of time so neural speech starts without a network
  // wait (lib/host-tts.ts). hostPrompt.text is the next question on screen.
  useEffect(() => {
    if (!voiceOn) return;
    let alive = true;
    void loadProviderInfo().then((info) => {
      if (!alive) return;
      providerRef.current = info;
      if (!info.neuralVoice) return;
      const next = spokenHostText(hostPrompt.text);
      if (next) hostTts.prefetch(next);
      hostTts.prefetch(spokenHostText(withCommander(FIRST_SPEAK_GREETING)));
    });
    return () => {
      alive = false;
    };
  }, [hostPrompt.text, voiceOn]);

  // Voice-first boot: the cockpit opens the conversation and the mic on
  // its own after the landing gate. No click, no "press TALK" step.
  useEffect(() => {
    if (!autoStart) return;
    unlockedRef.current = true;
    // A saved run must never restore into silence just because VOX was
    // off or the volume was 0. Entering by voice means the founder expects
    // a spoken reply; re-enable it for this session, visibly.
    if (!settingsRef.current.voiceOn || settingsRef.current.volume <= 0.01) {
      updateVoiceSettings({ voiceOn: true, volume: 1, soundOn: true, sound: 0.8 });
    }
    refreshCachedVoice();
    const timer = setTimeout(() => {
      // The conversation starts with the greeting, so the loop cannot
      // open the mic over it.
      turn.dispatch({ type: "CONVO_START" });
      const current = withDefaults(stateRef.current);
      const line = resumed
        ? withCommander(resumeSummary(current))
        : withCommander(FIRST_SPEAK_GREETING);
      setLocalHost(line);
      const begin = () => {
        if (turn.get().convo && !micHot(turn.get())) void startRecording();
      };
      const spoke = speakNative(line, begin);
      if (!spoke) begin();
    }, 450);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoStart, resumed]);

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

  // What is in flight, and whether an error is on screen, as the turn
  // machine sees them (the re-arm rule reads these).
  useEffect(() => {
    turn.dispatch({ type: "WORK", key: "transcribing", on: transcribing });
    turn.dispatch({ type: "WORK", key: "sending", on: sending });
    turn.dispatch({ type: "WORK", key: "agent", on: isLoading });
  }, [transcribing, sending, isLoading, turn]);
  useEffect(() => {
    turn.dispatch({ type: "ERROR", on: Boolean(turnError || transcribeFailure) });
  }, [turnError, transcribeFailure, turn]);

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
    const { send, slot } = flushQueuedTurn(queuedTurnRef.current, false, turn.get().convo);
    queuedTurnRef.current = slot;
    dropQueuedTurnNotice();
    if (send) void sendToAgent(send);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sending, isLoading]);

  // Conversation loop: when the agent has finished speaking, re-open
  // the mic automatically so the talk never "just ends". An error is a
  // visible recovery, not a silent pause: show it, then re-arm by itself.
  useEffect(() => {
    if (!convoActive || recording || transcribing || sending || isLoading || hostSpeaking) return;
    if (turnError || transcribeFailure) {
      const t = setTimeout(() => {
        const now = turn.get();
        if (!now.convo) return;
        if (micHot(now) || isBusy(now)) return;
        // Recover hands-free: the error banner has been visible for the
        // recovery beat, so reopen the mic and let the user retry by
        // voice. startRecording clears the stale error state.
        void startRecording();
      }, RECOVERY_REARM_MS);
      return () => clearTimeout(t);
    }
    // Re-arm on utterance onend/onerror and turn completion, not by polling speechSynthesis.speaking.
    // If not recording and lane is completely idle and no speech is active, request a re-arm.
    if (turn.get().convo && !micHot(turn.get()) && !hostSpeaking) {
      requestRearm();
    }
    // requestRearm is an intentional stable closure over refs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [convoActive, recording, transcribing, sending, isLoading, turnError, transcribeFailure, hostSpeaking]);

  // Errors get a dull buzz, never silence.
  useEffect(() => {
    if (turnError || transcribeFailure) playCue("error");
  }, [turnError, transcribeFailure, playCue]);

  // The host line is the outcome of a turn. When VOX is on it is already
  // spoken by TTS; when VOX is off, put it in the one live region. The
  // budget drops a third message in the same turn. Errors/notices keep
  // their own roles and suppress this so nothing is announced twice.
  useEffect(() => {
    if (!localHost) return;
    if (lastAnnouncedOutcomeRef.current === localHost) return;
    lastAnnouncedOutcomeRef.current = localHost;
    announceOutcome(localHost);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [localHost, voiceOn, notice]);

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
      surfaceRecovery("agent-timeout");
    }, AGENT_WATCHDOG_MS);
    return () => clearTimeout(timer);
    // surfaceRecovery is intentionally read through the live refs it uses.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLoading, sending, stopGeneration]);

  // Hands-free testing & mock-voice simulation hook:
  // Enables automated test playthroughs and mock audio runs to feed voice
  // commands, simulate speech recognition events, and test host speech hands-free.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const win = window as unknown as Record<string, unknown>;
    win.__vvbVoice = {
      isRecording: () => micHot(turn.get()),
      getPhase: () =>
        recording ? "recording" : transcribing ? "transcribing" : sending ? "sending" : isLoading ? "agent-busy" : "idle",
      isHostSpeaking: () => Boolean(hostSpeaking || isSpeechActive()),
      getState: () => withDefaults(stateRef.current),
      getLog: () => [...logRef.current],
      getSettings: () => ({ ...settingsRef.current }),
      getLastSpoken: () => lastHostLineRef.current,
      getEvents: () => [...eventsRef.current],
      getAudioStats: () => mic.stats(),
      getHostAudio: () => host.stats(),
      getAsrState: () => ({
        ready: streamingReadyRef.current,
        socket: asrSocketRef.current?.readyState ?? -1,
      }),
      isListening: () => isTurnListeningRef.current,
      isTranscriptOpen: () => transcriptOpen,
      getRecovery: () => recovery,
      getContinuation: () => continuation,
      getSummaryBuild: () => summaryBuild,
      simulateToolTimeout: () => {
        const line = toolTimeoutLine("demo", TOOL_TIMEOUT_MS);
        setTurnError(line);
        surfaceRecovery("tool-timeout", line);
        return line;
      },
      getCaption: () => ({
        host: hostCaption(hostPrompt.text),
        heard: heardCaption(liveTranscript) || heardCaption(lastTranscript || view.transcript),
        phase: captionPhase({
          convoActive,
          recording,
          hasLiveWords: Boolean(liveTranscript),
          hostSpeaking,
          busy: transcribing || sending || isLoading,
          recovering: Boolean(recovery) && !recording,
          rearming,
        }),
        history: logRef.current.length,
      }),
      feedVoice: async (text: string) => {
        handleLiveTranscript(text);
        setMicLevel(0.85);
        await new Promise((resolve) => setTimeout(resolve, 250));
        stopWebSpeech();
        stampTiming("finalTranscript");
        isTurnListeningRef.current = false;
        turn.dispatch({ type: "MIC_CLOSED" });
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
  }, [recording, transcribing, sending, isLoading, hostSpeaking, transcriptOpen, recovery, rearming, liveTranscript, continuation, lastTranscript, summaryBuild]);

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
  const flowStatus = recovery
    ? `${recovery.headline} — ${recovery.nextStep}`
    : recording
      ? liveTranscript
        ? "Listening — canvas is updating as you speak. Pause for a second and it sends itself."
        : "Listening — take your time. The canvas updates as you speak."
      : transcribing
        ? "Heard you — transcribing with Muse Voice…"
        : busy
          ? "Thinking — the canvas already shows the change; the mic re-opens next."
          : rearming
            ? "Mic re-arming — your turn opens by itself."
            : hostSpeaking
              ? "Host is speaking — the mic opens when the line finishes."
              : livePreview?.status === "confirmed"
                ? "Painted and confirmed — the host has the same line."
                : "Talk or type a command — the canvas moves as you speak.";
  const shownTranscript = lastTranscript || view.transcript;
  // Captions are the primary channel. The host text is the exact spoken
  // line (same spokenHostText cap), and the heard text is the exact
  // transcript after ASR annotations are stripped.
  const heardState = heardCaptionState(liveTranscript, shownTranscript, recording);
  const heardText = heardState === "live" ? heardCaption(liveTranscript) : heardCaption(shownTranscript);
  const captionState = captionPhase({
    convoActive,
    recording,
    hasLiveWords: Boolean(liveTranscript),
    hostSpeaking,
    busy,
    // The banner already surfaces the recovery. While the mic is actually
    // open, say LISTENING, not "the mic re-arms" — the screen must match
    // the microphone.
    recovering: Boolean(recovery) && !recording,
    rearming,
  });
  // While the agent thinks, keep the last line it actually said on screen.
  // The fallback question is a plan, not a spoken caption; showing it here
  // would put words on screen the ear never heard.
  const thinkingHostLine =
    (sending || isLoading) && !localHost ? lastHostLineRef.current : "";
  const hostDisplay = hostCaption(thinkingHostLine || hostPrompt.text);
  const hostHealth = !voiceAudiblyOn
    ? "VOICE OFF"
    : hostSilent
      ? "SILENT"
      : hostSpeaking
        ? "SPEAKING"
        : "READY";
  const showHold = Boolean(continuation) && !hostSpeaking;
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
          setTurnError("Agent finished without changing anything — the turn may have hit a locked thread or an agent error. Nothing was changed; say the command again.");
          surfaceRecovery("nothing-changed");
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
  }, [playCue]);

  const structures = colonyProgress(view.checklist);
  const flight = flightPlan(view, activeModule);
  // The five required missions stay in the open; the one optional
  // filing archive and the detailed plan stay tucked away.
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
      <HudHeader
        doneCount={doneCount}
        requiredTotal={progress.requiredTotal}
        flight={flight}
        activeModule={activeModule}
        selectModule={selectModule}
      />

      <div className="bridge">
        <aside className="rail rail-mission" aria-label="Mission control">
          <MissionObjective
            equityConfirm={equityConfirm}
            ownerCount={view.founders.length}
            equityLabel={equityLabel}
            mission={mission}
            celebrated={celebrated}
            doneCount={doneCount}
            requiredTotal={progress.requiredTotal}
            checklist={view.checklist}
            structures={structures}
            nextChecklistId={nextChecklistId}
            canSend={canSend}
            requiredFlight={requiredFlight}
            archiveFlight={archiveFlight}
            activeModule={activeModule}
            selectModule={selectModule}
            confirmEquitySelection={confirmEquitySelection}
            updateChecklistItem={updateChecklistItem}
            onApproveName={() => approveCompanyName(DEMO_COMPANY_NAME)}
            onChipCommand={(command) => void sendToAgent(command)}
          />
          {/* Captions are a primary channel, not a modal. The full run
              stays on screen in the left rail and auto-scrolls. */}
          <CaptionHistory entries={log} />
        </aside>

        <ShipViewport
          view={view}
          stageTab={stageTab}
          selectStage={selectStage}
          handleSelectJurisdiction={handleSelectJurisdiction}
          clockLabel={clockLabel}
          homeBase={homeBase}
          structures={structures}
          equityLabel={equityLabel}
          ship={ship}
          activeMeta={activeMeta}
          travel={travel}
          travelColor={travelColor}
        />

        <SystemsRail
          view={view}
          flight={flight}
          requiredModules={requiredModules}
          archiveModules={archiveModules}
          activeModule={activeModule}
          activeMeta={activeMeta}
          activeStep={activeStep}
          archiveOpen={archiveOpen}
          setArchiveOpen={setArchiveOpen}
          selectModule={selectModule}
          handleSelectJurisdiction={handleSelectJurisdiction}
          onShareChange={(index, percent) => updateEquity(index, percent, "slider")}
          updateOwnerCount={updateOwnerCount}
          updateChecklistItem={updateChecklistItem}
          onApproveName={() => approveCompanyName(DEMO_COMPANY_NAME)}
          onPrepareSummary={() => prepareLawyerPackage(true)}
          verification={verification}
          checklistFlags={checklistFlags}
          filingFlag={filingFlag}
        />
      </div>

      <footer className="deck" data-testid="command-deck" data-phase={turnPhase}>
        {dockOpen ? (
          <ControlsPopout
            convoOn={convoOn}
            canSend={canSend}
            soundOn={soundOn}
            voiceOn={voiceOn}
            clockLabel={clockLabel}
            shownTranscript={shownTranscript}
            onClose={() => setDockOpen(false)}
            onToggleConvo={() => {
              const next = !convoOn;
              setConvoOn(next);
              if (!next) {
                turn.dispatch({ type: "CONVO_END" });
                dropQueuedTurn();
              }
            }}
            onChipCommand={(command) => void sendToAgent(command)}
            onToggleSound={() => updateVoiceSettings({ soundOn: !soundOn })}
            onToggleVoice={() => {
              if (voiceOn) cancelSpeech();
              updateVoiceSettings({ voiceOn: !voiceOn });
            }}
            selectHostVoice={selectHostVoice}
            previewHostVoice={previewHostVoice}
          />
        ) : null}

        <DeckStatus
          turnPhase={turnPhase}
          recovery={recovery}
          rearming={rearming}
          hostSpeaking={hostSpeaking}
          elapsed={elapsed}
          captionState={captionState}
          flowStatus={flowStatus}
          settings={settings}
          voiceAudiblyOn={voiceAudiblyOn}
          hostSilent={hostSilent}
          savedNotice={savedNotice}
          voiceOn={voiceOn}
          announcement={announcement}
          turnError={turnError}
          transcribeFailure={transcribeFailure}
          hasLastAudio={hasLastAudio}
          retryDisabled={recording || transcribing || sending || isLoading}
          retryTranscribe={retryTranscribe}
          notice={notice}
        />

        <DeckMain
          recording={recording}
          convoActive={convoActive}
          micDisabled={!recording && !convoActive && (transcribing || sending || isLoading)}
          micLabel={micLabel}
          busy={busy}
          onToggleRecording={() => {
            void toggleRecording();
          }}
          hostText={hostDisplay}
          heardText={heardText}
          heardState={heardState}
          captionState={captionState}
          hostHealth={hostHealth}
          ack={ack}
          holdText={showHold ? continuation?.text ?? null : null}
          summaryBuild={summaryBuild}
          recordSeconds={recordSeconds}
          micLevel={micLevel}
          livePreview={livePreview}
          typed={typed}
          setTyped={setTyped}
          inputDisabled={recording || transcribing || sending || isLoading}
          canSend={canSend}
          onSendTyped={async () => {
            await sendToAgent(typed);
            setTyped("");
          }}
          historySize={historySize}
          onUndo={() => {
            undoLast();
          }}
          transcriptOpen={transcriptOpen}
          onToggleTranscript={() => setTranscriptVisibility(!transcriptOpen)}
          dockOpen={dockOpen}
          toggleControls={toggleControls}
        />

        <p className="deck-legal">
          DEMO ONLY · NOT LEGAL ADVICE · NOT A FILING · NOTHING SUBMITTED · NO EMAIL
        </p>
      </footer>

      {transcriptOpen ? (
        <TranscriptPanel log={log} onClose={() => setTranscriptVisibility(false)} />
      ) : null}
    </main>
  );

}

export default function CanvasHost(props: CanvasProps = {}) {
  return (
    <CopilotKitProvider
      runtimeUrl="/api/copilotkit"
      agentId="vvb"
      headers={() => ({
        "X-Voice-Turn": activeVoiceTurnRef.current ? "1" : "0",
      })}
    >
      <Canvas {...props} />
    </CopilotKitProvider>
  );
}
