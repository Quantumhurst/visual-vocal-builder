// Curated native-voice selection — pure, unit-testable.
// The default speechSynthesis voice is a legacy formant synth, which is
// why the host sounded robotic. Browsers expose up to ~176 voices of
// wildly varying quality; this ranks the pleasant neural/enhanced ones
// first and the novelty voices last, deterministically.

export type VoiceLike = { name: string; lang: string; localService?: boolean; default?: boolean };

const NOVELTY = /\b(Albert|Bad News|Bahh|Bells|Boing|Bubbles|Cellos|Deranged|Fred|Good News|Hysterical|Jester|Pipe|Superstar|Trinoids|Whisper|Zarvox|Organ|Wobble)\b/i;

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
  const ranked = rankVoices(voices);
  return ranked.length && voiceScore(ranked[0]) > -100 ? ranked[0] : null;
}

// SSML is stripped or spoken literally by major browsers, so prosody
// is punctuation + utterance properties only. Questions lift a
// little; statements stay neutral.
export function prosodyFor(text: string): { rate: number; pitch: number } {
  const t = (text ?? "").trim();
  if (t.endsWith("?")) return { rate: 1.04, pitch: 1.08 };
  return { rate: 1.0, pitch: 1.0 };
}
