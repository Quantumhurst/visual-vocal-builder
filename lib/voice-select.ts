// Curated native-voice selection — pure, unit-testable.
// The default speechSynthesis voice is a legacy formant synth, which is
// why the host sounded robotic. Browsers expose up to ~176 voices of
// wildly varying quality; this ranks the pleasant neural/enhanced ones
// first and the novelty voices last, deterministically.

export type VoiceLike = { name: string; lang: string; localService?: boolean; default?: boolean };

// localStorage key shared by the host-voice picker and the speech path.
export const HOST_VOICE_STORAGE_KEY = "vvb.host-voice";

const NOVELTY = /\b(Albert|Bad News|Bahh|Bells|Boing|Bubbles|Cellos|Deranged|Eddy|Flo|Fred|Good News|Grandma|Grandpa|Hysterical|Jester|Junior|Kathy|Organ|Pipe|Ralph|Reed|Rocko|Sandy|Shelley|Superstar|Trinoids|Whisper|Wobble|Zarvox)\b/i;

export function voiceScore(voice: VoiceLike): number {
  const name = voice.name ?? "";
  const lang = (voice.lang ?? "").toLowerCase();
  if (!lang.startsWith("en")) return -200;
  if (NOVELTY.test(name)) return -100;
  let score = 0;
  if (/\bAva\b.*(Enhanced|Premium)|Samantha.*(Enhanced|Premium)|\bAllison\b/i.test(name)) score += 100;
  else if (/Natural|Online/i.test(name)) score += 85;
  else if (/Google UK English Female|Google US English/i.test(name)) score += 70;
  else if (/\b(Samantha|Daniel|Karen|Serena|Moira|Tessa)\b/i.test(name)) score += 40;
  if (/Enhanced|Premium/i.test(name)) score += 15;
  if (lang === "en-us") score += 10;
  if (voice.localService) score += 5;
  if (voice.default) score += 2;
  return score;
}

export function rankVoices<T extends VoiceLike>(voices: readonly T[]): T[] {
  return [...voices]
    .filter((v) => (v.lang ?? "").toLowerCase().startsWith("en"))
    .sort((a, b) => voiceScore(b) - voiceScore(a));
}

export function pickVoice<T extends VoiceLike>(voices: readonly T[]): T | null {
  const usable = selectableVoices(voices);
  if (usable.length > 0) return usable[0];
  // If a browser exposes only low-scoring or network voices, keep a
  // last-resort ranked pick rather than leaving the host silent.
  const ranked = rankVoices(voices);
  return ranked.length && voiceScore(ranked[0]) > -100 ? ranked[0] : null;
}

// Voices that are reliable enough to offer/save. Low-confidence and
// network-only voices (Rishi, Google/Microsoft Online) can be silent in
// Chrome when offline or uninstalled; keep the picker to local, known
// English voices. Unknown localService is treated as local (some browsers
// omit the flag).
export function isSelectableVoice(voice: VoiceLike): boolean {
  return voiceScore(voice) >= 20 && voice.localService !== false;
}

// The picker should only offer voices the host can actually use for the
// English host lines. Novelty/character voices are localService too, but
// several of them are silent or unusable in Chrome; keep them out so a
// judge cannot pin one and lose voice-out.
export function selectableVoices<T extends VoiceLike>(voices: readonly T[]): T[] {
  return rankVoices(voices).filter(isSelectableVoice);
}

// Product default: Karen when the machine/OS exposes her. Auto remains
// the explicit "best available" option; a fresh session with no saved
// choice should land on Karen instead of Samantha.
export const DEFAULT_HOST_VOICE_NAME = "Karen";

export function defaultHostVoice<T extends VoiceLike & { voiceURI?: string }>(
  voices: readonly T[],
): T | null {
  const target = new RegExp(`^${DEFAULT_HOST_VOICE_NAME}\\b`, "i");
  return selectableVoices(voices).find((voice) => target.test(voice.name)) ?? null;
}

// The host-voice picker stores a voiceURI. Resolve it against the live
// voice list; if the saved voice is gone (OS update, other browser), or
// it is a novelty/low-confidence/network voice that cannot speak
// reliably, fall back to the curated automatic pick instead of leaving
// the host silent.
export function resolveVoiceSelection<T extends VoiceLike & { voiceURI?: string }>(
  voices: readonly T[],
  selectedUri?: string | null,
): T | null {
  if (selectedUri && selectedUri !== "auto") {
    const match = voices.find(
      (voice) =>
        voice.voiceURI === selectedUri &&
        isSelectableVoice(voice),
    );
    if (match) return match;
  }
  return pickVoice(voices);
}

// SSML is stripped or spoken literally by major browsers, so prosody
// is punctuation + utterance properties only. Questions lift a
// little; statements stay neutral.
export function prosodyFor(text: string): { rate: number; pitch: number } {
  const t = (text ?? "").trim();
  if (t.endsWith("?")) return { rate: 1.04, pitch: 1.08 };
  return { rate: 1.0, pitch: 1.0 };
}
