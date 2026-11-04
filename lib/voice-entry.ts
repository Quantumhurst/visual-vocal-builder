// Voice entry — the Bridge door is voice-first.
//
// There is still a button for fallback, but the core journey never needs
// it: the landing page listens, and "Enter the bridge" (or "Start")
// mounts the cockpit. If a saved run exists, "Resume" continues it and
// "Start over" clears it.

export type EntryMode = "fresh" | "resume";

export type EntryIntent = { mode: EntryMode; phrase: string } | null;

const norm = (text: string): string =>
  (text ?? "")
    .toLowerCase()
    .replace(/[^\w\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

export function parseEntryIntent(text: string): EntryIntent {
  const t = norm(text);
  if (!t) return null;

  if (/\b(?:start\s+over|fresh\s+start|new\s+colony|from\s+the\s+beginning|reset)\b/.test(t)) {
    return { mode: "fresh", phrase: "start over" };
  }
  if (/\b(?:resume|continue|pick\s+up|where\s+i\s+left\s+off|carry\s+on)\b/.test(t)) {
    return { mode: "resume", phrase: "resume" };
  }
  if (
    /\b(?:enter|open|cross|board)\b.*\b(?:bridge|door|ship|foundry)\b/.test(t) ||
    /\b(?:bridge|door)\b.*\b(?:enter|open|please)\b/.test(t)
  ) {
    return { mode: "resume", phrase: "enter the bridge" };
  }
  if (
    /^(?:enter|start|begin|go|launch|ready|lets\s+go|let\s+s\s+go)\b/.test(t) ||
    /^(?:hello|hi|hey|are\s+you\s+there|can\s+you\s+hear\s+me)\b/.test(t)
  ) {
    return { mode: "resume", phrase: "start" };
  }
  return null;
}

export function entryPrompt(hasSaved: boolean, progress = ""): string {
  if (hasSaved) {
    return `Welcome back. ${progress || "Your run is saved"}. Say “Resume” to continue, or “Start over” for a new colony.`;
  }
  return "Say “Enter the bridge” to begin. You will never need a mouse or a keyboard.";
}

export function entryHint(hasSaved: boolean): string {
  return hasSaved ? "SAY “RESUME” OR “START OVER”" : "SAY “ENTER THE BRIDGE”";
}
