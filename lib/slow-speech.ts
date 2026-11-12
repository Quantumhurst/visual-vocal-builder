// Slow-speech continuation — pure, unit-testable.
//
// Meta Voice Transcribe ends a turn on trailing silence. A slow speaker
// who pauses mid-thought ("I would like to pick … Mars") would otherwise
// have the first half sent as the whole command. The app holds a final
// that is clearly unfinished, keeps the mic open, and merges the next
// final into one utterance. Nothing is sent until the thought is whole
// or the user says a control word.

import { stripAsrAnnotations } from "./transcript.ts";

export const CONTINUATION_GRACE_MS = 12_000;

// A final ending on one of these is a mid-sentence pause, not a thought.
const OPEN_ENDINGS = new Set([
  "a",
  "an",
  "and",
  "are",
  "as",
  "at",
  "because",
  "but",
  "by",
  "can",
  "could",
  "do",
  "does",
  "for",
  "from",
  "i",
  "if",
  "in",
  "is",
  "it",
  "like",
  "my",
  "of",
  "on",
  "or",
  "our",
  "please",
  "so",
  "than",
  "that",
  "the",
  "then",
  "to",
  "uh",
  "um",
  "was",
  "want",
  "we",
  "were",
  "what",
  "when",
  "where",
  "which",
  "who",
  "why",
  "will",
  "with",
  "would",
  "you",
  "your",
]);

// After one of these, a command word is a noun ("the split", "a build",
// "our call"): the phrase is complete, not waiting for an object.
const DETERMINERS = new Set(["a", "an", "the", "this", "that", "our", "my", "your", "its", "their"]);

// A bare command verb with no object is still a beginning.
const OPEN_VERBS = new Set([
  "approve",
  "build",
  "call",
  "choose",
  "explain",
  "give",
  "go",
  "make",
  "open",
  "pick",
  "prepare",
  "put",
  "raise",
  "say",
  "select",
  "set",
  "show",
  "split",
  "start",
  "tell",
]);

const OPEN_PHRASES = [
  "i want",
  "i would like",
  "i'd like",
  "id like",
  "we need",
  "we should",
  "we want",
  "we would like",
  "can you",
  "could you",
  "going to",
  "ready to",
  "let us",
  "lets",
  "let's",
  "i am going",
  "im going",
  "i'm going",
];

function wordsOf(text: string): string[] {
  return stripAsrAnnotations(text)
    .toLowerCase()
    .replace(/[^\w\s']/g, " ")
    .split(/\s+/)
    .filter(Boolean);
}

/**
 * True only when the wording itself shows the speaker is not done.
 * A complete command, a question, a yes/no answer, or a short object
 * phrase must never be held.
 */
export function looksUnfinishedTranscript(text: string): boolean {
  const raw = stripAsrAnnotations(text);
  if (!raw) return false;
  if (/[?]$/.test(raw)) return false;
  // An explicit dash, comma, semicolon, or ellipsis is a deliberate pause.
  if (/[,;:\-–—]+\s*$/.test(raw)) return true;
  if (/\.\.\.\s*$/.test(raw)) return true;

  const words = wordsOf(raw);
  if (words.length === 0) return false;
  const tail = words[words.length - 1];
  const phrase = words.join(" ");

  if (OPEN_PHRASES.some((ending) => phrase.endsWith(ending))) return true;
  if (OPEN_ENDINGS.has(tail)) return true;
  // "Pick" / "make" / "build" alone: a verb that still needs its object.
  if (words.length === 1 && OPEN_VERBS.has(tail)) return true;
  // "I would like to pick": the last word is a transitive verb. But
  // "confirm the split" ends on a noun, not a verb waiting for its object.
  if (words.length >= 2 && OPEN_VERBS.has(tail) && !DETERMINERS.has(words[words.length - 2])) return true;

  return false;
}

/**
 * Join the held beginning and the new final into one utterance.
 * Trailing punctuation on the held half is dropped; a doubled seam word
 * is not repeated.
 */
export function mergeContinuation(first: string, second: string): string {
  // The held half is unfinished by definition, so a trailing period or
  // ellipsis on it is the recognizer's, not the speaker's ("The planet I
  // want is." + "Mars" must not read "is. Mars").
  const a = stripAsrAnnotations(first).replace(/[.…,;:\-–—\s]+$/g, "").trim();
  let b = stripAsrAnnotations(second).trim();
  if (!a) return b;
  if (!b) return a;
  const aWords = a.split(/\s+/);
  const bWords = b.split(/\s+/);
  if (
    aWords.length > 0 &&
    bWords.length > 0 &&
    aWords[aWords.length - 1].toLowerCase() === bWords[0].toLowerCase()
  ) {
    b = bWords.slice(1).join(" ");
  }
  return `${a}${b ? ` ${b}` : ""}`.replace(/\s+/g, " ").trim();
}
