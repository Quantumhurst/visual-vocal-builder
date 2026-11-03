// Streaming Sentence Chunker for Real-Time LLM-to-Speech
//
// Chunks streaming text tokens at natural sentence/clause boundaries so speech
// can start playing on the first sentence without waiting for full tool calls
// or message completion.
//
// Guards against choppy prosody via abbreviation filtering and minimum word count.

const ABBREVIATION_REGEX = /\b(?:Mr|Mrs|Ms|Dr|Jr|Sr|Inc|Ltd|Corp|Co|vs|etc|e\.g|i\.e|U\.S|No)\.$/i;

export class StreamingSentenceChunker {
  private buffer = "";

  public onTextDelta(delta: string, emitSentence: (sentence: string) => void): void {
    this.buffer += delta;
    this.tryFlushCompleteSegments(emitSentence);
  }

  public onTextMessageEnd(emitSentence: (sentence: string) => void): void {
    const remaining = this.buffer.trim();
    this.buffer = "";
    if (remaining.length > 0) {
      emitSentence(remaining);
    }
  }

  public reset(): void {
    this.buffer = "";
  }

  public getPendingBuffer(): string {
    return this.buffer;
  }

  private tryFlushCompleteSegments(emitSentence: (sentence: string) => void): void {
    // Match sentence endings (. ? !) or long clause boundaries (: ; —) followed by whitespace
    const boundaryMatch = this.buffer.match(/^([\s\S]*?([.?!:;—]))\s+([\s\S]*)$/);
    if (!boundaryMatch) return;

    const candidate = boundaryMatch[1].trim();
    const delimiter = boundaryMatch[2];
    const remainder = boundaryMatch[3];

    // Don't split on abbreviations like "Inc." or "e.g."
    if (ABBREVIATION_REGEX.test(candidate)) return;

    const words = candidate.split(/\s+/).filter(Boolean);
    const wordCount = words.length;
    const isSentenceEnd = /[.?!]/.test(delimiter);

    // Flush at sentence end if >= 2 words, or clause boundary if >= 6 words
    if ((isSentenceEnd && wordCount >= 2) || (!isSentenceEnd && wordCount >= 6)) {
      this.buffer = remainder;
      emitSentence(candidate);
      this.tryFlushCompleteSegments(emitSentence);
    }
  }
}
