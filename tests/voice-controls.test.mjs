import { test } from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_VOICE_SETTINGS,
  applyVoiceControl,
  normalizeVoiceSettings,
  parseVoiceControl,
  settingsSummary,
} from "../lib/voice-controls.ts";

const parse = (text) => parseVoiceControl(text)?.kind ?? null;

test("help, repeat, stop, slower, and start over are always understood", () => {
  assert.equal(parse("help"), "help");
  assert.equal(parse("I need help"), "help");
  assert.equal(parse("what can I say?"), "help");
  assert.equal(parse("repeat that"), "repeat");
  assert.equal(parse("say that again"), "repeat");
  assert.equal(parse("stop"), "stop");
  assert.equal(parse("stop talking please"), "stop");
  assert.equal(parse("repeat that, stop"), "stop");
  assert.equal(parse("help stop"), "stop");
  assert.equal(parse("slower"), "slower");
  assert.equal(parse("speak slower"), "slower");
  assert.equal(parse("start over"), "start-over");
  assert.equal(parse("fresh start"), "start-over");
});

test("volume, rate, pacing, transcript, save, and status are voice controls", () => {
  assert.equal(parse("louder"), "louder");
  assert.equal(parse("quieter"), "quieter");
  assert.equal(parse("mute"), "mute");
  assert.equal(parse("unmute"), "unmute");
  assert.equal(parse("volume 35"), "volume");
  assert.equal(parseVoiceControl("set volume to 35 percent")?.value, 35);
  assert.equal(parse("turn it up"), "louder");
  assert.equal(parse("slow mode"), "slow-mode");
  assert.equal(parse("take your time"), "slow-mode");
  assert.equal(parse("normal speed"), "normal-speed");
  assert.equal(parse("show transcript"), "show-transcript");
  assert.equal(parse("hide the transcript"), "hide-transcript");
  assert.equal(parse("save progress"), "save");
  assert.equal(parse("test voice"), "test-voice");
  assert.equal(parse("save progress <|speaker_A|>"), "save");
  assert.equal(parse("<|speaker_A|> stop"), "stop");
  assert.equal(parse("can you hear me"), "test-voice");
  assert.equal(parse("Savesave progress"), "save");
  assert.equal(parse("repeat that. that"), "repeat");
  assert.equal(parse("stop stop"), "stop");
  assert.equal(parse("where am I"), "status");
  assert.equal(parse("what's next"), "status");
});

test("download and close are voice controls, and close never targets the app", () => {
  assert.equal(parse("download"), "download");
  assert.equal(parse("download the file"), "download");
  assert.equal(parse("download summary"), "download-summary");
  assert.equal(parse("download the summary"), "download-summary");
  assert.equal(parse("download transcript"), "download-transcript");
  assert.equal(parse("download the transcript"), "download-transcript");
  assert.equal(parse("close"), "close-transcript");
  assert.equal(parse("close transcript"), "close-transcript");
  assert.equal(parse("close the transcript"), "close-transcript");
  assert.equal(parse("close it"), "close-transcript");
  // Anything that names the app/browser falls through; there is no
  // window.close path anywhere in the control handler.
  assert.equal(parse("close the app"), null);
  assert.equal(parse("close browser"), null);
});

test("real commands and questions fall through to the journey", () => {
  for (const text of [
    "Pick Mars",
    "Make Orbit 70%",
    "Approve Galactic Bagels",
    "What does the filing card say?",
    "Prepare the lawyer summary",
    "Build the next structure",
    "Yes",
    "No",
  ]) {
    assert.equal(parseVoiceControl(text), null, text);
  }
});

test("slower lowers the rate and faster raises it, inside bounds", () => {
  let settings = { ...DEFAULT_VOICE_SETTINGS };
  let out = applyVoiceControl(settings, { kind: "slower" });
  assert.ok(out.settings.rate < settings.rate);
  assert.match(out.reply, /Slower/);
  settings = out.settings;
  out = applyVoiceControl(settings, { kind: "faster" });
  assert.ok(out.settings.rate > settings.rate);
  for (let i = 0; i < 20; i++) {
    settings = applyVoiceControl(settings, { kind: "slower" }).settings;
  }
  assert.ok(settings.rate >= 0.5);
  settings = { ...DEFAULT_VOICE_SETTINGS };
  for (let i = 0; i < 20; i++) {
    settings = applyVoiceControl(settings, { kind: "faster" }).settings;
  }
  assert.ok(settings.rate <= 1.6);
});

test("volume commands change both the host voice and the cues, and mute is reversible", () => {
  let out = applyVoiceControl(DEFAULT_VOICE_SETTINGS, { kind: "volume", value: 35 });
  assert.equal(out.settings.volume, 0.35);
  assert.equal(out.settings.sound, 0.35);
  out = applyVoiceControl(out.settings, { kind: "mute" });
  assert.equal(out.settings.volume, 0);
  assert.equal(out.settings.sound, 0);
  assert.match(out.reply, /unmute/i);
  out = applyVoiceControl(out.settings, { kind: "unmute" });
  assert.equal(out.settings.volume, 1);
  assert.equal(out.settings.voiceOn, true);
});

test("slow mode is a setting, not just a phrase", () => {
  const slow = applyVoiceControl(DEFAULT_VOICE_SETTINGS, { kind: "slow-mode" }).settings;
  assert.equal(slow.slowMode, true);
  const normal = applyVoiceControl(slow, { kind: "normal-mode" }).settings;
  assert.equal(normal.slowMode, false);
});

test("settings normalize corrupt persisted values instead of throwing", () => {
  const s = normalizeVoiceSettings({ rate: 99, volume: -5, sound: Number.NaN, slowMode: "yes" });
  assert.ok(s.rate <= 1.6);
  assert.equal(s.volume, 0);
  assert.equal(s.sound, DEFAULT_VOICE_SETTINGS.sound);
  assert.equal(s.slowMode, false);
  assert.equal(normalizeVoiceSettings(null).rate, 1);
});

test("settings summary shows the state the user just set", () => {
  const summary = settingsSummary({
    ...DEFAULT_VOICE_SETTINGS,
    rate: 0.85,
    volume: 0.7,
    slowMode: true,
  });
  assert.match(summary, /VOICE 85% · 70%/);
  assert.match(summary, /SLOW MODE/);
});
