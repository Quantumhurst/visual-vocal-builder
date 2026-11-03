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

export type ChecklistAdvanceCount = number | "all";

export type LiveIntent =
  | { kind: "jurisdiction"; jurisdiction: string; key: string; label: string }
  | { kind: "equity"; founder: string; percent: number; key: string; label: string }
  | { kind: "checklist-advance"; count: ChecklistAdvanceCount; key: string; label: string }
  | { kind: "owner-count"; count: number; key: string; label: string }
  | { kind: "cheapest"; key: string; label: string }
  | { kind: "undo"; key: string; label: string }
  | { kind: "start-over"; key: string; label: string }
  | { kind: "lawyer-summary"; key: string; label: string }
  | { kind: "rollover-question"; key: string; label: string }
  | { kind: "filing-question"; key: string; label: string };

const COUNT_WORDS: Record<string, number> = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6,
  "1": 1, "2": 2, "3": 3, "4": 4, "5": 5, "6": 6,
};

import { ALL_DEMO_FOUNDER_NAMES, DEMO_JURISDICTIONS } from "./demo-data.ts";

function countFrom(token: string | undefined): number | null {
  if (!token) return null;
  const value = COUNT_WORDS[token.toLowerCase()];
  return value && value > 0 ? value : null;
}

const OWNER_NAMES_PATTERN = new RegExp(
  `\\b(${ALL_DEMO_FOUNDER_NAMES.map((n) => n.toLowerCase()).join("|")}|me|i)\\b`,
  "i",
);

function ownerName(text: string): string | null {
  const match = text.match(OWNER_NAMES_PATTERN);
  return match ? match[1].toLowerCase() : null;
}

const PLANETS: { needle: string; name: string }[] = DEMO_JURISDICTIONS.map((j) => ({
  needle: j.jurisdiction.toLowerCase().split(/\s+/)[0],
  name: j.jurisdiction,
}));

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

  // Deterministic meta commands.
  if (/^\s*(?:actually[,\s]+)?(?:please\s+)?(?:undo|revert|take (?:that|it) back|scratch that)\b/.test(lower)) {
    return { kind: "undo", key: "undo", label: "Undoing the last change…" };
  }
  if (/\b(?:start over|fresh start|reset (?:the )?(?:canvas|colony|board))\b/.test(lower)) {
    return { kind: "start-over", key: "start-over", label: "Starting over…" };
  }
  if (/\b(?:cheapest|least expensive|lowest fee)\b/.test(lower)) {
    return { kind: "cheapest", key: "cheapest", label: "Comparing the DEMO rows…" };
  }

  // Equity: a founder token and a percent, in either order.
  // "make orbit 70%", "make me 70%", "70% for nova", "set nova to 70 percent"
  const founderMatch = ownerName(lower);
  const percentMatch = lower.match(/(\d{1,3})\s*(?:%|percent)/) ?? lower.match(/\bto\s+(\d{1,3})\b/);
  if (founderMatch && percentMatch) {
    const percent = Number(percentMatch[1]);
    if (Number.isFinite(percent) && percent >= 0 && percent <= 100) {
      const founder = founderMatch;
      return {
        kind: "equity",
        founder,
        percent,
        key: `equity:${founder}:${percent}`,
        label: `Setting ${founder === "me" || founder === "i" ? "you" : founder} to ${percent}%…`,
      };
    }
  }

  // Owner count: "it's just me", "three owners", "there are three of us".
  const justMe = /\b(?:just|only)\s+me\b/.test(lower) || /\bi'?m\s+(?:just\s+)?(?:solo|alone)\b/.test(lower);
  const ownerCountMatch = lower.match(/\b(one|two|three|four|five|\d)\s+(?:owners?|founders?|partners?|people|of\s+us)\b/)
    ?? lower.match(/\b(?:we'?re|we are)\s+(one|two|three|four|five|\d)\b/);
  const ownerCount = justMe ? 1 : countFrom(ownerCountMatch?.[1]);
  if (ownerCount && ownerCount >= 1 && ownerCount <= 5) {
    return {
      kind: "owner-count",
      count: ownerCount,
      key: `owners:${ownerCount}`,
      label: `${ownerCount} owner${ownerCount === 1 ? "" : "s"} — balancing the split…`,
    };
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
  const tickPhrase = /\btick\s+(?:off\s+)?(?:the\s+)?(?:first|next|last|all|every|remaining|one|two|three|four|five|\d)\b/.test(lower)
    || /\btick\s+(?:off\s+)?(?:them|these|those|it|that)\b/.test(lower);
  const checklistPhrase = /next\s+(?:checklist\s+)?step|mark (it|that|this)( one)? done|check (it|that|this)( off)?|that'?s done|done with (that|it)|advance|complete (that|the|this) step|move on|finish (the )?build|complete (the )?(checklist|build)/.test(lower) || tickPhrase;
  if (checklistPhrase) {
    const all = /\b(?:finish|complete)\s+(?:the\s+)?(?:build|checklist)|tick\s+(?:off\s+)?(?:all|everything|every|the remaining)|mark\s+all\b/.test(lower);
    const countMatch = lower.match(/\b(?:first|next|last)\s+(one|two|three|four|five|\d+)\s+(?:checklist\s+)?(?:items?|steps?)\b/)
      ?? lower.match(/\b(?:first|next|last)\s+(one|two|three|four|five|\d+)\b/);
    const count: ChecklistAdvanceCount = all ? "all" : (countFrom(countMatch?.[1]) ?? 1);
    return {
      kind: "checklist-advance",
      count,
      key: `checklist:${count}`,
      label: count === "all"
        ? "Finishing the remaining checklist items…"
        : `Marking ${count === 1 ? "the next checklist step" : `the next ${count} checklist steps`} done…`,
    };
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

export const SPEECH_RMS = 0.012;
export const SILENCE_TO_STOP_MS = 1100;
export const MIN_SPEECH_MS = 150;
// Shorter stop pause once a live intent (a command, never a question) has
// already matched in the current recording — the turn is recognised, so a
// shorter pause sends it sooner. Questions keep the full 1100 ms.
export const INTENT_SILENCE_TO_STOP_MS = 600;

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

export function shouldAutoStop(activity: VoiceActivity, nowMs: number, silenceMs: number = SILENCE_TO_STOP_MS): boolean {
  if (!activity.hasSpoken || activity.lastSpeechAt === null) return false;
  if (activity.speechMs < MIN_SPEECH_MS) return false;
  return nowMs - activity.lastSpeechAt >= silenceMs;
}
