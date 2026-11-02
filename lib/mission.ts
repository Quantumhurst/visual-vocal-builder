// Mission guidance for the space-game layer — pure, unit-testable.
// The banner always names the next incomplete beat, how to do it by
// voice, and chips that send the same commands a spoken user would.

import { beatProgress, type Beat } from "./beat-progress.ts";
import type { SharedState } from "./state.ts";

export type Mission = {
  beat: Beat | "complete";
  step: number;
  total: 6;
  title: string;
  prompt: string;
  chips: { label: string; command: string }[];
};

const ORDER: Beat[] = ["jurisdiction", "equity", "checklist", "rollover", "filingsteps", "summary"];

export function missionFor(state: SharedState): Mission {
  const { nextBeat } = beatProgress(state);
  const total = 6 as const;
  if (nextBeat === "complete") {
    return {
      beat: "complete",
      step: 6,
      total,
      title: "Mission complete — colony founded",
      prompt: "All six missions are done. Say “Start over” for a new colony, or “Undo that” to rewind.",
      chips: [
        { label: "Undo that", command: "Undo that" },
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
      return { beat: nextBeat, step, total, title: `Split the equity on ${place}`, prompt: "Say “Make Orbit 70%” or drag the sliders — the split always totals 100%.", chips: [
        { label: "Make Orbit 70%", command: "Make Orbit 70%" },
        { label: "Make Nova 70%", command: "Make Nova 70%" },
        { label: "Even 50/50", command: "Make Nova 50%" },
      ] };
    case "checklist":
      return { beat: nextBeat, step, total, title: "Build the colony, step by step", prompt: "Say “Tick off the first two checklist items” — each tick builds a structure.", chips: [
        { label: "Tick first two", command: "Tick off the first two checklist items" },
        { label: "Next step", command: "Mark the next checklist step done" },
      ] };
    case "rollover":
      return { beat: nextBeat, step, total, title: "Ask about the s.85 rollover", prompt: "Say “What is a section 85 rollover?” for the grounded fact card.", chips: [
        { label: "s.85 rollover?", command: "What is a section 85 rollover?" },
      ] };
    case "filingsteps":
      return { beat: nextBeat, step, total, title: "Walk the filing steps & fees", prompt: "Say “What are the filing steps and fees?” — answers come only from the grounded pack.", chips: [
        { label: "Filing steps & fees", command: "What are the filing steps and fees?" },
      ] };
    case "summary":
      return { beat: nextBeat, step, total, title: "Launch the lawyer summary", prompt: "Say “Prepare the lawyer summary” and watch the rocket launch. Prep only — nothing is sent.", chips: [
        { label: "Prepare lawyer summary", command: "Prepare the lawyer summary" },
      ] };
  }
}
