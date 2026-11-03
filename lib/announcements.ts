// Per-turn accessibility announcement budget — pure, unit-testable.
//
// Screen readers should hear a short turn story (what was heard + the
// result), not a stream of every visual status change. The cockpit keeps
// one polite live region and routes turn announcements through this budget.
// Errors and notices keep their own alert/status roles and are announced
// once by the browser; they are not re-broadcast here.

export const MAX_ANNOUNCEMENTS_PER_TURN = 2;

export class AnnouncementBudget {
  private turn = Number.NaN;
  private count = 0;
  private last = "";

  /** True when this message may be put in the live region for this turn. */
  allow(turn: number, text: string): boolean {
    const clean = (text ?? "").trim();
    if (!clean) return false;
    if (turn !== this.turn) {
      this.turn = turn;
      this.count = 0;
      this.last = "";
    }
    if (clean === this.last) return false;
    if (this.count >= MAX_ANNOUNCEMENTS_PER_TURN) return false;
    this.last = clean;
    this.count += 1;
    return true;
  }

  reset(): void {
    this.turn = Number.NaN;
    this.count = 0;
    this.last = "";
  }

  remainingFor(turn: number): number {
    if (turn !== this.turn) return MAX_ANNOUNCEMENTS_PER_TURN;
    return Math.max(0, MAX_ANNOUNCEMENTS_PER_TURN - this.count);
  }
}
