"use client";

// Always-on caption history. This is not a transcript modal: every host
// line and every heard word stays visible in the left rail for the whole
// run, in order. It follows the newest line by default, but a reader who
// scrolls back is left alone until a new user turn or the resume tap.

import { useEffect, useRef, useState } from "react";
import type { TranscriptEntry } from "../lib/persistence";
import {
  countUserTurns,
  isNearBottom,
  shouldFollowAfterNewEntries,
} from "../lib/caption-scroll";

export default function CaptionHistory({ entries }: { entries: TranscriptEntry[] }) {
  const listRef = useRef<HTMLOListElement | null>(null);
  const followingRef = useRef(true);
  const lastUserTurnsRef = useRef(0);
  const [following, setFollowing] = useState(true);

  function scrollToNewest() {
    const list = listRef.current;
    if (!list) return;
    list.scrollTop = list.scrollHeight;
  }

  function handleScroll() {
    const list = listRef.current;
    if (!list) return;
    const near = isNearBottom(list.scrollTop, list.scrollHeight, list.clientHeight);
    followingRef.current = near;
    setFollowing((current) => (current === near ? current : near));
  }

  function resumeFollowing() {
    followingRef.current = true;
    setFollowing(true);
    requestAnimationFrame(scrollToNewest);
  }

  useEffect(() => {
    const list = listRef.current;
    if (!list) return;
    const userTurns = countUserTurns(entries);
    const nextFollow = shouldFollowAfterNewEntries(
      followingRef.current,
      userTurns,
      lastUserTurnsRef.current,
    );
    lastUserTurnsRef.current = userTurns;
    if (!nextFollow) return;
    if (!followingRef.current) {
      followingRef.current = true;
      setFollowing(true);
    }
    list.scrollTop = list.scrollHeight;
  }, [entries]);

  return (
    <section
      className="panel caption-history-panel"
      data-testid="caption-history-panel"
      data-following={following ? "true" : "false"}
      aria-label="Live captions, full history"
    >
      <header className="caption-history-head">
        <div>
          <span className="eyebrow">LIVE CAPTIONS</span>
          <h2>Full history</h2>
        </div>
        <div className="caption-history-actions">
          <span className="caption-history-count" data-testid="caption-history-count">
            {entries.length} {entries.length === 1 ? "LINE" : "LINES"}
          </span>
          {!following ? (
            <button
              type="button"
              className="caption-resume"
              data-testid="caption-resume"
              onClick={resumeFollowing}
              aria-label="Resume live captions auto-scroll"
            >
              RESUME LIVE ↓
            </button>
          ) : null}
        </div>
      </header>
      <ol
        className="caption-history-list"
        data-testid="caption-history"
        ref={listRef}
        onScroll={handleScroll}
      >
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
      <p className="caption-history-foot">Always visible · newest last · scroll back to read.</p>
    </section>
  );
}
