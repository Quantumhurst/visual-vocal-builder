// Live voice intent — pure, unit-testable (no DOM, no React).
//
// Why this exists: the authoritative path (Meta ASR -> Muse Spark agent
// -> tool call) only lands after Stop recording + two network round
// trips, so the canvas looked dead while speaking. This module turns a
// partial transcript into a *speculative* intent the instant a command
// is recognisable. Canvas applies it through the SAME state appliers
// the agent uses (applyJurisdiction / applyEquity / ...), so every
// invariant (equity totals 100, grounded cards only from packs) still
// holds, and the agent turn that follows confirms or corrects it.
//
// Only unambiguous commands become intents. Questions (rollover /
// filing) never fabricate a card here — they only surface a "heard you"
// state; the grounded card still comes from the agent + knowledge pack.

export type LiveIntent =
  | { kind: "jurisdiction"; jurisdiction: string; key: string; label: string }
  | { kind: "equity"; founder: string; percent: number; key: string; label: string }
  | { kind: "checklist-advance"; key: string; label: string }
  | { kind: "lawyer-summary"; key: string; label: string }
  | { kind: "rollover-question"; key: string; label: string }
  | { kind: "filing-question"; key: string; label: string };

const PLANETS: { needle: string; name: string }[] = [
  { needle: "mars", name: "Mars" },
  { needle: "europa", name: "Europa" },
  { needle: "andromeda", name: "Andromeda Galaxy" },
];

function mentionedPlanets(lower: string): string[] {
  return PLANETS.filter((p) => lower.includes(p.needle)).map((p) => p.name);
}

export function parseLiveIntent(text: string): LiveIntent | null {
  const raw = (text ?? "").trim();
  if (!raw) return null;
  const lower = raw.toLowerCase();

  // Lawyer summary — checked first: it contains no planet/percent, but
  // "prepare the summary" must never fall through to a lesser match.
  if (/lawyer summary|prepare (the |my )?summary|send (it |this )?to (a |the )?lawyer/.test(lower)) {
    return { kind: "lawyer-summary", key: "lawyer-summary", label: "Preparing the lawyer summary…" };
  }

  // Equity: a founder token and a percent, in either order.
  // "make orbit 70%", "make me 70%", "70% for nova", "set nova to 70 percent"
  const founderMatch = lower.match(/\b(nova|orbit|me|i)\b/);
  const percentMatch = lower.match(/(\d{1,3})\s*(?:%|percent)/) ?? lower.match(/\bto\s+(\d{1,3})\b/);
  if (founderMatch && percentMatch) {
    const percent = Number(percentMatch[1]);
    if (Number.isFinite(percent) && percent >= 0 && percent <= 100) {
      const founder = founderMatch[1];
      return {
        kind: "equity",
        founder,
        percent,
        key: `equity:${founder}:${percent}`,
        label: `Setting ${founder === "me" || founder === "i" ? "you" : founder} to ${percent}%…`,
      };
    }
  }

  // Grounded questions — heard, but no card is invented locally.
  if (/section 85|s\.?\s?85|rollover|roll over/.test(lower)) {
    return { kind: "rollover-question", key: "rollover-question", label: "Heard: s.85 rollover question — asking the agent for the grounded fact card…" };
  }
  if (/filing steps|filing fees|steps and fees|what are the (filing )?fees|how (do i|to) file/.test(lower)) {
    return { kind: "filing-question", key: "filing-question", label: "Heard: filing steps & fees — asking the agent for the grounded card…" };
  }

  // Checklist advance — explicit phrases only; a bare "done"/"yes" in an
  // interim fragment is too easy to mishear to move state on.
  if (/next step|mark (it|that|this)( one)? done|check (it|that|this)( off)?|that'?s done|done with (that|it)|advance|complete (that|the|this) step|move on/.test(lower)) {
    return { kind: "checklist-advance", key: "checklist-advance", label: "Marking the next checklist step done…" };
  }

  // Jurisdiction: exactly one planet named. Naming two ("compare Mars
  // and Europa") is a comparison, not a pick — leave it to the agent.
  const planets = mentionedPlanets(lower);
  if (planets.length === 1) {
    const jurisdiction = planets[0];
    return {
      kind: "jurisdiction",
      jurisdiction,
      key: `jurisdiction:${jurisdiction}`,
      label: `${jurisdiction} selected`,
    };
  }

  return null;
}

// --- Voice activity: client-side endpointing -------------------------
// The worklet streams raw samples; RMS level turns them into "is the
// user speaking" so a natural pause can end the turn hands-free
// (mirrors the server model's ENDPOINTING idea, on the client where
// the batch upload used to force a manual Stop click).

export const SPEECH_RMS = 0.018;
export const SILENCE_TO_STOP_MS = 1100;
export const MIN_SPEECH_MS = 350;

export function rmsLevel(samples: Float32Array): number {
  if (!samples || samples.length === 0) return 0;
  let sum = 0;
  for (let i = 0; i < samples.length; i++) sum += samples[i] * samples[i];
  return Math.sqrt(sum / samples.length);
}

export type VoiceActivity = {
  hasSpoken: boolean;
  speechMs: number;
  lastSpeechAt: number | null;
};

export const IDLE_ACTIVITY: VoiceActivity = { hasSpoken: false, speechMs: 0, lastSpeechAt: null };

export function nextVoiceActivity(prev: VoiceActivity, rms: number, nowMs: number, blockMs = 0): VoiceActivity {
  if (rms >= SPEECH_RMS) {
    return { hasSpoken: true, speechMs: prev.speechMs + Math.max(0, blockMs), lastSpeechAt: nowMs };
  }
  return prev;
}

export function shouldAutoStop(activity: VoiceActivity, nowMs: number): boolean {
  if (!activity.hasSpoken || activity.lastSpeechAt === null) return false;
  if (activity.speechMs < MIN_SPEECH_MS) return false;
  return nowMs - activity.lastSpeechAt >= SILENCE_TO_STOP_MS;
}
