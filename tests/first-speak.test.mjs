// First-Speak greeting: one spoken line, once per session, no state and
// no new facts. The line must stay identical to the jurisdiction host
// question so the greeting can never drift into a new claim.

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  FIRST_SPEAK_GREETING,
  FIRST_SPEAK_STORAGE_KEY,
  hasFirstSpeakGreeting,
  markFirstSpeakGreeting,
} from "../lib/first-speak.ts";
import { getHostQuestion } from "../lib/host-questions.ts";

function memoryStore() {
  const values = new Map();
  return {
    getItem: (key) => (values.has(key) ? values.get(key) : null),
    setItem: (key, value) => values.set(key, value),
    values,
  };
}

test("greeting is exactly the jurisdiction host question", () => {
  assert.equal(FIRST_SPEAK_GREETING, "Pick your home base — Mars, Europa, or Andromeda Galaxy?");
  assert.equal(FIRST_SPEAK_GREETING, getHostQuestion("jurisdiction"));
});

test("the greeting names only the three demo worlds", () => {
  assert.match(FIRST_SPEAK_GREETING, /^Pick your home base — Mars, Europa, or Andromeda Galaxy\?$/);
  assert.equal((FIRST_SPEAK_GREETING.match(/\?/g) ?? []).length, 1);
});

test("a fresh session has not greeted; marking is once and sticks", () => {
  const store = memoryStore();
  assert.equal(hasFirstSpeakGreeting(store), false);
  markFirstSpeakGreeting(store);
  assert.equal(hasFirstSpeakGreeting(store), true);
  assert.equal(store.values.get(FIRST_SPEAK_STORAGE_KEY), "1");
});

test("separate sessions do not share the marker", () => {
  const first = memoryStore();
  const second = memoryStore();
  markFirstSpeakGreeting(first);
  assert.equal(hasFirstSpeakGreeting(first), true);
  assert.equal(hasFirstSpeakGreeting(second), false);
});

test("missing or throwing storage never breaks the Speak path", () => {
  assert.equal(hasFirstSpeakGreeting(null), false);
  assert.equal(hasFirstSpeakGreeting(undefined), false);
  const broken = {
    getItem() {
      throw new Error("blocked");
    },
    setItem() {
      throw new Error("blocked");
    },
  };
  assert.equal(hasFirstSpeakGreeting(broken), false);
  assert.doesNotThrow(() => markFirstSpeakGreeting(broken));
});
