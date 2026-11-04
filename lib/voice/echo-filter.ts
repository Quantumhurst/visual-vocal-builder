// Lexical Self-Echo Filter
//
// Prevents browser speechSynthesis output (which bypasses WebRTC AEC)
// from being transcribed by the microphone and triggering a feedback loop.
//
// Tracks active host words; if an incoming partial/transcript is >= 60% host words,
// the turn is tombstoned as acoustic self-echo and discarded.

export class LexicalEchoFilter {
  private activeHostTokens = new Set<string>();
  private ignoredEchoTurnIds = new Set<number>();
  private clearTimer: ReturnType<typeof setTimeout> | null = null;

  public recordHostSpeech(text: string): void {
    if (this.clearTimer) {
      clearTimeout(this.clearTimer);
      this.clearTimer = null;
    }
    const words = this.tokenize(text);
    for (const w of words) {
      this.activeHostTokens.add(w);
    }
  }

  public scheduleClear(delayMs = 1200): void {
    if (this.clearTimer) clearTimeout(this.clearTimer);
    this.clearTimer = setTimeout(() => {
      this.activeHostTokens.clear();
      this.clearTimer = null;
    }, delayMs);
  }

  public clear(): void {
    if (this.clearTimer) clearTimeout(this.clearTimer);
    this.activeHostTokens.clear();
    this.clearTimer = null;
  }

  public isTurnIgnored(turnId: number): boolean {
    return this.ignoredEchoTurnIds.has(turnId);
  }

  // The mic is gated while the host speaks, so lexical filtering is only
  // valid while host audio is actually active. After the host stops, a
  // short answer that reuses a host word ("Mars") is the user, not echo.
  public checkWhileHostActive(hostActive: boolean, turnId: number, transcript: string): boolean {
    if (!hostActive) return false;
    return this.checkAndTombstone(turnId, transcript);
  }

  public checkAndTombstone(turnId: number, transcript: string): boolean {
    if (this.ignoredEchoTurnIds.has(turnId)) return true;
    if (this.activeHostTokens.size === 0) return false;

    const words = this.tokenize(transcript);
    if (words.length === 0) return false;

    let matches = 0;
    for (const w of words) {
      if (this.activeHostTokens.has(w)) {
        matches++;
      }
    }

    const ratio = matches / words.length;
    // If >= 60% of words match what the host just spoke, it's acoustic self-echo!
    if (ratio >= 0.6) {
      this.ignoredEchoTurnIds.add(turnId);
      return true;
    }

    return false;
  }

  private tokenize(text: string): string[] {
    return (text || "")
      .toLowerCase()
      .replace(/[^\w\s]/g, "")
      .split(/\s+/)
      .filter((w) => w.length >= 2);
  }
}

export const echoFilter = new LexicalEchoFilter();

