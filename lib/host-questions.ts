// Pure host-prompt helpers (Day 6). No DOM, unit-testable.
import type { SharedState } from "./state";

export type Beat = SharedState["currentBeat"];

export function getHostQuestion(beat: Beat, founderNames: string[] = ["Nova", "Orbit"]): string {
  const [a = "Nova", b = "Orbit"] = founderNames;
  switch (beat) {
    case "jurisdiction": return "Pick your home base — Mars, Europa, or Andromeda Galaxy?";
    case "equity": return `Mars locked in! Next up: how should ${a} and ${b} split the 100% equity?`;
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

export function resolveHostPrompt(messages: readonly Msg[] | undefined | null, beat: Beat, founderNames?: string[]): { text: string; source: "agent" | "fallback" } {
  const latest = getLatestAssistantText(messages);
  if (latest) return { text: latest, source: "agent" };
  return { text: getHostQuestion(beat, founderNames), source: "fallback" };
}
