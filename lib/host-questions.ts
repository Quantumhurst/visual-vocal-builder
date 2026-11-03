// Pure host-prompt helpers (Day 6). No DOM, unit-testable.
import type { SharedState } from "./state";

export type Beat = SharedState["currentBeat"];

export function shortFounderNames(founders: readonly ({ name: string } | string)[] = []): string[] {
  return founders.map((f) => {
    const name = typeof f === "string" ? f : f.name;
    if (name.includes("Orbit")) return "Orbit";
    if (name.includes("Nova")) return "Nova";
    return name;
  });
}

export function getHostQuestion(beat: Beat, founderNames: string[] = ["Nova", "Orbit"], selected?: string | null): string {
  const [a = "Nova", b = "Orbit"] = founderNames;
  switch (beat) {
    case "jurisdiction": return "Pick your home base — Mars, Europa, or Andromeda Galaxy?";
    case "equity": return selected ? `${selected} locked in! Next up: how should ${a} and ${b} split the 100% equity?` : `Home base pending. Next up: how should ${a} and ${b} split the 100% equity?`;
    case "checklist": return "Equity set. Which filing step should we tackle first?";
    case "rollover": return "Checklist moving. Want the s.85 rollover fact card for this setup?";
    case "filingsteps": return "Rollover noted. Ready to walk the filing steps and fees in order?";
    case "summary": return "Everything's lined up — shall I prepare the lawyer summary package?";
  }
}

type Msg = { role?: string; content?: unknown; text?: unknown };

function textOf(m: Msg): string {
  if (typeof m.content === "string") return m.content.trim();
  if (Array.isArray(m.content)) return m.content.map((p) => {
    if (typeof p === "string") return p;
    if (p && typeof p === "object" && "text" in p && typeof (p as {text:unknown}).text === "string") return (p as {text:string}).text;
    return "";
  }).join(" ").trim();
  if (typeof m.text === "string") return m.text.trim();
  return "";
}

export function getLatestAssistantText(messages: readonly Msg[] | undefined | null): string | null {
  if (!messages) return null;
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m.role !== "assistant") continue;
    const t = textOf(m);
    if (t) return t;
  }
  return null;
}

export function resolveHostPrompt(messages: readonly Msg[] | undefined | null, beat: Beat, founderNames?: string[], selected?: string | null): { text: string; source: "agent" | "fallback" } {
  const latest = getLatestAssistantText(messages);
  if (latest) return { text: latest, source: "agent" };
  return { text: getHostQuestion(beat, founderNames, selected), source: "fallback" };
}

// Tool-only turns still speak the next question: when a turn completes
// with no new assistant text (fallback source, e.g. a bare tool call like
// setFounderEquity) AND the beat advanced, the host speaks the fallback
// mission question once. A beat that did not advance stays silent — the
// same question is never repeated.
export function shouldSpeakFallbackQuestion(source: "agent" | "fallback", beatAtTurnStart: Beat, beatNow: Beat): boolean {
  return source === "fallback" && beatAtTurnStart !== beatNow;
}
