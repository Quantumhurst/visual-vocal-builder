// Single-slot pending-turn queue — pure, unit-testable (no DOM, no React).
//
// Why this exists: sendToAgent used to return silently while the agent
// was busy (sending or isLoading), so a spoken turn during a busy agent
// turn was lost with no error and no notice. Canvas now parks that turn
// here — latest text wins, never more than one — and flushes it exactly
// once when the lane goes idle. A queued turn is never sent after the
// user ends the conversation; it is dropped instead.

export const QUEUED_TURN_NOTICE = "Agent still working — queued, will send next.";

export type QueuedTurn = { text: string; convoWasActive: boolean } | null;

// Park a turn while busy. Latest text wins; there is never more than one.
export function queueTurn(_prev: QueuedTurn, text: string, convoActive: boolean): QueuedTurn {
  return { text, convoWasActive: convoActive };
}

// Decide what to do with the parked turn now. Returns the text to send
// (at most once — the slot is always cleared on a decision) and the
// resulting slot. Busy keeps the slot; an ended conversation drops it.
export function flushQueuedTurn(
  slot: QueuedTurn,
  busy: boolean,
  convoActive: boolean,
): { send: string | null; slot: QueuedTurn } {
  if (!slot || busy) return { send: null, slot };
  if (slot.convoWasActive && !convoActive) return { send: null, slot: null };
  return { send: slot.text, slot: null };
}
