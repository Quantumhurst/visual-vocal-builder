"use client";

// Persistent landing screen for the same `/` route.
//
// Voice first: the page listens for "Enter the bridge" (or "Resume" when
// a run is saved) and mounts the cockpit itself. The visible button is a
// fallback only. Entering stops the landing mic, then the cockpit opens
// the conversation and reopens its own mic without a click.

import { useEffect, useState } from "react";
import CanvasHost from "./Canvas";
import VoiceEntry from "./VoiceEntry";
import {
  clearSavedSession,
  loadSavedSession,
  type SavedSession,
} from "../lib/persistence";
import type { EntryMode } from "../lib/voice-entry";

type Session = { mode: EntryMode; saved: SavedSession | null };

export default function LandingGate() {
  const [saved, setSaved] = useState<SavedSession | null>(null);
  const [ready, setReady] = useState(false);
  const [session, setSession] = useState<Session | null>(null);

  useEffect(() => {
    // Deferred one tick: reading localStorage during the effect body and
    // setting state synchronously causes a cascading render in React 19.
    const timer = setTimeout(() => {
      setSaved(loadSavedSession());
      setReady(true);
    }, 0);
    return () => clearTimeout(timer);
  }, []);

  if (session) {
    const resume = session.mode === "resume" && Boolean(session.saved);
    return (
      <CanvasHost
        autoStart
        resumed={resume}
        initialState={resume ? session.saved?.state : undefined}
        initialSettings={resume ? session.saved?.settings : undefined}
        initialLog={resume ? session.saved?.log : undefined}
      />
    );
  }

  return (
    <main className="boot-screen landing-screen" aria-labelledby="voice-gate-title">
      {ready ? (
        <VoiceEntry
          saved={saved}
          onEnter={(mode) => setSession({ mode, saved })}
          onStartOver={() => {
            clearSavedSession();
            setSaved(null);
            setSession({ mode: "fresh", saved: null });
          }}
        />
      ) : (
        <div className="landing-loading" role="status">
          <span className="landing-spin" aria-hidden="true" />
          <p>Opening the bridge…</p>
        </div>
      )}
    </main>
  );
}
