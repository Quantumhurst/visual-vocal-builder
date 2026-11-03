// Mission guidance for the space-game layer — pure, unit-testable.
// The banner always names the next required mission, how to do it by
// voice, and chips that send the same commands a spoken user would.
//
// The s.85 rollover and filing-steps cards are optional archive systems:
// they stay available in the systems rail and the quick commands, but
// they are not missions and never block the launch.

import { beatProgress, type Beat, type RequiredBeat } from "./beat-progress.ts";
import type { SharedState } from "./state.ts";

export type Mission = {
  beat: Beat | "complete";
  step: number;
  total: 4;
  title: string;
  prompt: string;
  chips: { label: string; command: string }[];
};

const ORDER: RequiredBeat[] = ["jurisdiction", "equity", "checklist", "summary"];

export function missionFor(state: SharedState): Mission {
  const { nextBeat } = beatProgress(state);
  const total = 4 as const;
  if (nextBeat === "complete") {
    const built = state.checklist.filter((item) => item.done).length;
    const structures = state.checklist.length;
    const founded = structures > 0 && built === structures;
    return {
      beat: "complete",
      step: 4,
      total,
      title: founded
        ? "Mission complete — colony founded"
        : `Mission complete — colony ${built}/${structures}`,
      prompt: founded
        ? "All four core missions are done and the colony is fully built. Say “Start over” for a new colony, or “Undo that” to rewind. The s.85 and filing cards remain in the archive if you want them."
        : `All four core missions are cleared, but the colony is only ${built}/${structures} built. Tick off the remaining structures, or say “Start over”.`,
      chips: founded
        ? [
            { label: "Undo that", command: "Undo that" },
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
      return { beat: nextBeat, step, total, title: "Pick your home base", prompt: "Say “Pick Mars”, “Pick Europa”, or ask “What's the cheapest place?”", chips: [
        { label: "Pick Mars", command: "Pick Mars as our home base" },
        { label: "Pick Europa", command: "Pick Europa as our home base" },
        { label: "Cheapest place?", command: "What's the cheapest place to incorporate?" },
      ] };
    case "equity":
      return { beat: nextBeat, step, total, title: `Split the equity on ${place}`, prompt: "Say “Make Orbit 70%”, choose 1–5 owners, or drag the sliders — the split always totals 100%.", chips: [
        { label: "Make Orbit 70%", command: "Make Orbit 70%" },
        { label: "Make Nova 70%", command: "Make Nova 70%" },
        { label: "Even 50/50", command: "Make Nova 50%" },
      ] };
    case "checklist": {
      const built = state.checklist.filter((item) => item.done).length;
      const structures = state.checklist.length;
      const prompt = built === 0
        ? `Say “Tick off the first two checklist items” — ${built}/${structures} structures are up. Each tick builds one.`
        : `Say “Tick next step” or “Finish the build” — ${built}/${structures} structures are up.`;
      return { beat: nextBeat, step, total, title: "Build the colony, step by step", prompt, chips: built === 0 ? [
        { label: "Tick first two", command: "Tick off the first two checklist items" },
        { label: "Next step", command: "Mark the next checklist step done" },
      ] : [
        { label: "Tick next step", command: "Mark the next checklist step done" },
        { label: "Finish the build", command: "Tick off every remaining checklist item" },
      ] };
    }
    case "summary":
      return { beat: nextBeat, step, total, title: "Launch the lawyer summary", prompt: "Say “Prepare the lawyer summary” and watch the rocket launch. Prep only — nothing is sent.", chips: [
        { label: "Prepare lawyer summary", command: "Prepare the lawyer summary" },
      ] };
  }
}
