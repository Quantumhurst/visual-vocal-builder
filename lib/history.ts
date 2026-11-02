import type { SharedState } from "./state.ts";

export type HistoryEntry = { label: string; state: SharedState; at: number };
export const HISTORY_CAP = 20;
export const COALESCE_MS = 600;

// Deep equality for undo purposes. The transcript line is excluded:
// undo never rewinds what the user said.
export function statesEqual(a: SharedState, b: SharedState): boolean {
  const strip = (s: SharedState) => ({ ...s, transcript: "" });
  return JSON.stringify(strip(a)) === JSON.stringify(strip(b));
}

export function pushHistory(
  stack: HistoryEntry[],
  before: SharedState,
  label: string,
  now: number,
): HistoryEntry[] {
  const top = stack[stack.length - 1];
  if (top && statesEqual(top.state, before)) return stack;
  if (top && top.label === label && now - top.at < COALESCE_MS) {
    // Slider drags with the same label merge into one undo step:
    // keep the earliest "before", just extend the coalesce window.
    return [...stack.slice(0, -1), { ...top, at: now }];
  }
  const next = [...stack, { label, state: before, at: now }];
  return next.length > HISTORY_CAP ? next.slice(next.length - HISTORY_CAP) : next;
}

export function popHistory(
  stack: HistoryEntry[],
): { stack: HistoryEntry[]; entry: HistoryEntry | null } {
  if (stack.length === 0) return { stack, entry: null };
  return { stack: stack.slice(0, -1), entry: stack[stack.length - 1] };
}
