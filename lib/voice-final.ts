// What to do with a final transcript — pure, unit-testable.
//
// Every speech path ends a turn with a final transcript: Meta streaming,
// the browser recogniser (Gemini), and the buffered /api/transcribe
// fallback (either provider). All of them must make the same slow-speech
// decision, or a pause mid-sentence sends half a thought on one provider
// and not the other:
//
// - A held beginning ("The planet I want is") is merged with this final,
//   unless this final is a standalone turn (a control, a yes/no answer, a
//   name approval, a question), which abandons the held words instead of
//   being glued onto them ("I want to … stop").
// - A result that is still visibly unfinished, and is not a command,
//   answer or question, is held: the caller keeps the mic open.

import { isConfirmationAnswer } from "./confirmation.ts";
import { isNameApproval } from "./checklist-answers.ts";
import { parseLiveIntent } from "./live-intent.ts";
import { looksUnfinishedTranscript, mergeContinuation } from "./slow-speech.ts";
import { parseSpokenCompanyName } from "./state-updates.ts";
import { parseVoiceControl } from "./voice-controls.ts";

export type VoiceFinalDecision = { action: "send" | "hold"; text: string };

const QUESTION_START = /^(?:what|how|where|when|who|why|can|could|do|does|is|are|should|would)\b/i;

function looksLikeQuestion(text: string): boolean {
  return /\?\s*$/.test(text) || QUESTION_START.test(text);
}

function isAnswer(text: string): boolean {
  return isConfirmationAnswer(text) || isNameApproval(text) || Boolean(parseSpokenCompanyName(text));
}

export function isStandaloneTurn(text: string): boolean {
  return Boolean(parseVoiceControl(text)) || isAnswer(text) || looksLikeQuestion(text);
}

// `held` is the beginning kept from the previous final, if any. The caller
// clears its held state either way and holds again only on "hold".
export function resolveVoiceFinal(text: string, held: string | null | undefined): VoiceFinalDecision {
  const trimmed = (text ?? "").trim();
  let finalText = trimmed;
  if (held && held.trim() && !isStandaloneTurn(trimmed)) {
    finalText = mergeContinuation(held, trimmed);
  }
  const hold =
    !parseVoiceControl(finalText) &&
    !parseLiveIntent(finalText) &&
    !isAnswer(finalText) &&
    !looksLikeQuestion(finalText) &&
    looksUnfinishedTranscript(finalText);
  return { action: hold ? "hold" : "send", text: finalText };
}
