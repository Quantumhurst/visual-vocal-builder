import { test } from "node:test";
import assert from "node:assert/strict";
import {
  appendCaptionLine,
  captionsAgree,
  captionPhase,
  captionPhaseLabel,
  heardCaption,
  heardCaptionLabel,
  heardCaptionState,
  heardPlaceholder,
  hostCaption,
} from "../lib/captions.ts";
import { spokenHostText } from "../lib/spoken-text.ts";

test("the host caption is exactly the text the speech engine speaks", () => {
  const long =
    "Mars is locked in. Next up: split the equity. Then build five structures. Then approve the name.";
  assert.equal(hostCaption(long), spokenHostText(long));
  assert.match(hostCaption(long), /^Mars is locked in\./);
  // The third sentence is not spoken, so it must not be captioned either.
  assert.doesNotMatch(hostCaption(long), /approve the name/);
  assert.equal(hostCaption("  Pick   Mars.  "), "Pick Mars.");
});

test("captionsAgree accepts the spoken cap and rejects different wording", () => {
  const full = "First sentence here. Second one follows! Third should be dropped?";
  const spoken = spokenHostText(full);
  assert.equal(captionsAgree(full, spoken), true);
  // A stale line that says something else is never agreement.
  assert.equal(captionsAgree("Pick Europa", "Pick Mars"), false);
  assert.equal(captionsAgree("", ""), false);
});

test("the heard caption strips ASR control tokens and collapses space", () => {
  assert.equal(heardCaption("<|speaker_A|> Pick   Mars <|language|>"), "Pick Mars");
  assert.equal(heardCaption("  "), "");
});

test("caption history is ordered, de-duplicated, and capped", () => {
  let history = [];
  history = appendCaptionLine(history, { role: "host", text: "Pick Mars.", at: 1 });
  history = appendCaptionLine(history, { role: "host", text: "Pick Mars.", at: 2 });
  assert.equal(history.length, 1);
  history = appendCaptionLine(history, { role: "you", text: "Pick Mars", at: 3 });
  assert.equal(history.length, 2);
  const capped = appendCaptionLine([{ role: "host", text: "a" }], { role: "you", text: "b" }, 1);
  assert.deepEqual(capped, [{ role: "you", text: "b" }]);
});

test("caption phase makes recovery outrank a healthy-looking LISTENING", () => {
  const base = {
    convoActive: true,
    recording: true,
    hasLiveWords: false,
    hostSpeaking: false,
    busy: false,
    recovering: false,
    rearming: false,
  };
  assert.equal(captionPhase(base), "listening");
  assert.equal(captionPhase({ ...base, hasLiveWords: true }), "hearing");
  assert.equal(captionPhase({ ...base, recovering: true }), "recovering");
  assert.equal(captionPhase({ ...base, hostSpeaking: true }), "host-speaking");
  assert.equal(captionPhase({ ...base, recording: false, busy: true }), "thinking");
  assert.equal(captionPhase({ ...base, recording: false }), "re-arming");
  assert.equal(captionPhase({ ...base, recording: false, convoActive: false }), "idle");
  assert.equal(captionPhaseLabel("recovering").tone, "warn");
  assert.match(captionPhaseLabel("listening").label, /MIC OPEN/);
  assert.match(captionPhaseLabel("re-arming").hint, /by itself/);
});

test("heardCaptionState labels a live turn LIVE, a finished turn LAST", () => {
  assert.equal(heardCaptionState("Pick", "Wrong", true), "live");
  assert.equal(heardCaptionState("", "Pick Mars", false), "last");
  assert.equal(heardCaptionState("", "", false), "waiting");
  assert.match(heardCaptionLabel("live"), /LIVE/);
  assert.match(heardCaptionLabel("last"), /LAST/);
});

test("the heard placeholder never claims the mic is open while it is closed", () => {
  assert.match(heardPlaceholder("host-speaking"), /mic opens when the host finishes/i);
  assert.doesNotMatch(heardPlaceholder("host-speaking"), /mic is open/i);
  assert.match(heardPlaceholder("thinking"), /re-arms/i);
  assert.match(heardPlaceholder("listening"), /mic is open/i);
  assert.match(heardPlaceholder("re-arming"), /reopening/i);
});
