// Surviving Speech Queue — Web Speech API FIFO wrapper
//
// Prevents premature garbage collection and cancellation:
// 1. Keeps strong references in a Set so Chromium / WebKit do not GC in-flight utterances.
// 2. Uses native FIFO queueing so spoken acknowledgements ("On it.") finish cleanly
//    before streamed LLM sentences begin.
// 3. Never calls speechSynthesis.cancel() during normal queue append — cancel() is reserved
//    exclusively for user barge-in / stop events.

export type UtteranceRole = "ACK" | "CONTENT" | "HOST";

export class SurvivingSpeechQueue {
  private activeUtterances = new Set<SpeechSynthesisUtterance>();
  private ackPlayedForTurn = new Set<number>();
  private cachedVoice: SpeechSynthesisVoice | null = null;

  public getVoice(): SpeechSynthesisVoice | null {
    if (this.cachedVoice) return this.cachedVoice;
    if (typeof window === "undefined" || !("speechSynthesis" in window)) return null;
    const voices = window.speechSynthesis.getVoices();
    if (!voices.length) return null;

    // Prioritize localService === true to eliminate 300-800ms cloud round-trips
    const localEnglish = voices.filter(
      (v) => v.localService === true && v.lang.toLowerCase().startsWith("en"),
    );
    const preferredNames = ["Samantha", "Ava", "Alex", "Karen", "Microsoft Aria", "Microsoft Guy", "Daniel"];
    this.cachedVoice =
      localEnglish.find((v) => preferredNames.some((n) => v.name.includes(n))) ||
      localEnglish[0] ||
      voices.find((v) => preferredNames.some((n) => v.name.includes(n))) ||
      voices.find((v) => v.lang.toLowerCase().startsWith("en")) ||
      voices[0];
    return this.cachedVoice;
  }

  public clearCachedVoice(): void {
    this.cachedVoice = null;
  }

  public enqueue(
    text: string,
    _role: UtteranceRole = "CONTENT",
    rate = 1.05,
    onDone?: () => void,
  ): SpeechSynthesisUtterance | null {
    void _role;
    const clean = text.trim();
    if (!clean || typeof window === "undefined" || !("speechSynthesis" in window)) {
      onDone?.();
      return null;
    }

    try {
      const utterance = new SpeechSynthesisUtterance(clean);
      const voice = this.getVoice();
      if (voice) utterance.voice = voice;
      utterance.rate = rate;

      this.activeUtterances.add(utterance);

      const cleanup = () => {
        this.activeUtterances.delete(utterance);
        onDone?.();
      };

      utterance.onend = cleanup;
      utterance.onerror = cleanup;

      // Chrome sometimes suspends synthesis on idle or tab change
      try {
        window.speechSynthesis.resume();
      } catch {
        // ignore
      }

      window.speechSynthesis.speak(utterance);
      return utterance;
    } catch {
      onDone?.();
      return null;
    }
  }

  public triggerTurnAckOnSpeechEnd(_turnId?: number, _lastPartial?: string): boolean {
    void _turnId;
    void _lastPartial;
    // Disabled completely to eliminate acoustic self-echo loops on speakers/mics
    return false;
  }

  public markTurnAckClaimed(turnId: number): void {
    this.ackPlayedForTurn.add(turnId);
  }

  public hardFlushOnBargeIn(): void {
    this.activeUtterances.clear();
    if (typeof window !== "undefined" && "speechSynthesis" in window) {
      try {
        window.speechSynthesis.cancel();
      } catch {
        // ignore
      }
    }
  }

  public isSpeaking(): boolean {
    if (typeof window === "undefined" || !("speechSynthesis" in window)) return false;
    return window.speechSynthesis.speaking || this.activeUtterances.size > 0;
  }
}

export const speechQueue = new SurvivingSpeechQueue();
