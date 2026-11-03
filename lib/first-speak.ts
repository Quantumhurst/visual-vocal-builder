// First-Speak greeting — pure, unit-testable.
//
// The judge's first press of TALK speaks the existing jurisdiction host
// question once per browser session, then opens the mic. This module
// owns only the copy and the session marker:
//   - the line is the same host question the objective already uses, so
//     it adds no fact and no new state;
//   - the marker is sessionStorage, so a reload in the same tab does not
//     repeat the greeting but a fresh session does;
//   - storage failures (private mode, blocked storage) must never break
//     the mic, so every access is best-effort.

import { getHostQuestion } from "./host-questions.ts";

export const FIRST_SPEAK_STORAGE_KEY = "vvb.first-speak-greeted";

// Exactly the existing jurisdiction host line. No new fact is introduced.
export const FIRST_SPEAK_GREETING = getHostQuestion("jurisdiction");

export type SessionStore = {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
};

export function hasFirstSpeakGreeting(store: SessionStore | null | undefined): boolean {
  if (!store) return false;
  try {
    return store.getItem(FIRST_SPEAK_STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

export function markFirstSpeakGreeting(store: SessionStore | null | undefined): void {
  if (!store) return;
  try {
    store.setItem(FIRST_SPEAK_STORAGE_KEY, "1");
  } catch {
    // The in-memory guard in the canvas still prevents a repeat this mount.
  }
}
