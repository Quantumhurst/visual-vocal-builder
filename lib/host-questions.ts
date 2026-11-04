// Pure host-prompt helpers (Day 6). No DOM, unit-testable.
import type { SharedState } from "./state";

export type Beat = SharedState["currentBeat"];

export function shortFounderNames(founders: readonly ({ name: string } | string)[] = []): string[] {
  return founders.map((f) => {
    const name = typeof f === "string" ? f : f.name;
    return name
      .replace(/^DEMO Founder /, "")
      .replace(/^DEMO Owner /, "")
      .replace(/ \(fictional\)$/, "");
  });
}

// One next step, one suggested phrase. The screen shows the same cue in
// its SAY card; alternate phrasings stay understood by voice but are not
// offered as a menu.
export function getHostQuestion(beat: Beat, founderNames: string[] = ["Nova", "Orbit"], selected?: string | null): string {
  const [a = "Nova", b = "Orbit"] = founderNames;
  switch (beat) {
    case "jurisdiction": return "Pick your home base. Say “Pick Mars”.";
    case "equity": {
      const names = founderNames.length ? founderNames : [a, b];
      const who = names.length === 1
        ? names[0]
        : names.length === 2
          ? `${names[0]} and ${names[1]}`
          : `${names.slice(0, -1).join(", ")}, and ${names[names.length - 1]}`;
      const home = selected ? `${selected} is home. ` : "";
      const verb = names.length === 1 ? "holds" : "split";
      // One sentence with the suggested phrase, so the two-sentence spoken
      // cap cannot drop the cue the screen shows.
      return `${home}${who} ${verb} the 100% equity — say “Make Orbit 70%”.`;
    }
    case "checklist": return "Build the colony one structure at a time. Say “yes” to raise the next one.";
    case "name": return "Name the fictional company. Say “Approve Galactic Bagels”.";
    case "filingsteps": return "That filing card is optional. No action needed — say “continue” to keep the required walk moving.";
    case "summary": return "Build complete. Say “Prepare the lawyer summary” — prep only.";
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
