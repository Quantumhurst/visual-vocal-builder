import { test } from "node:test";
import assert from "node:assert/strict";
import {
  INITIAL_TURN,
  canRearm,
  canRecoveryRearm,
  isBusy,
  turnPhaseOf,
  turnReducer,
} from "../lib/turn-machine.ts";

const run = (events, from = INITIAL_TURN) => events.reduce(turnReducer, from);

test("one full conversation turn returns to an idle, re-armable state", () => {
  let s = run([{ type: "CONVO_START" }, { type: "MIC_REQUEST" }]);
  assert.equal(s.mic, "opening");
  assert.equal(turnPhaseOf(s), "recording");
  s = run([{ type: "MIC_OPEN" }, { type: "MIC_FINISHING" }, { type: "MIC_CLOSED" }], s);
  assert.equal(turnPhaseOf(s), "idle");
  s = run([{ type: "TRANSCRIBE_START" }], s);
  assert.equal(turnPhaseOf(s), "transcribing");
  assert.equal(canRearm(s), false);
  s = run([{ type: "TRANSCRIBE_END" }, { type: "SEND_START" }], s);
  assert.equal(turnPhaseOf(s), "sending");
  s = run([{ type: "AGENT_START" }], s);
  assert.equal(turnPhaseOf(s), "agent-busy");
  s = run([{ type: "WORK_DONE" }, { type: "HOST_START" }], s);
  assert.equal(canRearm(s), false, "never re-arm over the host");
  s = run([{ type: "HOST_END" }], s);
  assert.equal(canRearm(s), true);
  s = run([{ type: "REARM_REQUEST" }], s);
  assert.equal(s.rearm, "pending");
  s = run([{ type: "REARM_FIRE" }], s);
  assert.equal(s.mic, "opening", "the mic re-opens by itself");
  assert.equal(s.rearm, "none");
});

test("a re-arm is refused outside a conversation, while busy, over an error, or while the host speaks", () => {
  const idle = run([{ type: "CONVO_START" }]);
  assert.equal(run([{ type: "REARM_REQUEST" }], INITIAL_TURN).rearm, "none", "no conversation");
  assert.equal(run([{ type: "SEND_START" }, { type: "REARM_REQUEST" }], idle).rearm, "none", "busy");
  assert.equal(run([{ type: "ERROR", on: true }, { type: "REARM_REQUEST" }], idle).rearm, "none", "error");
  assert.equal(run([{ type: "HOST_START" }, { type: "REARM_REQUEST" }], idle).rearm, "none", "host");
  assert.equal(run([{ type: "MIC_REQUEST" }, { type: "REARM_REQUEST" }], idle).rearm, "none", "mic open");
});

test("a pending re-arm that is no longer allowed when it fires does not open the mic", () => {
  const pending = run([{ type: "CONVO_START" }, { type: "REARM_REQUEST" }]);
  assert.equal(pending.rearm, "pending");
  for (const blocker of [
    { type: "HOST_START" },
    { type: "AGENT_START" },
    { type: "ERROR", on: true },
    { type: "CONVO_END" },
  ]) {
    const s = run([blocker, { type: "REARM_FIRE" }], pending);
    assert.equal(s.mic, "closed", blocker.type);
    assert.equal(s.rearm, "none", blocker.type);
  }
});

test("a stray re-arm fire with nothing pending does nothing", () => {
  const s = run([{ type: "CONVO_START" }, { type: "REARM_FIRE" }]);
  assert.equal(s.mic, "closed");
});

test("the recovery re-arm opens the mic over the error it is recovering from", () => {
  let s = run([
    { type: "CONVO_START" },
    { type: "ERROR", on: true },
    { type: "RECOVERY", kind: "agent-error", rearm: true },
  ]);
  assert.equal(s.recovery, "agent-error");
  assert.equal(s.rearm, "recovery");
  assert.equal(canRearm(s), false);
  assert.equal(canRecoveryRearm(s), true);
  s = run([{ type: "REARM_FIRE" }], s);
  assert.equal(s.mic, "opening");
  assert.equal(s.error, false, "opening the mic starts a clean turn");
  assert.equal(s.recovery, "agent-error", "the banner stays until real words clear it");
});

test("recovery outside a conversation shows the banner but never re-arms", () => {
  const s = run([{ type: "RECOVERY", kind: "no-speech", rearm: true }]);
  assert.equal(s.recovery, "no-speech");
  assert.equal(s.rearm, "none");
});

test("clearing recovery cancels its pending re-arm but not a normal one", () => {
  const rec = run([{ type: "CONVO_START" }, { type: "RECOVERY", kind: "empty-turn", rearm: true }]);
  assert.equal(run([{ type: "RECOVERY_CLEAR" }], rec).rearm, "none");
  const normal = run([{ type: "CONVO_START" }, { type: "REARM_REQUEST" }, { type: "RECOVERY_CLEAR" }]);
  assert.equal(normal.rearm, "pending");
});

test("barge-in: opening the mic silences the host", () => {
  const s = run([{ type: "CONVO_START" }, { type: "HOST_START" }, { type: "MIC_REQUEST" }]);
  assert.equal(s.hostSpeaking, false);
  assert.equal(s.mic, "opening");
});

test("a turn spoken while the agent is busy is queued, then sent once when idle", () => {
  let s = run([{ type: "CONVO_START" }, { type: "AGENT_START" }, { type: "QUEUE", text: "Pick Mars" }]);
  assert.equal(s.outbox, null);
  s = run([{ type: "QUEUE", text: "Pick Europa" }], s);
  assert.equal(s.queued.text, "Pick Europa", "latest wins");
  s = run([{ type: "WORK_DONE" }], s);
  assert.equal(s.outbox, "Pick Europa");
  assert.equal(s.queued, null);
  s = run([{ type: "SENT" }], s);
  assert.equal(s.outbox, null);
});

test("a turn queued when idle goes straight to the outbox", () => {
  const s = run([{ type: "QUEUE", text: "status" }]);
  assert.equal(s.outbox, "status");
});

test("ending the conversation drops a queued turn", () => {
  const s = run([
    { type: "CONVO_START" },
    { type: "AGENT_START" },
    { type: "QUEUE", text: "Pick Mars" },
    { type: "CONVO_END" },
    { type: "WORK_DONE" },
  ]);
  assert.equal(s.queued, null);
  assert.equal(s.outbox, null);
});

test("a mic failure ends the loop instead of retrying a broken capture", () => {
  const s = run([
    { type: "CONVO_START" },
    { type: "MIC_REQUEST" },
    { type: "MIC_FAILED" },
    { type: "REARM_REQUEST" },
  ]);
  assert.equal(s.mic, "closed");
  assert.equal(s.convo, false);
  assert.equal(s.rearm, "none");
});

test("a held half-sentence is kept across the re-arm and cleared on demand", () => {
  let s = run([{ type: "CONVO_START" }, { type: "HOLD", text: "The planet I want is", at: 100 }]);
  s = run([{ type: "REARM_REQUEST" }, { type: "REARM_FIRE" }], s);
  assert.deepEqual(s.held, { text: "The planet I want is", at: 100 });
  s = run([{ type: "HOLD_CLEAR" }], s);
  assert.equal(s.held, null);
});

test("MIC_OPEN and MIC_FINISHING only move forward from the right state", () => {
  assert.equal(run([{ type: "MIC_OPEN" }]).mic, "closed");
  assert.equal(run([{ type: "MIC_FINISHING" }]).mic, "closed");
});

// Randomised invariant check: whatever order events arrive in, the loop
// never gets into a state the app cannot show truthfully.
test("invariants hold over 20,000 random events", () => {
  let seed = 12345;
  const rand = () => {
    seed = (seed * 1103515245 + 12345) % 2147483648;
    return seed / 2147483648;
  };
  const kinds = ["no-speech", "empty-turn", "agent-error", "host-silent"];
  const makers = [
    () => ({ type: "CONVO_START" }),
    () => ({ type: "CONVO_END" }),
    () => ({ type: "MIC_REQUEST" }),
    () => ({ type: "MIC_OPEN" }),
    () => ({ type: "MIC_FAILED" }),
    () => ({ type: "MIC_FINISHING" }),
    () => ({ type: "MIC_CLOSED" }),
    () => ({ type: "TRANSCRIBE_START" }),
    () => ({ type: "TRANSCRIBE_END" }),
    () => ({ type: "SEND_START" }),
    () => ({ type: "AGENT_START" }),
    () => ({ type: "WORK_DONE" }),
    () => ({ type: "HOST_START" }),
    () => ({ type: "HOST_END" }),
    () => ({ type: "HOST_CANCEL" }),
    () => ({ type: "REARM_REQUEST" }),
    () => ({ type: "REARM_FIRE" }),
    () => ({ type: "RECOVERY", kind: kinds[Math.floor(rand() * kinds.length)], rearm: rand() < 0.7 }),
    () => ({ type: "RECOVERY_CLEAR" }),
    () => ({ type: "ERROR", on: rand() < 0.5 }),
    () => ({ type: "HOLD", text: "I want", at: 1 }),
    () => ({ type: "HOLD_CLEAR" }),
    () => ({ type: "QUEUE", text: `turn ${Math.floor(rand() * 100)}` }),
    () => ({ type: "SENT" }),
  ];
  let s = INITIAL_TURN;
  const seen = { autoOpen: 0, recoveryOpen: 0, outbox: 0, refusedFire: 0 };
  for (let i = 0; i < 20_000; i++) {
    const prev = s;
    const event = makers[Math.floor(rand() * makers.length)]();
    s = turnReducer(s, event);
    const where = `step ${i} ${JSON.stringify(event)}`;
    // A re-arm is only ever pending inside a conversation.
    if (s.rearm !== "none") assert.equal(s.convo, true, where);
    // Outside a conversation nothing waits to be sent on its behalf.
    if (!s.convo && s.queued) assert.equal(s.queued.convoWasActive, false, where);
    // Something is queued only while work is in flight or the outbox is full.
    if (s.queued) assert.ok(isBusy(s) || s.outbox !== null, where);
    // The mic opens by itself only through a re-arm that was allowed.
    if (event.type === "REARM_FIRE" && prev.mic === "closed" && s.mic === "opening") {
      assert.ok(prev.rearm === "recovery" ? canRecoveryRearm(prev) : canRearm(prev), where);
      seen.autoOpen += 1;
      if (prev.rearm === "recovery") seen.recoveryOpen += 1;
    }
    if (event.type === "REARM_FIRE" && prev.rearm !== "none" && s.mic === prev.mic) seen.refusedFire += 1;
    if (s.outbox && !prev.outbox) seen.outbox += 1;
    // Opening the mic is always barge-in.
    if (s.mic === "opening" && prev.mic !== "opening") assert.equal(s.hostSpeaking, false, where);
  }
  // The interesting paths were actually exercised, not skipped.
  for (const [path, count] of Object.entries(seen)) assert.ok(count > 0, `${path} never happened`);
});

test("caption phases follow the turn state the way the deck shows them today", async () => {
  const { captionPhase } = await import("../lib/captions.ts");
  const { captionInputOf } = await import("../lib/turn-machine.ts");
  const phase = (events, live = false) => captionPhase(captionInputOf(run(events), live));
  assert.equal(phase([]), "idle");
  assert.equal(phase([{ type: "CONVO_START" }]), "re-arming");
  assert.equal(phase([{ type: "CONVO_START" }, { type: "MIC_REQUEST" }]), "listening");
  assert.equal(phase([{ type: "CONVO_START" }, { type: "MIC_REQUEST" }], true), "hearing");
  assert.equal(phase([{ type: "CONVO_START" }, { type: "AGENT_START" }]), "thinking");
  assert.equal(phase([{ type: "CONVO_START" }, { type: "HOST_START" }]), "host-speaking");
  // Recovery outranks everything while the mic is closed…
  assert.equal(phase([{ type: "CONVO_START" }, { type: "HOST_START" }, { type: "RECOVERY", kind: "host-silent", rearm: true }]), "recovering");
  // …but an open mic says LISTENING: the screen must match the microphone.
  assert.equal(phase([{ type: "CONVO_START" }, { type: "RECOVERY", kind: "no-speech", rearm: true }, { type: "MIC_REQUEST" }]), "listening");
});
