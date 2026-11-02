import { DEMO_CHECKLIST, DEMO_COMPANY_NAME, DEMO_FOUNDERS, DEMO_JURISDICTIONS } from "./demo-data.ts";
import { setFounderShare } from "./equity.ts";
import type { FounderShare } from "./equity.ts";
import { FILING_STEPS_PACK, findFact, findFactById } from "./knowledge.ts";
import { buildLawyerSummary } from "./lawyer-summary.ts";
import type { JurisdictionRow, SharedState } from "./state.ts";

export const INITIAL_STATE: SharedState = {
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
  focusJurisdiction: null,
  focusReason: "",
};

export function withDefaults(s: Partial<SharedState> | null | undefined): SharedState {
  if (!s) return { ...INITIAL_STATE };
  return { ...INITIAL_STATE, ...s };
}

export function resolveFounderIndex(founders: FounderShare[], who: string): number {
  const wanted = (who ?? "").trim().toLowerCase();
  if (wanted === "" || wanted === "me" || wanted === "i") return founders.length ? 0 : -1;
  return founders.findIndex((f) => f.name.toLowerCase().includes(wanted));
}

export function applyEquity(state: SharedState, index: number, percent: number, via: string): SharedState {
  const founders = setFounderShare(state.founders, index, percent);
  const changed = founders[index];
  return {
    ...state,
    currentBeat: "equity",
    founders,
    equityNote: changed ? `${changed.name} set to ${changed.percent}% (${via}); other founder(s) adjusted so the split totals 100%.` : state.equityNote,
  };
}

export function applyChecklistItem(state: SharedState, itemId: string, done: boolean): SharedState {
  return {
    ...state,
    currentBeat: "checklist",
    checklist: state.checklist.map((item) => (item.id === itemId ? { ...item, done } : item)),
  };
}

export function applyAdvanceChecklist(state: SharedState): SharedState {
  const next = state.checklist.find((item) => !item.done);
  if (!next) return state;
  return applyChecklistItem(state, next.id, true);
}

export function applyJurisdiction(state: SharedState, jurisdiction?: string | null): SharedState {
  const match = DEMO_JURISDICTIONS.find((row) => jurisdiction && row.jurisdiction.toLowerCase() === jurisdiction.toLowerCase());
  return {
    ...state,
    currentBeat: "jurisdiction",
    jurisdictions: DEMO_JURISDICTIONS,
    selectedJurisdiction: match ? match.jurisdiction : state.selectedJurisdiction,
  };
}

export function applyRolloverFact(state: SharedState, factId: string, question?: string): SharedState {
  const found = findFactById(factId ?? "");
  if (!found) {
    return {
      ...state,
      currentBeat: "rollover",
      rolloverCard: null,
      rolloverNote: "No grounded fact matched that request in the knowledge pack, so no fact card is shown. An ungrounded answer would fail this beat.",
    };
  }
  return {
    ...state,
    currentBeat: "rollover",
    rolloverCard: {
      question: question ?? "Rollover question",
      answer: found.fact.text,
      packId: found.pack.packId,
      factId: found.fact.factId,
      packTitle: found.pack.title,
    },
    rolloverNote: "",
  };
}

export function applyFilingSteps(state: SharedState, factIds: string[], question?: string): SharedState {
  const ids = Array.isArray(factIds) ? factIds : [];
  const found = ids.map((id) => findFact(FILING_STEPS_PACK.packId, String(id))).filter((e) => e !== null);
  if (found.length === 0) {
    return {
      ...state,
      currentBeat: "filingsteps",
      filingStepsCard: null,
      filingStepsNote: "No grounded fact matched that request in the filing-steps pack, so no card is shown. An ungrounded answer would fail this component.",
    };
  }
  return {
    ...state,
    currentBeat: "filingsteps",
    filingStepsCard: {
      question: question ?? "Filing steps and fees",
      packId: FILING_STEPS_PACK.packId,
      packTitle: FILING_STEPS_PACK.title,
      facts: found.map((entry) => ({ factId: entry.fact.factId, topic: entry.fact.topic, text: entry.fact.text })),
    },
    filingStepsNote: "",
  };
}

export function applyChecklistItems(state: SharedState, itemIds: string[], done: boolean): SharedState {
  const ids = new Set((Array.isArray(itemIds) ? itemIds : []).map(String));
  return {
    ...state,
    currentBeat: "checklist",
    checklist: state.checklist.map((item) => (ids.has(item.id) ? { ...item, done } : item)),
  };
}

export function applyFocusJurisdiction(state: SharedState, name: string | null, reason: string): SharedState {
  // DEMO highlight only — never touches selectedJurisdiction.
  const match = name
    ? DEMO_JURISDICTIONS.find((row) => row.jurisdiction.toLowerCase() === name.toLowerCase())
    : undefined;
  return {
    ...state,
    focusJurisdiction: match ? match.jurisdiction : null,
    focusReason: match ? reason : "",
  };
}

export function applyStartOver(state: SharedState): SharedState {
  // Canvas only (selection, equity, checklist, cards, lawyer package);
  // chat history lives outside SharedState, and the transcript line is kept.
  return { ...INITIAL_STATE, transcript: state.transcript };
}

export function cheapestByNumber(rows: JurisdictionRow[]): {
  name: string;
  fee: string;
  sameCurrency: boolean;
} {
  let best: { name: string; fee: string; value: number } | null = null;
  const currencies = new Set<string>();
  for (const row of rows) {
    const m = row.filingFee.match(/([\d.]+)\s*(million)?/i);
    const value = m ? parseFloat(m[1]) * (m[2] ? 1_000_000 : 1) : Number.POSITIVE_INFINITY;
    const currency = row.filingFee
      .replace(/^DEMO\s+/i, "")
      .replace(/^[\d.]+\s*(million\s+)?/i, "")
      .trim()
      .toLowerCase();
    if (currency) currencies.add(currency);
    if (!best || value < best.value) best = { name: row.jurisdiction, fee: row.filingFee, value };
  }
  return {
    name: best?.name ?? "",
    fee: best?.fee ?? "",
    sameCurrency: currencies.size <= 1,
  };
}

export function applyLawyerSummary(state: SharedState): SharedState {
  return {
    ...state,
    currentBeat: "summary",
    lawyerPackage: buildLawyerSummary(state, DEMO_COMPANY_NAME),
    lawyerNote: "Summary prepared. Copy or download it and forward it yourself — this app does not send email.",
  };
}
