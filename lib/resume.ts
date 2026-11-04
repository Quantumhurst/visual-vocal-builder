// Resume summary — pure, unit-testable.
//
// A resumed run should say where the founder is, not replay the whole
// transcript. One short spoken line: home base, company name, equity
// split, and build count. The full transcript is restored separately on
// screen.

import type { SharedState } from "./state.ts";

export function resumeSummary(state: SharedState): string {
  const home = (state.selectedJurisdiction ?? "").trim() || "home base not set";
  const name = (state.companyName ?? "").trim() || "company not named";
  const split = state.founders.map((founder) => `${founder.percent}%`).join("/") || "no crew";
  const built = state.checklist.filter((item) => item.done).length;
  const total = state.checklist.length;
  return `Welcome back. Home base ${home}, company ${name}, split ${split}, colony ${built}/${total} built.`;
}
