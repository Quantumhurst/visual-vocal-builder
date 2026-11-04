// Caption auto-follow — pure, unit-testable.
//
// The history normally follows the newest line. A reader who scrolls
// back should stay where they are; only a new conversational turn (a new
// HEARD line) or an explicit resume tap may pull them to the bottom.

export const CAPTION_BOTTOM_THRESHOLD = 24;

export function isNearBottom(
  scrollTop: number,
  scrollHeight: number,
  clientHeight: number,
  threshold = CAPTION_BOTTOM_THRESHOLD,
): boolean {
  if (![scrollTop, scrollHeight, clientHeight].every(Number.isFinite)) return true;
  if (scrollHeight <= clientHeight) return true;
  return scrollHeight - scrollTop - clientHeight <= threshold;
}

export function countUserTurns(entries: readonly { role: string }[]): number {
  return entries.reduce((total, entry) => total + (entry.role === "you" ? 1 : 0), 0);
}

/**
 * Following survives a host-only append; a new user turn re-enables it.
 * The caller is responsible for the actual scroll.
 */
export function shouldFollowAfterNewEntries(
  following: boolean,
  userTurns: number,
  previousUserTurns: number,
): boolean {
  return following || userTurns > previousUserTurns;
}
