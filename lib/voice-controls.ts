// Always-available voice controls — pure, unit-testable.
//
// A hands-free founder can always say: help, repeat that, stop, slower,
// start over. Volume, rate, pacing, transcript, and save are voice
// controls too, so the settings are never trapped behind a pointer.
//
// This parser is deliberately conservative: it only claims an utterance
// when the whole phrase is a control. Anything with a real command or
// question falls through to the normal journey path.

export type VoiceControlKind =
  | "help"
  | "repeat"
  | "stop"
  | "continue"
  | "slower"
  | "faster"
  | "normal-speed"
  | "louder"
  | "quieter"
  | "mute"
  | "unmute"
  | "volume"
  | "sound-on"
  | "sound-off"
  | "voice-on"
  | "voice-off"
  | "show-transcript"
  | "hide-transcript"
  | "download"
  | "download-summary"
  | "download-transcript"
  | "close-transcript"
  | "save"
  | "slow-mode"
  | "normal-mode"
  | "status"
  | "test-voice"
  | "start-over";

export type VoiceControl = {
  kind: VoiceControlKind;
  /** 0–100 for "volume", otherwise undefined. */
  value?: number;
};

export type VoiceSettings = {
  // Host speech rate multiplier (1 = the curated prosody baseline).
  rate: number;
  // Host speech volume, 0–1.
  volume: number;
  // Sound-cue volume, 0–1.
  sound: number;
  // Host voice output on/off.
  voiceOn: boolean;
  // Synthesised cues on/off.
  soundOn: boolean;
  // Slow mode: no streaming ASR, long local silence window, long grace.
  slowMode: boolean;
};

export const DEFAULT_VOICE_SETTINGS: VoiceSettings = {
  rate: 1,
  volume: 1,
  sound: 0.8,
  voiceOn: true,
  soundOn: true,
  slowMode: false,
};

export function normalizeVoiceSettings(partial?: Partial<VoiceSettings> | null): VoiceSettings {
  const p = partial ?? {};
  const num = (value: unknown, fallback: number, min: number, max: number): number => {
    const n = Number(value);
    if (!Number.isFinite(n)) return fallback;
    return Math.min(max, Math.max(min, n));
  };
  return {
    rate: num(p.rate, DEFAULT_VOICE_SETTINGS.rate, 0.5, 1.6),
    volume: num(p.volume, DEFAULT_VOICE_SETTINGS.volume, 0, 1),
    sound: num(p.sound, DEFAULT_VOICE_SETTINGS.sound, 0, 1),
    voiceOn: p.voiceOn !== false,
    soundOn: p.soundOn !== false,
    slowMode: p.slowMode === true,
  };
}

const norm = (text: string): string =>
  (text ?? "")
    .toLowerCase()
    .replace(/[^\w\s%]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

export function parseVoiceControl(text: string): VoiceControl | null {
  const raw = (text ?? "").replace(/<\|[^|]*\|>/g, " ").trim();
  if (!raw) return null;
  // ASR can duplicate a word across a turn boundary ("Savesave progress").
  // Collapse only immediate exact repeats of a 3+ letter word.
  const t = norm(raw)
    .replace(/\b(\w{3,})\1\b/g, "$1")
    .replace(/\b(\w+)\s+\1\b/g, "$1");
  if (!t) return null;

  // Stop first: it must work even when the rest of the sentence is noise,
  // including a merged turn like "repeat that, stop" where ASR captured
  // tail audio from the previous command. A trailing stop wins.
  if (/^(?:please\s+)?(?:stop|stop\s+(?:talking|speaking|listening)|be\s+quiet|quiet|silence)(?:\s+please)?$/.test(t)) {
    return { kind: "stop" };
  }
  if (/(?:^|\s)(?:stop|silence|be\s+quiet)\s*$/.test(t) && t.split(" ").length <= 6) {
    return { kind: "stop" };
  }
  if (/^(?:please\s+)?(?:repeat(?:\s+that)?|say\s+(?:that|it)\s+again|again\s+please|what\s+did\s+you\s+say)(?:\s+please)?$/.test(t)) {
    return { kind: "repeat" };
  }
  if (/^(?:help|help\s+me|i\s+need\s+help|what\s+can\s+i\s+say|what\s+are\s+my\s+options|how\s+does\s+this\s+work)$/.test(t)) {
    return { kind: "help" };
  }
  if (/^(?:start\s+over|fresh\s+start|reset\s+(?:it|everything|the\s+colony|the\s+canvas|the\s+bridge)|from\s+the\s+beginning)$/.test(t)) {
    return { kind: "start-over" };
  }
  if (/^(?:continue|resume|go\s+on|keep\s+going|carry\s+on|i\s+am\s+ready|i m\s+ready|ready)$/.test(t)) {
    return { kind: "continue" };
  }
  if (/^(?:slower|slow\s+down|speak\s+slower|a\s+bit\s+slower|too\s+fast)$/.test(t)) {
    return { kind: "slower" };
  }
  if (/^(?:faster|speed\s+up|speak\s+faster|a\s+bit\s+faster|too\s+slow)$/.test(t)) {
    return { kind: "faster" };
  }
  if (/^(?:normal\s+speed|normal\s+pace|reset\s+(?:the\s+)?speed|regular\s+speed)$/.test(t)) {
    return { kind: "normal-speed" };
  }
  if (/^(?:slow\s+mode|slow\s+speech\s+mode|i\s+speak\s+slowly|take\s+your\s+time|give\s+me\s+time|i\s+need\s+more\s+time|longer\s+pause)$/.test(t)) {
    return { kind: "slow-mode" };
  }
  if (/^(?:normal\s+mode|normal\s+pacing|i\s+speak\s+normally|turn\s+off\s+slow\s+mode)$/.test(t)) {
    return { kind: "normal-mode" };
  }
  if (/^(?:louder|volume\s+up|turn\s+it\s+up|speak\s+up|more\s+volume)$/.test(t)) {
    return { kind: "louder" };
  }
  if (/^(?:quieter|volume\s+down|turn\s+it\s+down|less\s+volume|speak\s+softly)$/.test(t)) {
    return { kind: "quieter" };
  }
  if (/^(?:mute|mute\s+the\s+host|silence\s+the\s+host)$/.test(t)) {
    return { kind: "mute" };
  }
  if (/^(?:unmute|unmute\s+the\s+host|restore\s+volume)$/.test(t)) {
    return { kind: "unmute" };
  }
  const vol = t.match(/^(?:set\s+)?volume\s+(?:to\s+)?(\d{1,3})(?:\s+percent)?$/);
  if (vol) {
    const value = Math.min(100, Math.max(0, Number(vol[1])));
    return { kind: "volume", value };
  }
  if (/^(?:sound\s+on|sfx\s+on|cues\s+on)$/.test(t)) return { kind: "sound-on" };
  if (/^(?:sound\s+off|sfx\s+off|cues\s+off|no\s+sound)$/.test(t)) return { kind: "sound-off" };
  if (/^(?:voice\s+on|host\s+voice\s+on)$/.test(t)) return { kind: "voice-on" };
  if (/^(?:voice\s+off|host\s+voice\s+off|stop\s+the\s+voice)$/.test(t)) return { kind: "voice-off" };
  if (/^(?:download\s+(?:the\s+)?summary(?:\s+file)?)$/.test(t)) return { kind: "download-summary" };
  if (/^(?:download\s+(?:the\s+)?transcript(?:\s+file)?)$/.test(t)) return { kind: "download-transcript" };
  if (/^(?:download|download\s+(?:the\s+)?file)$/.test(t)) return { kind: "download" };
  if (/^(?:close|close\s+(?:the\s+)?transcript|close\s+it)$/.test(t)) return { kind: "close-transcript" };
  if (/^(?:show\s+(?:the\s+)?transcript|open\s+(?:the\s+)?transcript|full\s+transcript|read\s+(?:the\s+)?transcript|transcript)$/.test(t)) {
    return { kind: "show-transcript" };
  }
  if (/^(?:hide\s+(?:the\s+)?transcript)$/.test(t)) {
    return { kind: "hide-transcript" };
  }
  if (/^(?:test\s+voice|voice\s+test|test\s+the\s+host\s+voice|can\s+you\s+hear\s+me|check\s+voice)$/.test(t)) {
    return { kind: "test-voice" };
  }
  if (/^(?:save|save\s+(?:my\s+)?progress|save\s+(?:the\s+)?session|save\s+and\s+pause)$/.test(t)) {
    return { kind: "save" };
  }
  if (/^(?:where\s+am\s+i|what\s+is\s+next|whats\s+next|what\s+s\s+next|what\s+now|status|progress)$/.test(t)) {
    return { kind: "status" };
  }
  return null;
}

export type ControlOutcome = { settings: VoiceSettings; reply: string };

// Apply the controls that change settings/config. Journey controls
// (help, repeat, stop, continue, save, transcript, status, start over)
// are handled by the caller, which has the screen and the last line.
export function applyVoiceControl(
  settings: VoiceSettings,
  control: VoiceControl,
): ControlOutcome {
  const current = normalizeVoiceSettings(settings);
  switch (control.kind) {
    case "slower": {
      const rate = Math.max(0.55, Math.round((current.rate - 0.15) * 100) / 100);
      return {
        settings: { ...current, rate },
        reply: `Slower. I'll speak at ${Math.round(rate * 100)}% speed. Say “repeat that” to hear the last line again.`,
      };
    }
    case "faster": {
      const rate = Math.min(1.45, Math.round((current.rate + 0.15) * 100) / 100);
      return {
        settings: { ...current, rate },
        reply: `Faster. I'll speak at ${Math.round(rate * 100)}% speed.`,
      };
    }
    case "normal-speed":
      return { settings: { ...current, rate: 1 }, reply: "Back to normal speaking speed." };
    case "louder": {
      const volume = Math.min(1, Math.round((current.volume + 0.2) * 100) / 100);
      const sound = Math.min(1, Math.round((current.sound + 0.2) * 100) / 100);
      return {
        settings: { ...current, volume, sound, voiceOn: true, soundOn: true },
        reply: `Louder — host voice at ${Math.round(volume * 100)}%, sounds at ${Math.round(sound * 100)}%.`,
      };
    }
    case "quieter": {
      const volume = Math.max(0, Math.round((current.volume - 0.2) * 100) / 100);
      const sound = Math.max(0, Math.round((current.sound - 0.2) * 100) / 100);
      return {
        settings: { ...current, volume, sound },
        reply: `Quieter — host voice at ${Math.round(volume * 100)}%, sounds at ${Math.round(sound * 100)}%.`,
      };
    }
    case "mute":
      return {
        settings: { ...current, volume: 0, sound: 0 },
        reply: "Muted. I'll keep showing every line on screen. Say “unmute” to bring my voice back.",
      };
    case "unmute":
      return {
        settings: { ...current, volume: 1, sound: 0.8, voiceOn: true, soundOn: true },
        reply: "Unmuted. Host voice at 100%.",
      };
    case "volume": {
      const value = Math.min(100, Math.max(0, control.value ?? 100));
      return {
        settings: { ...current, volume: value / 100, sound: value / 100 },
        reply: `Volume set to ${value} percent.`,
      };
    }
    case "sound-on":
      return { settings: { ...current, soundOn: true, sound: Math.max(0.2, current.sound) }, reply: "Sound cues on." };
    case "sound-off":
      return { settings: { ...current, soundOn: false }, reply: "Sound cues off. The host voice stays on." };
    case "voice-on":
      return { settings: { ...current, voiceOn: true, volume: Math.max(0.2, current.volume) }, reply: "Host voice on." };
    case "voice-off":
      return { settings: { ...current, voiceOn: false }, reply: "Host voice off. Every line stays on screen. Say “voice on” to bring it back." };
    case "slow-mode":
      return {
        settings: { ...current, slowMode: true },
        reply: "Slow mode on. I'll wait longer after you pause, and I won't cut you off. Take your time.",
      };
    case "normal-mode":
      return {
        settings: { ...current, slowMode: false },
        reply: "Normal pacing on. I'll answer as soon as you pause.",
      };
    default:
      return { settings: current, reply: "" };
  }
}

// A stable, short status line for the settings strip.
export function settingsSummary(settings: VoiceSettings): string {
  const s = normalizeVoiceSettings(settings);
  const bits = [
    s.voiceOn ? `VOICE ${Math.round(s.rate * 100)}% · ${Math.round(s.volume * 100)}%` : "VOICE OFF",
    s.soundOn ? `SFX ${Math.round(s.sound * 100)}%` : "SFX OFF",
  ];
  if (s.slowMode) bits.push("SLOW MODE");
  return bits.join(" · ");
}
