"use client";

// The expanded transcript view. Captions in the mission rail are the
// primary channel; this is the full, both-sides record of the run.

import type { TranscriptEntry } from "../lib/persistence";

type Props = {
  log: TranscriptEntry[];
  onClose: () => void;
};

export default function TranscriptPanel({ log, onClose }: Props) {
  return (
    <section
      className="transcript-panel"
      data-testid="transcript-panel"
      aria-label="Full conversation transcript"
    >
      <header className="transcript-head">
        <div>
          <span className="eyebrow">FULL TRANSCRIPT</span>
          <h2>Everything said, both sides</h2>
        </div>
        <button type="button" className="btn" onClick={onClose}>
          CLOSE
        </button>
      </header>
      <ol className="transcript-list" data-testid="transcript-list">
        {log.length === 0 ? (
          <li className="transcript-empty">Nothing said yet. Say “Enter the Bridge” or “Pick Mars”.</li>
        ) : (
          log.map((entry, index) => (
            <li key={`${entry.at}-${index}`} className={`transcript-entry is-${entry.role}`}>
              <span className="transcript-who">{entry.role === "you" ? "YOU" : "HOST"}</span>
              <p>{entry.text}</p>
            </li>
          ))
        )}
      </ol>
      <p className="transcript-foot">
        Demo transcript. Nothing here is legal advice, a filing, or a submission.
      </p>
    </section>
  );
}
