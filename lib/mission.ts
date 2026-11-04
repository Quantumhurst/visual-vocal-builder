// Mission guidance for the space-game layer — pure, unit-testable.
// The banner always names the next required mission and exactly one SAY
// cue. The glasses-agent rule: one clear next step per screen, never a
// wall of options. Alternate commands stay available by voice and inside
// the one collapsed plan disclosure, not in the primary prompt.
//
// Five required missions, in this order:
//   home base -> company name -> crew split (confirmed) -> 5/5 colony
//   -> launch the lawyer summary.
// The company name is approved immediately after the home base, before
// equity and the build. The s.85 lesson is not part of this run.
// The filing-steps/fees card is the only optional archive system.

import { beatProgress, type Beat, type RequiredBeat } from "./beat-progress.ts";
import type { SharedState } from "./state.ts";

export type Mission = {
  beat: Beat | "complete";
  step: number;
  total: 5;
  title: string;
  prompt: string;
  // The one phrase the screen asks the user to say. The host speaks the
  // same instruction, so screen and voice always agree.
  voiceCue: string;
  // Exactly one fallback chip. The plan disclosure may hold it, but the
  // primary card never presents a menu.
  chips: { label: string; command: string }[];
};

const ORDER: RequiredBeat[] = [
  "jurisdiction",
  "name",
  "equity",
  "checklist",
  "summary",
];

export function missionFor(state: SharedState): Mission {
  const { nextBeat } = beatProgress(state);
  const total = 5 as const;
  if (nextBeat === "complete") {
    const built = state.checklist.filter((item) => item.done).length;
    const structures = state.checklist.length;
    const founded = structures > 0 && built === structures;
    return {
      beat: "complete",
      step: 5,
      total,
      title: founded
        ? "Mission complete — colony founded"
        : `Mission complete — colony ${built}/${structures}`,
      prompt: founded
        ? "All five missions are done. The summary is prepared, nothing was filed, and nothing was sent."
        : `All five missions are cleared, but the colony is only ${built}/${structures} built.`,
      voiceCue: founded ? "Show transcript" : "Yes",
      chips: founded
        ? [{ label: "Show transcript", command: "Show transcript" }]
        : [{ label: "Raise next structure", command: "Yes" }],
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
        prompt: "Choose one fictional place. The host and the canvas follow whatever you say.",
        voiceCue: "Pick Mars",
        chips: [{ label: "Pick Mars", command: "Pick Mars as our home base" }],
      };
    case "name":
      return {
        beat: nextBeat,
        step,
        total,
        title: "Name the company",
        prompt: "What should the fictional company be called? Say the prepared name.",
        voiceCue: "Approve Galactic Bagels",
        chips: [{ label: "Approve Galactic Bagels", command: "Approve Galactic Bagels" }],
      };
    case "equity":
      return {
        beat: nextBeat,
        step,
        total,
        title: `Split the equity on ${place}`,
        prompt: "Set who owns what. The split always totals 100%, then you confirm it on the card.",
        voiceCue: "Make Orbit 70%",
        chips: [{ label: "Make Orbit 70%", command: "Make Orbit 70%" }],
      };
    case "checklist": {
      const built = state.checklist.filter((item) => item.done).length;
      const structures = state.checklist.length;
      const next = state.checklist.find((item) => !item.done);
      return {
        beat: nextBeat,
        step,
        total,
        title: "Build the colony, one structure at a time",
        prompt: `Structure ${built + 1} of ${structures}: ${next?.label ?? "next structure"}. One yes raises exactly this one.`,
        voiceCue: "Yes",
        chips: [
          {
            label: `Raise the ${next?.label.toLowerCase() ?? "next structure"}`,
            command: "Yes",
          },
        ],
      };
    }
    case "summary":
      return {
        beat: nextBeat,
        step,
        total,
        title: "Launch the lawyer summary",
        prompt: "Prepare the lawyer summary. Prep only — nothing is sent and nothing is filed.",
        voiceCue: "Prepare the lawyer summary",
        chips: [{ label: "Prepare lawyer summary", command: "Prepare the lawyer summary" }],
      };
  }
}
