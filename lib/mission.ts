// Mission guidance for the space-game layer — pure, unit-testable.
// The banner always names the next required mission, the exact words to
// say, and chips that send the same commands a spoken user would.
//
// Six required missions, in this order:
//   home base -> crew split (confirmed) -> 5/5 colony -> approve name
//   -> learn the grounded s.85 fact -> launch the lawyer summary.
// The filing-steps/fees card is the only optional archive system.

import { beatProgress, type Beat, type RequiredBeat } from "./beat-progress.ts";
import { DEMO_COMPANY_NAME } from "./demo-data.ts";
import type { SharedState } from "./state.ts";

export type Mission = {
  beat: Beat | "complete";
  step: number;
  total: 6;
  title: string;
  prompt: string;
  // The one phrase the screen asks the user to say. The host speaks the
  // same instruction, so screen and voice always agree.
  voiceCue: string;
  chips: { label: string; command: string }[];
};

const ORDER: RequiredBeat[] = [
  "jurisdiction",
  "equity",
  "checklist",
  "name",
  "rollover",
  "summary",
];

export function missionFor(state: SharedState): Mission {
  const { nextBeat } = beatProgress(state);
  const total = 6 as const;
  if (nextBeat === "complete") {
    const built = state.checklist.filter((item) => item.done).length;
    const structures = state.checklist.length;
    const founded = structures > 0 && built === structures;
    return {
      beat: "complete",
      step: 6,
      total,
      title: founded
        ? "Mission complete — colony founded"
        : `Mission complete — colony ${built}/${structures}`,
      prompt: founded
        ? "All six missions are done. The summary is prepared, nothing was filed, and nothing was sent. Say “Start over” for a new colony, or “Show transcript” to review the whole run."
        : `All six missions are cleared, but the colony is only ${built}/${structures} built. Tick off the remaining structures, or say “Start over”.`,
      voiceCue: founded ? "Show transcript" : "Finish the build",
      chips: founded
        ? [
            { label: "Show transcript", command: "Show transcript" },
            { label: "Start over", command: "Start over" },
          ]
        : [
            { label: "Finish the build", command: "Tick off every remaining checklist item" },
            { label: "Start over", command: "Start over" },
          ],
    };
  }
  const step = ORDER.indexOf(nextBeat) + 1;
  const place = state.selectedJurisdiction ?? "your home base";
  switch (nextBeat) {
    case "jurisdiction":
      return {
        beat: nextBeat,
        step,
        total,
        title: "Pick your home base",
        prompt: "Say “Pick Mars”, “Pick Europa”, or ask “What's the cheapest place?”",
        voiceCue: "Pick Mars",
        chips: [
          { label: "Pick Mars", command: "Pick Mars as our home base" },
          { label: "Pick Europa", command: "Pick Europa as our home base" },
          { label: "Cheapest place?", command: "What's the cheapest place to incorporate?" },
        ],
      };
    case "equity":
      return {
        beat: nextBeat,
        step,
        total,
        title: `Split the equity on ${place}`,
        prompt: "Say “70/30”, “Make Orbit 70%”, choose 1–5 owners, or drag the sliders — the split always totals 100%. Then say “confirm”.",
        voiceCue: "Make Orbit 70%",
        chips: [
          { label: "Make Orbit 70%", command: "Make Orbit 70%" },
          { label: "Make Nova 70%", command: "Make Nova 70%" },
          { label: "Even 50/50", command: "Make Nova 50%" },
        ],
      };
    case "checklist": {
      const built = state.checklist.filter((item) => item.done).length;
      const structures = state.checklist.length;
      return {
        beat: nextBeat,
        step,
        total,
        title: "Build the colony, step by step",
        prompt: built === 0
          ? `Say “Build the next structure” or “Build all five” — ${built}/${structures} structures are up.`
          : `Say “Build the next structure” or “Finish the build” — ${built}/${structures} structures are up.`,
        voiceCue: built === 0 ? "Build the next structure" : "Finish the build",
        chips: built === 0
          ? [
              { label: "Build next structure", command: "Build the next structure" },
              { label: "Build all five", command: "Build all five structures" },
            ]
          : [
              { label: "Build next structure", command: "Build the next structure" },
              { label: "Finish the build", command: "Finish the build" },
            ],
      };
    }
    case "name":
      return {
        beat: nextBeat,
        step,
        total,
        title: "Approve the company name",
        prompt: `The colony is 5/5. Approve the fictional name ${DEMO_COMPANY_NAME}, or say “Call it <your name>”.`,
        voiceCue: "Approve Galactic Bagels",
        chips: [
          { label: "Approve Galactic Bagels", command: "Approve Galactic Bagels" },
          { label: "Call it Cosmic Donuts", command: "Call it Cosmic Donuts" },
        ],
      };
    case "rollover":
      return {
        beat: nextBeat,
        step,
        total,
        title: "Learn the s.85 rollover",
        prompt: "Say “Explain section 85” and I'll show the grounded rollover fact — pack id and fact id on the card. Never a guess.",
        voiceCue: "Explain section 85",
        chips: [
          { label: "Explain section 85", command: "Explain section 85" },
          { label: "Eligible property?", command: "What property is eligible for a section 85 rollover?" },
        ],
      };
    case "summary":
      return {
        beat: nextBeat,
        step,
        total,
        title: "Launch the lawyer summary",
        prompt: "Say “Prepare the lawyer summary” and watch the rocket launch. Prep only — nothing is sent, nothing is filed.",
        voiceCue: "Prepare the lawyer summary",
        chips: [
          { label: "Prepare lawyer summary", command: "Prepare the lawyer summary" },
        ],
      };
  }
}
