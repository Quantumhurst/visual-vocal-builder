// Day 5 verifier — a pure, synchronous check of the painted grounded
// cards against the knowledge packs in lib/knowledge.ts.
//
// The talking agent never grades its own work: this check runs against
// the packs (via findFact), never against the agent's own claims, and
// it cannot approve its own output — it only reports grounded/flagged.
// It invents no facts: an unresolvable card is flagged, never filled in.
// It has no I/O, no model calls, and no network, so it adds zero
// conversation latency — it runs on state change, outside the voice
// turn path.
//
// DEMO demo-data (jurisdiction rows / hero planets, lib/demo-data.ts)
// is its own class: shown as DEMO, never as ungrounded, never flagged.

import { CHECKLIST_PACK, KNOWLEDGE_PACKS, findFact } from "./knowledge.ts";
import type {
  ChecklistItem,
  FilingStepsCard,
  JurisdictionRow,
  RolloverCard,
} from "./state";

export type FlagReason = "pack missing" | "fact missing" | "text differs";

export type CardVerdict = {
  cardKind: "rollover" | "filingSteps" | "checklist";
  cardId: string;
  label: string;
  // The four trust-strip states, per painted card. grounded and flagged
  // are the two mutually exclusive outcomes of the check.
  emitted: true;
  rendered: true;
  status: "grounded" | "flagged";
  reason: FlagReason | null;
  detail: string;
};

export type DemoVerdict = {
  jurisdiction: string;
  status: "DEMO";
};

export type VerifyResult = {
  verdicts: CardVerdict[];
  demoItems: DemoVerdict[];
  counts: {
    emitted: number;
    rendered: number;
    grounded: number;
    flagged: number;
    demo: number;
  };
};

export type PaintedCards = {
  rolloverCard: RolloverCard;
  filingStepsCard: FilingStepsCard;
  checklist: ChecklistItem[];
  jurisdictions?: JurisdictionRow[];
};

function packExists(packId: string): boolean {
  return KNOWLEDGE_PACKS.some((pack) => pack.packId === packId);
}

function verifyRollover(card: NonNullable<RolloverCard>): CardVerdict {
  const base = {
    cardKind: "rollover" as const,
    cardId: card.factId,
    label: `s.85 rollover fact card (${card.factId})`,
    emitted: true as const,
    rendered: true as const,
  };
  if (!packExists(card.packId)) {
    return {
      ...base,
      status: "flagged",
      reason: "pack missing",
      detail: `Pack ${card.packId} does not resolve in the knowledge packs.`,
    };
  }
  const found = findFact(card.packId, card.factId);
  if (!found) {
    return {
      ...base,
      status: "flagged",
      reason: "fact missing",
      detail: `Fact ${card.factId} does not resolve in pack ${card.packId}.`,
    };
  }
  if (card.answer !== found.fact.text) {
    return {
      ...base,
      status: "flagged",
      reason: "text differs",
      detail: `Card text for ${card.factId} differs from the pack fact text.`,
    };
  }
  return {
    ...base,
    status: "grounded",
    reason: null,
    detail: `Pack ${card.packId} / fact ${card.factId} resolve and text matches verbatim.`,
  };
}

function verifyFilingSteps(
  card: NonNullable<FilingStepsCard>,
): CardVerdict {
  const base = {
    cardKind: "filingSteps" as const,
    cardId: card.packId,
    label: `Filing steps & fees card (${card.packId})`,
    emitted: true as const,
    rendered: true as const,
  };
  if (!packExists(card.packId)) {
    return {
      ...base,
      status: "flagged",
      reason: "pack missing",
      detail: `Pack ${card.packId} does not resolve in the knowledge packs.`,
    };
  }
  for (const fact of card.facts) {
    const found = findFact(card.packId, fact.factId);
    if (!found) {
      return {
        ...base,
        status: "flagged",
        reason: "fact missing",
        detail: `Fact ${fact.factId} does not resolve in pack ${card.packId}.`,
      };
    }
    if (fact.text !== found.fact.text) {
      return {
        ...base,
        status: "flagged",
        reason: "text differs",
        detail: `Card text for ${fact.factId} differs from the pack fact text.`,
      };
    }
  }
  return {
    ...base,
    status: "grounded",
    reason: null,
    detail: `Pack ${card.packId} resolves and all ${card.facts.length} fact(s) match verbatim.`,
  };
}

function verifyChecklistItem(item: ChecklistItem): CardVerdict {
  const base = {
    cardKind: "checklist" as const,
    cardId: item.id,
    label: `Checklist: ${item.label} (${item.id})`,
    emitted: true as const,
    rendered: true as const,
  };
  const found = findFact(CHECKLIST_PACK.packId, item.id);
  if (!found) {
    return {
      ...base,
      status: "flagged",
      reason: "fact missing",
      detail: `Checklist id ${item.id} does not resolve to a fact in pack ${CHECKLIST_PACK.packId}.`,
    };
  }
  if (item.guidance !== found.fact.text) {
    return {
      ...base,
      status: "flagged",
      reason: "text differs",
      detail: `Guidance for ${item.id} differs from the pack fact text.`,
    };
  }
  return {
    ...base,
    status: "grounded",
    reason: null,
    detail: `Checklist id ${item.id} resolves in pack ${CHECKLIST_PACK.packId} and guidance matches verbatim.`,
  };
}

// Pure and synchronous: same painted cards in, same verdicts out.
export function verifyPaintedCards(painted: PaintedCards): VerifyResult {
  const verdicts: CardVerdict[] = [];
  if (painted.rolloverCard) verdicts.push(verifyRollover(painted.rolloverCard));
  if (painted.filingStepsCard) {
    verdicts.push(verifyFilingSteps(painted.filingStepsCard));
  }
  for (const item of painted.checklist ?? []) {
    verdicts.push(verifyChecklistItem(item));
  }
  const demoItems: DemoVerdict[] = (painted.jurisdictions ?? []).map(
    (row) => ({ jurisdiction: row.jurisdiction, status: "DEMO" as const }),
  );
  const grounded = verdicts.filter((v) => v.status === "grounded").length;
  return {
    verdicts,
    demoItems,
    counts: {
      emitted: verdicts.length,
      rendered: verdicts.length,
      grounded,
      flagged: verdicts.length - grounded,
      demo: demoItems.length,
    },
  };
}
