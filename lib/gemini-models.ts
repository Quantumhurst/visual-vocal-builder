// Gemini model configuration and live tool schemas.
//
// Audit:
// - Brain: gemini-2.5-flash for CopilotKit agentic tool loop and fast reasoning.
// - Live Multimodal: models/gemini-3.8-live via WebSockets (BidiGenerateContent)
//   for bidirectional real-time audio in, natural voice audio out, and native tool calling.
// - Voice: Aoede (warm, clear, mission-grade speech output).

import { AGENT_ACTIONS } from "./agent-actions.ts";

export const BRAIN_MODEL = "gemini-2.5-flash";
export const LIVE_MODEL = "models/gemini-3.8-live";
export const VOICE_NAME = "Aoede";

export const GEMINI_KEYWORDS = [
  "Mars",
  "Europa",
  "Andromeda Galaxy",
  "Galactic Bagels",
  "Nova",
  "Orbit",
  "Vega",
  "Lyra",
  "Orion",
  "Altair",
  "Rigel",
  "owners",
  "founders",
  "one owner",
  "two owners",
  "three owners",
  "four owners",
  "five owners",
  "three people",
  "four people",
  "five people",
  "confirm",
  "confirm split",
  "confirm this split",
  "confirm the split",
  "the split",
  "change",
  "tick next step",
  "finish the build",
  "zero",
  "none of them",
  "start over",
  "undo",
  "cheapest",
  "filing steps",
  "lawyer summary",
] as const;

export const GEMINI_FUNCTION_DECLARATIONS = [
  {
    name: AGENT_ACTIONS.showJurisdictionComparison,
    description:
      "Show the fictional jurisdiction comparison table and optionally select one of the fictional places (Mars, Europa, Andromeda Galaxy). Call this when the user asks to compare jurisdictions, choose a place to incorporate, or start incorporating the fictional company.",
    parameters: {
      type: "OBJECT",
      properties: {
        jurisdiction: {
          type: "STRING",
          description: "Name of the fictional place the user picked, if they named one.",
        },
      },
    },
  },
  {
    name: AGENT_ACTIONS.setFounderEquity,
    description:
      "Set one DEMO owner's equity percent (e.g. the user says 'make me 70%'). The other owner(s) auto-adjust so the split always totals 100%.",
    parameters: {
      type: "OBJECT",
      properties: {
        founder: {
          type: "STRING",
          description: "Founder name, or 'me' for the first founder.",
        },
        percent: {
          type: "NUMBER",
          description: "Target percent for that founder, 0-100.",
        },
      },
      required: ["founder", "percent"],
    },
  },
  {
    name: AGENT_ACTIONS.setOwnerCount,
    description:
      "Set the number of fictional company owners (1-5). Shrinking the team redistributes the removed share; growing adds owners at 0%; the equity split always totals 100%.",
    parameters: {
      type: "OBJECT",
      properties: {
        count: {
          type: "NUMBER",
          description: "Number of owners, 1 to 5.",
        },
      },
      required: ["count"],
    },
  },
  {
    name: AGENT_ACTIONS.setChecklistItem,
    description:
      "Check or uncheck one filing-checklist item by its id (habitat-dome, solar-array, hydro-farm, comms-relay, launch-pad).",
    parameters: {
      type: "OBJECT",
      properties: {
        itemId: {
          type: "STRING",
          description: "Checklist item id.",
        },
        done: {
          type: "BOOLEAN",
          description: "True to check, false to uncheck.",
        },
      },
      required: ["itemId", "done"],
    },
  },
  {
    name: AGENT_ACTIONS.setChecklistItems,
    description:
      "Check or uncheck several filing-checklist items at once by their ids.",
    parameters: {
      type: "OBJECT",
      properties: {
        itemIds: {
          type: "ARRAY",
          items: { type: "STRING" },
          description: "Checklist item ids.",
        },
        done: {
          type: "BOOLEAN",
          description: "True to check, false to uncheck.",
        },
      },
      required: ["itemIds", "done"],
    },
  },
  {
    name: AGENT_ACTIONS.advanceChecklist,
    description:
      "Mark the first not-yet-done filing-checklist item done and move the walk forward.",
    parameters: {
      type: "OBJECT",
      properties: {},
    },
  },
  {
    name: AGENT_ACTIONS.approveCompanyName,
    description:
      "Approve the prepared fictional company name (Galactic Bagels Inc.) or a proposed fictional company name.",
    parameters: {
      type: "OBJECT",
      properties: {
        name: {
          type: "STRING",
          description: "Approved company name.",
        },
      },
    },
  },
  {
    name: AGENT_ACTIONS.showFilingSteps,
    description:
      "Show grounded filing steps and fees facts. Never invent steps or fees; only pack facts become cards.",
    parameters: {
      type: "OBJECT",
      properties: {
        factIds: {
          type: "ARRAY",
          items: { type: "STRING" },
          description: "Fact ids from the filingStepsFacts index.",
        },
        question: {
          type: "STRING",
          description: "The user's question.",
        },
      },
      required: ["factIds"],
    },
  },
  {
    name: AGENT_ACTIONS.prepareLawyerSummary,
    description:
      "Prepare the lawyer-summary package (jurisdiction choice, equity split, checklist state) and display it on the canvas.",
    parameters: {
      type: "OBJECT",
      properties: {},
    },
  },
  {
    name: AGENT_ACTIONS.undoLastChange,
    description:
      "Reverse the last canvas change (voice, slider, or click). Call when the user says undo that, revert, or go back.",
    parameters: {
      type: "OBJECT",
      properties: {},
    },
  },
  {
    name: AGENT_ACTIONS.startOver,
    description:
      "Reset the canvas only (selection, equity, checklist, cards, lawyer package) and keep the chat history.",
    parameters: {
      type: "OBJECT",
      properties: {},
    },
  },
  {
    name: AGENT_ACTIONS.compareJurisdictions,
    description:
      "Answer a comparison question about the three fictional places (Mars, Europa, Andromeda Galaxy) from the DEMO rows.",
    parameters: {
      type: "OBJECT",
      properties: {
        question: {
          type: "STRING",
          description: "The user's comparison question.",
        },
        focus: {
          type: "STRING",
          description: "Fictional place to DEMO-highlight.",
        },
      },
    },
  },
];

export function buildGeminiLiveSetup(systemPrompt?: string) {
  return {
    setup: {
      model: LIVE_MODEL,
      generationConfig: {
        responseModalities: ["AUDIO"],
        speechConfig: {
          voiceConfig: {
            prebuiltVoiceConfig: {
              voiceName: VOICE_NAME,
            },
          },
        },
      },
      ...(systemPrompt
        ? {
            systemInstruction: {
              parts: [{ text: systemPrompt }],
            },
          }
        : {}),
      tools: [
        {
          functionDeclarations: GEMINI_FUNCTION_DECLARATIONS,
        },
      ],
    },
  };
}

