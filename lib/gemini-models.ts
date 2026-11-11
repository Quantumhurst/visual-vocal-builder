// Gemini model choices — one place, unit-testable.
//
// - Brain: gemini-2.5-flash for the CopilotKit agent tool loop.
// - Speech-to-text: gemini-2.5-flash transcribes a buffered utterance
//   (lib/gemini-asr.ts). The browser recogniser supplies live words where
//   it exists; this is the authority when it does not.
// - Host voice: gemini-2.5-flash-preview-tts (lib/tts-handler.ts).
//
// Gemini Live is deliberately not used: it listens, speaks and calls tools
// on its own, which competes with the guided host for the same turn.

export const BRAIN_MODEL = "gemini-2.5-flash";
export const ASR_MODEL = "gemini-2.5-flash";

// Voice turns are short commands inside a tight tool loop. Skipping the
// model's thinking pass is the Gemini counterpart of the low reasoning
// effort the Meta brain uses for the same turns.
export const VOICE_TURN_THINKING_BUDGET = 0;
