"use client";

// Always-on caption history. This is not a transcript modal: every host
// line and every heard word stays visible in the left rail for the whole
// run, in order, and follows the newest line automatically.

import { useEffect, useRef } from "react";
import type { TranscriptEntry } from "../lib/persistence";

export default function CaptionHistory({ entries }: { entries: TranscriptEntry[] }) {
  const listRef = useRef<HTMLOListElement | null>(null);

  useEffect(() => {
    const list = listRef.current;
    if (!list) return;
    list.scrollTop = list.scrollHeight;
  }, [entries.length]);

  return (
    <section
      className="panel caption-history-panel"
      data-testid="caption-history-panel"
      aria-label="Live captions, full history"
    >
      <header className="caption-history-head">
        <div>
          <span className="eyebrow">LIVE CAPTIONS</span>
          <h2>Full history</h2>
        </div>
        <span className="caption-history-count" data-testid="caption-history-count">
          {entries.length} {entries.length === 1 ? "LINE" : "LINES"}
        </span>
      </header>
      <ol className="caption-history-list" data-testid="caption-history" ref={listRef}>
        {entries.length === 0 ? (
          <li className="caption-history-empty">
            Every host line and every heard word will appear here, in order.
          </li>
        ) : (
          entries.map((entry, index) => (
            <li
              key={`${entry.at}-${index}`}
              className={`caption-history-line is-${entry.role}`}
              data-role={entry.role}
            >
              <span className="caption-history-who">{entry.role === "you" ? "HEARD" : "HOST"}</span>
              <p>{entry.text}</p>
            </li>
          ))
        )}
      </ol>
      <p className="caption-history-foot">Always visible · newest last · demo only.</p>
    </section>
  );
}
