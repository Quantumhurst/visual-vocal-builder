"use client";

import { useRef, useState } from "react";
import {
  CopilotKit,
  useCoAgent,
  useCopilotAction,
  useCopilotChat,
  useCopilotReadable,
} from "@copilotkit/react-core";
import { Role, TextMessage } from "@copilotkit/runtime-client-gql";
import dynamic from "next/dynamic";
import JurisdictionTable from "./JurisdictionTable";

// Pixi canvas must never render on the server (Day 4 hero island).
const GalaxyHero = dynamic(() => import("./GalaxyHero"), { ssr: false });
import EquitySlider from "./EquitySlider";
import FilingChecklist from "./FilingChecklist";
import FilingSteps from "./FilingSteps";
import RolloverFactCard from "./RolloverFactCard";
import LawyerSummary from "./LawyerSummary";
import {
  DEMO_CHECKLIST,
  DEMO_COMPANY_NAME,
  DEMO_FOUNDERS,
  DEMO_JURISDICTIONS,
} from "../lib/demo-data";
import { setFounderShare } from "../lib/equity";
import {
  FILING_STEPS_PACK,
  S85_PACK,
  findFact,
  findFactById,
} from "../lib/knowledge";
import { buildLawyerSummary } from "../lib/lawyer-summary";
import type { SharedState } from "../lib/state";

const INITIAL_STATE: SharedState = {
  currentBeat: "jurisdiction",
  transcript: "",
  jurisdictions: DEMO_JURISDICTIONS,
  selectedJurisdiction: null,
  founders: DEMO_FOUNDERS,
  equityNote: "",
  checklist: DEMO_CHECKLIST,
  rolloverCard: null,
  rolloverNote: "",
  filingStepsCard: null,
  filingStepsNote: "",
  lawyerPackage: "",
  lawyerNote: "",
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
  const messageIdRef = useRef(0);

  // THE one shared-state update path for equity (beat 2 invariant).
  // Slider drags call this directly; the voice-agent action below calls
  // the same function. Both normalize through setFounderShare(), so
  // neither surface can leave the split inconsistent — it totals 100%.
  function updateEquity(index: number, percent: number, via: string) {
    setState((prev) => {
      const base = { ...INITIAL_STATE, ...prev };
      const founders = setFounderShare(base.founders, index, percent);
      const changed = founders[index];
      return {
        ...base,
        currentBeat: "equity" as const,
        founders,
        equityNote: changed
          ? `${changed.name} set to ${changed.percent}% (${via}); other founder(s) adjusted so the split totals 100%.`
          : base.equityNote,
      };
    });
  }

  // THE one shared-state update path for the checklist (beat 3):
  // clicks and voice-agent actions both go through here.
  function updateChecklistItem(itemId: string, done: boolean) {
    setState((prev) => {
      const base = { ...INITIAL_STATE, ...prev };
      return {
        ...base,
        currentBeat: "checklist" as const,
        checklist: base.checklist.map((item) =>
          item.id === itemId ? { ...item, done } : item,
        ),
      };
    });
  }

  // Grounding for the agent: fictional company/places, current equity
  // and checklist state, and the s.85 pack's fact ids + topics. The
  // agent picks a factId; the card text itself comes from the pack.
  useCopilotReadable({
    description:
      "Fictional demo company, places, equity split, checklist state, and s.85 knowledge-pack fact index for the incorporation demo",
    value: {
      company: DEMO_COMPANY_NAME,
      places: DEMO_JURISDICTIONS.map((row) => row.jurisdiction),
      founders: view.founders,
      checklist: view.checklist.map((item) => ({
        id: item.id,
        label: item.label,
        done: item.done,
      })),
      s85PackId: S85_PACK.packId,
      s85Facts: S85_PACK.facts.map((fact) => ({
        factId: fact.factId,
        topic: fact.topic,
      })),
      filingStepsPackId: FILING_STEPS_PACK.packId,
      filingStepsFacts: FILING_STEPS_PACK.facts.map((fact) => ({
        factId: fact.factId,
        topic: fact.topic,
      })),
      note: "All demo data. Nothing here is a real jurisdiction or filing. For a rollover question, call showRolloverFact with a factId from s85Facts — never invent rollover content. For filing steps or fees, call showFilingSteps with factIds from filingStepsFacts — never invent steps or fees. To prepare the lawyer package, call prepareLawyerSummary.",
    },
  });

  // Beat 1 action (unchanged path): only the agent sets jurisdiction
  // state from voice. No client-side keyword parsing, no shortcut.
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

  // Beat 2 voice path: "make me 70%" -> same updateEquity() the slider
  // drags use, so 60/40 with a 70% request lands on 70/30, total 100%.
  useCopilotAction({
    name: "setFounderEquity",
    description:
      "Set one DEMO founder's equity percent (e.g. the user says 'make me 70%'). The other founder(s) auto-adjust so the split always totals 100%. Founders: DEMO Founder Nova (fictional), DEMO Founder Orbit (fictional).",
    parameters: [
      {
        name: "founder",
        type: "string",
        description: "Founder name, or 'me' for the first founder.",
        required: true,
      },
      {
        name: "percent",
        type: "number",
        description: "Target percent for that founder, 0-100.",
        required: true,
      },
    ],
    handler: async ({ founder, percent }) => {
      const base = { ...INITIAL_STATE, ...state };
      const wanted = (founder ?? "").toLowerCase();
      let index = base.founders.findIndex((entry) =>
        entry.name.toLowerCase().includes(wanted),
      );
      if (index < 0 && (wanted === "me" || wanted === "i" || wanted === "")) {
        index = 0;
      }
      if (index < 0) index = 0;
      updateEquity(index, Number(percent), "voice");
    },
  });

  // Beat 3 voice paths: check/uncheck one item, or advance the walk.
  useCopilotAction({
    name: "setChecklistItem",
    description:
      "Check or uncheck one filing-checklist item by its id (ids are in the readable checklist state). Use when the user answers a checklist step or asks to mark one done/not done.",
    parameters: [
      { name: "itemId", type: "string", description: "Checklist item id.", required: true },
      { name: "done", type: "boolean", description: "True to check, false to uncheck.", required: true },
    ],
    handler: async ({ itemId, done }) => {
      updateChecklistItem(itemId, Boolean(done));
    },
  });

  useCopilotAction({
    name: "advanceChecklist",
    description:
      "Mark the first not-yet-done filing-checklist item done and move the walk forward. Use as the user answers each checklist step.",
    parameters: [],
    handler: async () => {
      const base = { ...INITIAL_STATE, ...state };
      const next = base.checklist.find((item) => !item.done);
      if (next) updateChecklistItem(next.id, true);
    },
  });

  // Beat 4: grounded s.85 fact card. The handler looks the fact up in
  // the knowledge pack — the card text is the pack text verbatim and
  // shows pack/fact grounding. An unknown factId renders NO card.
  useCopilotAction({
    name: "showRolloverFact",
    description:
      "Show a grounded s.85 rollover fact card. Call with a factId from the readable s85Facts index when the user asks a rollover / section 85 question. Never invent rollover content; only pack facts become cards.",
    parameters: [
      { name: "factId", type: "string", description: "Fact id from the s85Facts index.", required: true },
      { name: "question", type: "string", description: "The user's rollover question.", required: false },
    ],
    handler: async ({ factId, question }) => {
      const found = findFactById(factId ?? "");
      setState((prev) => {
        const base = { ...INITIAL_STATE, ...prev };
        if (!found) {
          return {
            ...base,
            currentBeat: "rollover" as const,
            rolloverCard: null,
            rolloverNote:
              "No grounded fact matched that request in the knowledge pack, so no fact card is shown. An ungrounded answer would fail this beat.",
          };
        }
        return {
          ...base,
          currentBeat: "rollover" as const,
          rolloverCard: {
            question: question ?? "Rollover question",
            answer: found.fact.text,
            packId: found.pack.packId,
            factId: found.fact.factId,
            packTitle: found.pack.title,
          },
          rolloverNote: "",
        };
      });
    },
  });

  // Day 3: grounded filing-steps/fees card. The handler looks every
  // fact up in the filing-steps pack — card text is pack text verbatim
  // with pack/fact grounding. Any unknown factId renders NO card.
  useCopilotAction({
    name: "showFilingSteps",
    description:
      "Show grounded filing steps and fees facts. Call with factIds from the readable filingStepsFacts index when the user asks about filing steps, process order, or fees. Never invent steps or fees; only pack facts become cards.",
    parameters: [
      {
        name: "factIds",
        type: "string[]",
        description: "Fact ids from the filingStepsFacts index.",
        required: true,
      },
      { name: "question", type: "string", description: "The user's question.", required: false },
    ],
    handler: async ({ factIds, question }) => {
      const ids = Array.isArray(factIds) ? factIds : [];
      const found = ids
        .map((factId) => findFact(FILING_STEPS_PACK.packId, String(factId)))
        .filter((entry) => entry !== null);
      setState((prev) => {
        const base = { ...INITIAL_STATE, ...prev };
        if (found.length === 0) {
          return {
            ...base,
            currentBeat: "filingsteps" as const,
            filingStepsCard: null,
            filingStepsNote:
              "No grounded fact matched that request in the filing-steps pack, so no card is shown. An ungrounded answer would fail this component.",
          };
        }
        return {
          ...base,
          currentBeat: "filingsteps" as const,
          filingStepsCard: {
            question: question ?? "Filing steps and fees",
            packId: FILING_STEPS_PACK.packId,
            packTitle: FILING_STEPS_PACK.title,
            facts: found.map((entry) => ({
              factId: entry.fact.factId,
              topic: entry.fact.topic,
              text: entry.fact.text,
            })),
          },
          filingStepsNote: "",
        };
      });
    },
  });

  // Day 3: lawyer-summary package display. The Prepare button and this
  // agent action share buildLawyerSummary() over shared state — one
  // package, rendered on the canvas. Prep only; nothing is sent.
  function prepareLawyerPackage() {
    setState((prev) => {
      const base = { ...INITIAL_STATE, ...prev };
      return {
        ...base,
        currentBeat: "summary" as const,
        lawyerPackage: buildLawyerSummary(base, DEMO_COMPANY_NAME),
        lawyerNote:
          "Summary prepared. Copy or download it and forward it yourself — this app does not send email.",
      };
    });
  }

  useCopilotAction({
    name: "prepareLawyerSummary",
    description:
      "Prepare the lawyer-summary package (jurisdiction choice, equity split, checklist state) and display it on the canvas. Use when the user asks to prepare, show, or send-to-lawyer the summary. This only prepares the package for the user to forward; it never sends email.",
    parameters: [],
    handler: async () => {
      prepareLawyerPackage();
    },
  });

  async function sendToAgent(text: string) {
    const trimmed = text.trim();
    if (!trimmed) return;
    setState((prev) => ({ ...INITIAL_STATE, ...prev, transcript: trimmed }));
    messageIdRef.current += 1;
    await appendMessage(
      new TextMessage({
        id: `msg-${messageIdRef.current}`,
        role: Role.User,
        content: trimmed,
      }),
    );
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

      <GalaxyHero
        rows={view.jurisdictions}
        selected={view.selectedJurisdiction}
        onSelect={(jurisdiction) =>
          setState((prev) => ({
            ...INITIAL_STATE,
            ...prev,
            selectedJurisdiction: jurisdiction,
          }))
        }
      />

      <JurisdictionTable
        rows={view.jurisdictions}
        selected={view.selectedJurisdiction}
        onSelect={(jurisdiction) =>
          setState((prev) => ({
            ...INITIAL_STATE,
            ...prev,
            selectedJurisdiction: jurisdiction,
          }))
        }
      />

      <EquitySlider
        founders={view.founders}
        equityNote={view.equityNote}
        onShareChange={(index, percent) => updateEquity(index, percent, "slider")}
      />

      <FilingChecklist items={view.checklist} onToggle={updateChecklistItem} />

      <FilingSteps card={view.filingStepsCard} filingStepsNote={view.filingStepsNote} />

      <RolloverFactCard card={view.rolloverCard} rolloverNote={view.rolloverNote} />

      <LawyerSummary
        view={view}
        companyName={DEMO_COMPANY_NAME}
        lawyerPackage={view.lawyerPackage}
        lawyerNote={view.lawyerNote}
        onPrepare={prepareLawyerPackage}
      />
    </main>
  );
}

export default function CanvasHost() {
  return (
    <CopilotKit runtimeUrl="/api/copilotkit">
      <Canvas />
    </CopilotKit>
  );
}
