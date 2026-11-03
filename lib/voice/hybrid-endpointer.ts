// Hybrid Endpointer for Fast Commands vs Model Turns
//
// Solves Meta Voice Transcribe 1.0's ~2.5s trailing silence wait for deterministic,
// reversible commands. Fast commands commit immediately after the Three-Factor
// Stability Guard is satisfied:
// 1. Context-gated canonical grammar match.
// 2. Hypothesis stability window (>= 250ms without text mutation).
// 3. Local acoustic silence window (>= 350ms).
//
// A fastCommittedTurnIds tombstone prevents duplicate execution when Meta's late
// speechComplete eventually arrives ~2 seconds later.

export type FastCommandType =
  | { kind: "CONFIRM_EQUITY"; text: string }
  | { kind: "APPROVE_NAME"; text: string };

export function normalizeTranscript(raw: string): string {
  return (raw || "")
    .toLowerCase()
    .replace(/[^\w\s]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export interface HybridEndpointerOptions {
  stabilityMs?: number;
  silenceMs?: number;
  rmsThreshold?: number;
  onFastCommit: (turnId: number, cmd: FastCommandType, rawText: string) => void;
  onModelCommit: (turnId: number, finalTranscript: string) => void;
}

export class HybridEndpointer {
  private activeTurnId = 0;
  private latestPartialNormalized = "";
  private latestPartialRaw = "";
  private partialStableSinceMs = 0;
  private silenceStartMs: number | null = null;
  private fastCommittedTurnIds = new Set<number>();
  private contextGetter: () => {
    equityConfirm: boolean;
    namePromptActive: boolean;
  };

  private readonly stabilityMs: number;
  private readonly silenceMs: number;
  private readonly rmsThreshold: number;
  private readonly onFastCommit: (turnId: number, cmd: FastCommandType, rawText: string) => void;
  private readonly onModelCommit: (turnId: number, finalTranscript: string) => void;

  constructor(
    contextGetter: () => {
      equityConfirm: boolean;
      namePromptActive: boolean;
    },
    options: HybridEndpointerOptions,
  ) {
    this.contextGetter = contextGetter;
    this.stabilityMs = options.stabilityMs ?? 250;
    this.silenceMs = options.silenceMs ?? 350;
    this.rmsThreshold = options.rmsThreshold ?? 0.015;
    this.onFastCommit = options.onFastCommit;
    this.onModelCommit = options.onModelCommit;
  }

  public getActiveTurnId(): number {
    return this.activeTurnId;
  }

  public setActiveTurnId(turnId: number): void {
    this.activeTurnId = turnId;
    this.latestPartialNormalized = "";
    this.latestPartialRaw = "";
    this.partialStableSinceMs = performance.now();
    this.silenceStartMs = null;
  }

  public isFastCommitted(turnId: number): boolean {
    return this.fastCommittedTurnIds.has(turnId);
  }

  public onTranscript(rawText: string, now = performance.now()): void {
    if (this.fastCommittedTurnIds.has(this.activeTurnId)) return;
    const norm = normalizeTranscript(rawText);
    if (norm !== this.latestPartialNormalized) {
      this.latestPartialNormalized = norm;
      this.latestPartialRaw = rawText;
      this.partialStableSinceMs = now;
    }
    this.evaluateFastCommit(now);
  }

  public handleMetaEvent(msg: {
    type?: string;
    turnId?: number;
    transcript?: string;
    final?: boolean;
    audioProcessedMs?: number;
  }): void {
    const now = performance.now();
    const type = msg.type;

    if (type === "speechStart") {
      this.activeTurnId = msg.turnId ?? this.activeTurnId;
      this.latestPartialNormalized = "";
      this.latestPartialRaw = "";
      this.partialStableSinceMs = now;
      this.silenceStartMs = null;
      return;
    }

    if (type === "transcript") {
      const raw = msg.transcript ?? "";
      this.onTranscript(raw, now);
      return;
    }

    if (type === "speechEnd") {
      // SpeechEnd ack disabled completely to eliminate acoustic feedback loops
      return;
    }

    if (type === "speechComplete") {
      const turnId = msg.turnId ?? this.activeTurnId;
      if (this.fastCommittedTurnIds.has(turnId)) {
        // Already fast-committed; discard late speechComplete frame
        return;
      }
      const text = (msg.transcript ?? "").trim();
      if (text) {
        this.onModelCommit(turnId, text);
      }
    }
  }

  public onAudioRms(rms: number, now = performance.now()): void {
    if (rms < this.rmsThreshold) {
      if (this.silenceStartMs === null) this.silenceStartMs = now;
      this.evaluateFastCommit(now);
    } else {
      this.silenceStartMs = null; // Voice detected, reset silence timer
    }
  }

  public matchFastGrammar(normText: string): FastCommandType | null {
    if (!normText) return null;
    const ctx = this.contextGetter();

    if (ctx.equityConfirm) {
      // Affirmative confirm equity: "confirm", "confirm split", "confirm this split", "yes", etc.
      if (
        /^(?:yes|yeah|yep|sure|ok|okay|confirm|confirmed|confirm\s+(?:the\s+|this\s+)?split|the\s+split|split(?:\s+confirmed)?|looks\s+good|lock\s+it\s+in|approve|proceed)$/.test(
          normText,
        )
      ) {
        return { kind: "CONFIRM_EQUITY", text: this.latestPartialRaw || normText };
      }
      // Do NOT fast-commit "no"/"change" on a partial. A user correcting
      // the split says "No, 70/30"; a 350 ms pause after "No" used to
      // commit the change branch, answer "No problem…", and discard the
      // rest of the sentence while the mic was still listening. Negative
      // commands are not latency-critical: let the final transcript reach
      // sendToAgent, which still handles a pure "no". The confirm path
      // remains fast because it is short and explicit.
    }

    if (ctx.namePromptActive) {
      if (/^(?:yes|yep|approve|approve\s+name|looks\s+good|confirm)$/.test(normText)) {
        return { kind: "APPROVE_NAME", text: this.latestPartialRaw || normText };
      }
    }

    return null;
  }

  private evaluateFastCommit(now: number): void {
    if (this.activeTurnId === 0 || this.fastCommittedTurnIds.has(this.activeTurnId)) return;
    if (!this.latestPartialNormalized) return;

    const match = this.matchFastGrammar(this.latestPartialNormalized);
    if (!match) return;

    const partialAgeMs = now - this.partialStableSinceMs;
    // Silence guard: either client RMS silence for >= silenceMs, or partial stable for >= (stabilityMs + silenceMs)
    const silenceDurationMs = this.silenceStartMs !== null ? now - this.silenceStartMs : 0;

    const isStable = partialAgeMs >= this.stabilityMs;
    const isQuiet = silenceDurationMs >= this.silenceMs || partialAgeMs >= (this.stabilityMs + this.silenceMs);

    if (isStable && isQuiet) {
      this.fastCommittedTurnIds.add(this.activeTurnId);
      this.onFastCommit(this.activeTurnId, match, this.latestPartialRaw || this.latestPartialNormalized);
    }
  }

  public forceFastCommitNow(fallbackText?: string): boolean {
    if (this.activeTurnId === 0 || this.fastCommittedTurnIds.has(this.activeTurnId)) return false;
    let norm = this.latestPartialNormalized;
    let raw = this.latestPartialRaw;
    if (!norm && fallbackText) {
      norm = normalizeTranscript(fallbackText);
      raw = fallbackText;
      this.latestPartialNormalized = norm;
      this.latestPartialRaw = raw;
    }
    if (!norm) return false;
    const match = this.matchFastGrammar(norm);
    if (!match) return false;
    this.fastCommittedTurnIds.add(this.activeTurnId);
    this.onFastCommit(this.activeTurnId, match, raw || norm);
    return true;
  }
}
