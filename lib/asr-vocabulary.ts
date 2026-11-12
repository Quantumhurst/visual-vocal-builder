// Demo vocabulary both speech-to-text providers are biased toward, so
// "Europa" and "Galactic Bagels" are spelled the way the app expects.
// Biasing steers recognition toward these spellings — it does not
// guarantee them, so the final transcript is still what gets sent to the
// agent.
export const ASR_KEYWORDS = [
  "Mars",
  "Europa",
  "Andromeda Galaxy",
  "Galactic Bagels",
  "Nova",
  "Orbit",
  "Vega",
  "Lyra",
  "Orion",
  "Altair",
  "Rigel",
  "owners",
  "founders",
  "one owner",
  "two owners",
  "three owners",
  "four owners",
  "five owners",
  "three people",
  "four people",
  "five people",
  "confirm",
  "confirm split",
  "confirm this split",
  "confirm the split",
  "the split",
  "change",
  "tick next step",
  "finish the build",
  "zero",
  "none of them",
  "start over",
  "undo",
  "cheapest",
  "filing steps",
  "lawyer summary",
] as const;

// The always-available voice controls (lib/voice-controls.ts). Several are
// a single short word that a recogniser readily turns into another word
// ("slower" -> "slayer"). Only the Gemini transcription prompt uses this
// list; the Meta handshake keeps ASR_KEYWORDS alone.
export const CONTROL_KEYWORDS = [
  "help",
  "repeat that",
  "stop",
  "continue",
  "slower",
  "faster",
  "louder",
  "quieter",
  "mute",
  "unmute",
  "volume",
  "slow mode",
  "take your time",
  "show transcript",
  "hide transcript",
  "close",
  "save progress",
  "status",
  "test voice",
  "download",
  "download summary",
  "download transcript",
  "download package",
] as const;
