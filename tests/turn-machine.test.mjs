import { test } from "node:test";
import assert from "node:assert/strict";
import {
  INITIAL_TURN,
  canRearm,
  canRecoveryRearm,
  isBusy,
  micHot,
  turnPhaseOf,
  turnReducer,
} from "../lib/turn-machine.ts";

const run = (events, from = INITIAL_TURN) => events.reduce(turnReducer, from);
const work = (key, on) => ({ type: "WORK", key, on });

test("one full conversation turn returns to an idle, re-armable state", () => {
  let s = run([{ type: "CONVO_START" }, { type: "MIC_REQUEST" }]);
  assert.equal(s.mic, "opening");
  assert.equal(micHot(s), true);
  assert.equal(turnPhaseOf(s), "idle", "requested is not yet recording");
  s = run([{ type: "MIC_OPEN" }], s);
  assert.equal(turnPhaseOf(s), "recording");
  s = run([{ type: "MIC_CLOSED" }, work("transcribing", true)], s);
  assert.equal(turnPhaseOf(s), "transcribing");
  assert.equal(canRearm(s), false);
  s = run([work("transcribing", false), work("sending", true)], s);
  assert.equal(turnPhaseOf(s), "sending");
  s = run([work("agent", true), work("sending", false)], s);
  assert.equal(turnPhaseOf(s), "agent-busy");
  s = run([work("agent", false), { type: "HOST_START" }], s);
  assert.equal(canRearm(s), false, "never re-arm over the host");
  s = run([{ type: "HOST_END" }], s);
  assert.equal(canRearm(s), true);
  s = run([{ type: "REARM_REQUEST" }], s);
  assert.equal(s.rearm, "pending");
  s = run([{ type: "REARM_FIRE", via: "pending" }], s);
  assert.equal(s.mic, "opening", "the mic re-opens by itself");
  assert.equal(s.rearm, "none");
});

test("busy flags overlap: the lane is busy until every one is off", () => {
  let s = run([work("sending", true), work("agent", true), work("sending", false)]);
  assert.equal(isBusy(s), true);
  s = run([work("agent", false)], s);
  assert.equal(isBusy(s), false);
});

test("a re-arm is refused outside a conversation, while busy, over an error, or while the host speaks", () => {
  const idle = run([{ type: "CONVO_START" }]);
  assert.equal(run([{ type: "REARM_REQUEST" }], INITIAL_TURN).rearm, "none", "no conversation");
  assert.equal(run([work("sending", true), { type: "REARM_REQUEST" }], idle).rearm, "none", "busy");
  assert.equal(run([work("transcribing", true), { type: "REARM_REQUEST" }], idle).rearm, "none", "transcribing");
  assert.equal(run([{ type: "ERROR", on: true }, { type: "REARM_REQUEST" }], idle).rearm, "none", "error");
  assert.equal(run([{ type: "HOST_START" }, { type: "REARM_REQUEST" }], idle).rearm, "none", "host");
  assert.equal(run([{ type: "MIC_REQUEST" }, { type: "REARM_REQUEST" }], idle).rearm, "none", "mic hot");
});

test("a pending re-arm that is no longer allowed when it fires does not open the mic", () => {
  const pending = run([{ type: "CONVO_START" }, { type: "REARM_REQUEST" }]);
  assert.equal(pending.rearm, "pending");
  for (const blocker of [{ type: "HOST_START" }, work("agent", true), { type: "ERROR", on: true }]) {
    const s = run([blocker, { type: "REARM_FIRE", via: "pending" }], pending);
    assert.equal(s.mic, "closed", blocker.type);
    assert.equal(s.rearm, "none", blocker.type);
  }
  const ended = run([{ type: "CONVO_END" }, { type: "REARM_FIRE", via: "pending" }], pending);
  assert.equal(ended.mic, "closed");
});

test("only the current re-arm timer may act; a stale or cancelled one does nothing", () => {
  const recovery = run([
    { type: "CONVO_START" },
    { type: "ERROR", on: true },
    { type: "RECOVERY", kind: "agent-error", rearm: true },
  ]);
  // The short 420 ms timer must not open the mic early for a recovery.
  assert.equal(run([{ type: "REARM_FIRE", via: "pending" }], recovery), recovery);
  const cancelled = run([{ type: "CONVO_START" }, { type: "REARM_REQUEST" }, { type: "REARM_CANCEL" }]);
  assert.equal(cancelled.rearm, "none");
  assert.equal(run([{ type: "REARM_FIRE", via: "pending" }], cancelled).mic, "closed");
});

test("the recovery re-arm opens the mic over the error it is recovering from", () => {
  let s = run([
    { type: "CONVO_START" },
    { type: "ERROR", on: true },
    { type: "RECOVERY", kind: "agent-error", rearm: true },
  ]);
  assert.equal(s.rearm, "recovery");
  assert.equal(canRearm(s), false);
  assert.equal(canRecoveryRearm(s), true);
  s = run([{ type: "REARM_FIRE", via: "recovery" }], s);
  assert.equal(s.mic, "opening");
  assert.equal(s.error, false, "opening the mic starts a clean turn");
  assert.equal(s.recovery, "agent-error", "the banner stays until real words clear it");
});

test("the recovery re-arm still never opens over the host", () => {
  const s = run([
    { type: "CONVO_START" },
    { type: "RECOVERY", kind: "no-speech", rearm: true },
    { type: "HOST_START" },
    { type: "REARM_FIRE", via: "recovery" },
  ]);
  assert.equal(s.mic, "closed");
  assert.equal(s.rearm, "none");
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

test("a second mic request while the mic is hot changes nothing", () => {
  const s = run([{ type: "MIC_REQUEST" }]);
  assert.equal(run([{ type: "MIC_REQUEST" }], s), s);
});

test("a turn spoken while the agent is busy is queued, then sent once when idle", () => {
  let s = run([{ type: "CONVO_START" }, work("agent", true), { type: "QUEUE", text: "Pick Mars" }]);
  assert.equal(s.outbox, null);
  s = run([{ type: "QUEUE", text: "Pick Europa" }], s);
  assert.equal(s.queued.text, "Pick Europa", "latest wins");
  s = run([work("agent", false)], s);
  assert.equal(s.outbox, "Pick Europa");
  assert.equal(s.queued, null);
  s = run([{ type: "SENT" }], s);
  assert.equal(s.outbox, null);
});

test("a turn queued when idle goes straight to the outbox", () => {
  assert.equal(run([{ type: "QUEUE", text: "status" }]).outbox, "status");
});

test("ending the conversation drops a queued turn", () => {
  const s = run([
    { type: "CONVO_START" },
    work("agent", true),
    { type: "QUEUE", text: "Pick Mars" },
    { type: "CONVO_END" },
    work("agent", false),
  ]);
  assert.equal(s.queued, null);
  assert.equal(s.outbox, null);
});

test("a mic failure ends the loop instead of retrying a broken capture", () => {
  const s = run([{ type: "CONVO_START" }, { type: "MIC_REQUEST" }, { type: "MIC_FAILED" }, { type: "REARM_REQUEST" }]);
  assert.equal(s.mic, "closed");
  assert.equal(s.convo, false);
  assert.equal(s.rearm, "none");
});

test("a held half-sentence is kept across the re-arm and cleared on demand", () => {
  let s = run([{ type: "CONVO_START" }, { type: "HOLD", text: "The planet I want is", at: 100 }]);
  s = run([{ type: "REARM_REQUEST" }, { type: "REARM_FIRE", via: "pending" }], s);
  assert.deepEqual(s.held, { text: "The planet I want is", at: 100 });
  assert.equal(run([{ type: "HOLD_CLEAR" }], s).held, null);
});

test("MIC_OPEN only moves forward from opening", () => {
  assert.equal(run([{ type: "MIC_OPEN" }]).mic, "closed");
});

test("an event that changes nothing returns the same state object", () => {
  for (const event of [
    { type: "MIC_CLOSED" },
    { type: "HOST_END" },
    { type: "REARM_CANCEL" },
    { type: "RECOVERY_CLEAR" },
    { type: "ERROR", on: false },
    work("sending", false),
    { type: "CONVO_END" },
  ]) {
    assert.equal(turnReducer(INITIAL_TURN, event), INITIAL_TURN, event.type);
  }
});

// Randomised invariant check: whatever order events arrive in, the loop
// never gets into a state the app cannot show truthfully.
test("invariants hold over 20,000 random events", () => {
  let seed = 12345;
  const rand = () => {
    seed = (seed * 1103515245 + 12345) % 2147483648;
    return seed / 2147483648;
  };
  const pick = (list) => list[Math.floor(rand() * list.length)];
  const makers = [
    () => ({ type: "CONVO_START" }),
    () => ({ type: "CONVO_END" }),
    () => ({ type: "MIC_REQUEST" }),
    () => ({ type: "MIC_OPEN" }),
    () => ({ type: "MIC_FAILED" }),
    () => ({ type: "MIC_CLOSED" }),
    () => work(pick(["transcribing", "sending", "agent"]), rand() < 0.5),
    () => ({ type: "HOST_START" }),
    () => ({ type: "HOST_END" }),
    () => ({ type: "HOST_CANCEL" }),
    () => ({ type: "REARM_REQUEST" }),
    () => ({ type: "REARM_FIRE", via: pick(["pending", "recovery"]) }),
    () => ({ type: "REARM_CANCEL" }),
    () => ({ type: "RECOVERY", kind: pick(["no-speech", "empty-turn", "agent-error", "host-silent"]), rearm: rand() < 0.7 }),
    () => ({ type: "RECOVERY_CLEAR" }),
    () => ({ type: "ERROR", on: rand() < 0.5 }),
    () => ({ type: "HOLD", text: "I want", at: 1 }),
    () => ({ type: "HOLD_CLEAR" }),
    () => ({ type: "QUEUE", text: `turn ${Math.floor(rand() * 100)}` }),
    () => ({ type: "SENT" }),
  ];
  // Settling events, weighted up so the loop regularly reaches idle and
  // the re-arm paths are really exercised, not just possible.
  const settle = [
    () => ({ type: "CONVO_START" }),
    () => ({ type: "MIC_CLOSED" }),
    () => work(pick(["transcribing", "sending", "agent"]), false),
    () => ({ type: "HOST_END" }),
    () => ({ type: "ERROR", on: false }),
    () => ({ type: "REARM_REQUEST" }),
    () => ({ type: "REARM_FIRE", via: pick(["pending", "recovery"]) }),
  ];
  let s = INITIAL_TURN;
  const seen = { autoOpen: 0, recoveryOpen: 0, outbox: 0, refusedFire: 0, staleFire: 0 };
  for (let i = 0; i < 20_000; i++) {
    const prev = s;
    const event = (rand() < 0.5 ? pick(settle) : pick(makers))();
    s = turnReducer(s, event);
    const where = `step ${i} ${JSON.stringify(event)}`;
    if (s.rearm !== "none") assert.equal(s.convo, true, where);
    if (!s.convo && s.queued) assert.equal(s.queued.convoWasActive, false, where);
    if (s.queued) assert.ok(isBusy(s) || s.outbox !== null, where);
    if (event.type === "REARM_FIRE") {
      if (prev.rearm !== event.via) {
        assert.equal(s, prev, `${where}: a stale timer must change nothing`);
        seen.staleFire += 1;
      } else if (prev.mic === "closed" && s.mic === "opening") {
        assert.ok(event.via === "recovery" ? canRecoveryRearm(prev) : canRearm(prev), where);
        seen.autoOpen += 1;
        if (event.via === "recovery") seen.recoveryOpen += 1;
      } else {
        seen.refusedFire += 1;
      }
    }
    if (s.mic === "opening" && prev.mic !== "opening") assert.equal(s.hostSpeaking, false, where);
    if (s.outbox && !prev.outbox) seen.outbox += 1;
  }
  for (const [path, count] of Object.entries(seen)) assert.ok(count > 0, `${path} never happened`);
});

test("caption phases follow the turn state the way the deck shows them today", async () => {
  const { captionPhase } = await import("../lib/captions.ts");
  const { captionInputOf } = await import("../lib/turn-machine.ts");
  const phase = (events, live = false) => captionPhase(captionInputOf(run(events), live));
  const open = [{ type: "CONVO_START" }, { type: "MIC_REQUEST" }, { type: "MIC_OPEN" }];
  assert.equal(phase([]), "idle");
  assert.equal(phase([{ type: "CONVO_START" }]), "re-arming");
  assert.equal(phase(open), "listening");
  assert.equal(phase(open, true), "hearing");
  assert.equal(phase([{ type: "CONVO_START" }, work("agent", true)]), "thinking");
  assert.equal(phase([{ type: "CONVO_START" }, { type: "HOST_START" }]), "host-speaking");
  assert.equal(
    phase([{ type: "CONVO_START" }, { type: "HOST_START" }, { type: "RECOVERY", kind: "host-silent", rearm: true }]),
    "recovering",
  );
  assert.equal(phase([{ type: "CONVO_START" }, { type: "RECOVERY", kind: "no-speech", rearm: true }, ...open.slice(1)]), "listening");
});
