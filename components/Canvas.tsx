"use client";

import { useRef, useState } from "react";
import {
  CopilotKit,
  useCoAgent,
  useCopilotAction,
  useCopilotChat,
  useCopilotReadable,
} from "@copilotkit/react-core";
import JurisdictionTable from "./JurisdictionTable";
import { DEMO_COMPANY_NAME, DEMO_JURISDICTIONS } from "../lib/demo-data";
import type { SharedState } from "../lib/state";

const INITIAL_STATE: SharedState = {
  currentBeat: "jurisdiction",
  transcript: "",
  jurisdictions: DEMO_JURISDICTIONS,
  selectedJurisdiction: null,
};

function Canvas() {
  const { state, setState } = useCoAgent<SharedState>({
    name: "vvb",
    initialState: INITIAL_STATE,
  });
  // Before the provider syncs agent state, `state` is undefined — and it can
  // also arrive as an empty or partial object. Merge over the initial state
  // so every render read has a value; never dereference `state` directly.
  const view = { ...INITIAL_STATE, ...state };
  const { appendMessage, isLoading } = useCopilotChat();
  const [recording, setRecording] = useState(false);
  const [typed, setTyped] = useState("");
  const [notice, setNotice] = useState("");
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  // Message ids come from a handler-local counter, not crypto.randomUUID():
  // Next 16's prerender flags randomUUID() in a client component even when
  // it only runs in an event handler.
  const messageIdRef = useRef(0);

  // Grounding for the agent: the demo's fictional company and places. The
  // agent reads this; it never becomes a real filing fact.
  useCopilotReadable({
    description:
      "Fictional demo company and fictional places for the incorporation demo",
    value: {
      company: DEMO_COMPANY_NAME,
      places: DEMO_JURISDICTIONS.map((row) => row.jurisdiction),
      note: "All demo data. Nothing here is a real jurisdiction or filing.",
    },
  });

  // The ONLY thing that sets jurisdiction-table state from voice is this
  // agent action. The transcript is forwarded to the agent untouched — no
  // client-side keyword parsing, no shortcut.
  useCopilotAction({
    name: "showJurisdictionComparison",
    description:
      "Show the fictional jurisdiction comparison table and optionally select one of the fictional places (Mars, Europa, Andromeda Galaxy). Call this when the user asks to compare jurisdictions, choose a place to incorporate, or start incorporating the fictional company.",
    parameters: [
      {
        name: "jurisdiction",
        type: "string",
        description:
          "Name of the fictional place the user picked, if they named one.",
        required: false,
      },
    ],
    handler: async ({ jurisdiction }) => {
      const match = DEMO_JURISDICTIONS.find(
        (row) =>
          jurisdiction &&
          row.jurisdiction.toLowerCase() === jurisdiction.toLowerCase(),
      );
      setState((prev) => ({
        ...INITIAL_STATE,
        ...prev,
        currentBeat: "jurisdiction",
        jurisdictions: DEMO_JURISDICTIONS,
        selectedJurisdiction: match
          ? match.jurisdiction
          : (prev?.selectedJurisdiction ?? null),
      }));
    },
  });

  async function sendToAgent(text: string) {
    const trimmed = text.trim();
    if (!trimmed) return;
    setState((prev) => ({ ...INITIAL_STATE, ...prev, transcript: trimmed }));
    messageIdRef.current += 1;
    await appendMessage({
      id: `msg-${messageIdRef.current}`,
      role: "user",
      content: trimmed,
    } as never);
  }

  async function toggleRecording() {
    if (recording) {
      mediaRecorderRef.current?.stop();
      setRecording(false);
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: true,
      });
      const recorder = new MediaRecorder(stream);
      chunksRef.current = [];
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) chunksRef.current.push(event.data);
      };
      recorder.onstop = async () => {
        stream.getTracks().forEach((track) => track.stop());
        const blob = new Blob(chunksRef.current, {
          type: recorder.mimeType || "audio/webm",
        });
        const form = new FormData();
        form.append("audio", blob, "recording.webm");
        setNotice("Transcribing…");
        try {
          const res = await fetch("/api/transcribe", {
            method: "POST",
            body: form,
          });
          const data = await res.json();
          if (!res.ok) {
            setNotice(`Transcribe failed: ${data.error ?? res.statusText}`);
            return;
          }
          setNotice("");
          await sendToAgent(data.transcript ?? "");
        } catch (error) {
          setNotice(
            `Transcribe failed: ${error instanceof Error ? error.message : "unknown error"}`,
          );
        }
      };
      mediaRecorderRef.current = recorder;
      recorder.start();
      setRecording(true);
    } catch {
      setNotice("Microphone access was not granted.");
    }
  }

  return (
    <main style={{ maxWidth: "900px", margin: "0 auto", padding: "2rem" }}>
      <h1>Visual Vocal Builder</h1>
      <p>
        <strong>
          Demo data only. This is not legal advice, not a filing, and nothing
          here is submitted to any registry.
        </strong>
      </p>
      <p>
        Fictional demo company: <strong>{DEMO_COMPANY_NAME}</strong> — not a
        real company. All places and figures below are invented.
      </p>

      <section aria-label="Voice input">
        <button onClick={toggleRecording}>
          {recording ? "Stop recording" : "Speak (mic)"}
        </button>{" "}
        <input
          value={typed}
          onChange={(event) => setTyped(event.target.value)}
          placeholder="Or type a command for the agent"
          style={{ minWidth: "320px" }}
        />{" "}
        <button
          onClick={async () => {
            await sendToAgent(typed);
            setTyped("");
          }}
        >
          Send to agent
        </button>
        {isLoading ? <p>Agent is working…</p> : null}
        {notice ? <p>{notice}</p> : null}
        {view.transcript ? (
          <p>
            Last transcript: <q>{view.transcript}</q>
          </p>
        ) : null}
      </section>

      <JurisdictionTable
        rows={view.jurisdictions}
        selected={view.selectedJurisdiction}
        onSelect={(jurisdiction) =>
          // Row clicks write shared state directly — no new prompt needed.
          setState((prev) => ({
            ...INITIAL_STATE,
            ...prev,
            selectedJurisdiction: jurisdiction,
          }))
        }
      />
    </main>
  );
}

// CopilotKit generates thread/message ids during render, which Next 16's
// static prerender rejects as unstable values. This host therefore always
// renders behind a Suspense boundary (see app/page.tsx), so it renders
// per request at runtime, never at build time.
export default function CanvasHost() {
  return (
    <CopilotKit runtimeUrl="/api/copilotkit">
      <Canvas />
    </CopilotKit>
  );
}
