"use client";

// The right rail: module tabs (four required missions plus the optional
// filing archive), the active system's panel, and the integrity scan.
// Presentation only; every control calls back into the same Canvas paths
// that voice uses.

import JurisdictionTable from "./JurisdictionTable";
import EquitySlider from "./EquitySlider";
import FilingChecklist from "./FilingChecklist";
import FilingSteps from "./FilingSteps";
import LawyerSummary from "./LawyerSummary";
import TrustStrip from "./TrustStrip";
import { DEMO_COMPANY_NAME } from "../lib/demo-data";
import type { Beat } from "../lib/beat-progress";
import { flightStatusLabel, type FlightStep, type ModuleMeta } from "../lib/game-ui";
import type { SharedState } from "../lib/state";
import type { CardVerdict, VerifyResult } from "../lib/verifier";

type Props = {
  view: SharedState;
  flight: FlightStep[];
  requiredModules: ModuleMeta[];
  archiveModules: ModuleMeta[];
  activeModule: Beat;
  activeMeta: ModuleMeta;
  activeStep: FlightStep;
  archiveOpen: boolean;
  setArchiveOpen: (open: boolean) => void;
  selectModule: (id: Beat) => void;
  handleSelectJurisdiction: (jurisdiction: string) => void;
  onShareChange: (index: number, percent: number) => void;
  updateOwnerCount: (count: number) => void;
  updateChecklistItem: (itemId: string, done: boolean) => void;
  onApproveName: () => void;
  onPrepareSummary: () => void;
  verification: VerifyResult;
  checklistFlags: Record<string, string>;
  filingFlag: CardVerdict | undefined;
};

export default function SystemsRail({
  view,
  flight,
  requiredModules,
  archiveModules,
  activeModule,
  activeMeta,
  activeStep,
  archiveOpen,
  setArchiveOpen,
  selectModule,
  handleSelectJurisdiction,
  onShareChange,
  updateOwnerCount,
  updateChecklistItem,
  onApproveName,
  onPrepareSummary,
  verification,
  checklistFlags,
  filingFlag,
}: Props) {
  return (
    <aside className="rail rail-systems" aria-label="Ship systems">
      <div className="systems-nav">
        <div className="module-tabs is-core" role="tablist" aria-label="Four required missions">
          {requiredModules.map((entry) => {
            const step = flight.find((item) => item.id === entry.id);
            return (
              <button
                key={entry.id}
                type="button"
                role="tab"
                aria-selected={activeModule === entry.id}
                className={`module-tab is-${step?.status ?? "pending"}`}
                onClick={() => selectModule(entry.id)}
                title={entry.blurb}
              >
                <span className="module-glyph" aria-hidden="true">
                  {entry.glyph}
                </span>
                <span className="module-label">{entry.short}</span>
                <span className="module-dot" aria-hidden="true" />
              </button>
            );
          })}
        </div>

        <details
          className="archive-tabs"
          data-testid="archive-tabs"
          open={archiveOpen}
          onToggle={(event) => setArchiveOpen(event.currentTarget.open)}
        >
          <summary>
            <span className="archive-title">ARCHIVE</span>
            <span className="archive-note">FILING FEES · OPTIONAL</span>
            <span className="integrity-chevron" aria-hidden="true">
              ⌄
            </span>
          </summary>
          <div className="module-tabs is-archive" role="tablist" aria-label="Optional archive systems">
            {archiveModules.map((entry) => {
              const step = flight.find((item) => item.id === entry.id);
              return (
                <button
                  key={entry.id}
                  type="button"
                  role="tab"
                  aria-selected={activeModule === entry.id}
                  className={`module-tab is-${step?.status ?? "pending"}`}
                  onClick={() => selectModule(entry.id)}
                  title={entry.blurb}
                >
                  <span className="module-glyph" aria-hidden="true">
                    {entry.glyph}
                  </span>
                  <span className="module-label">{entry.short}</span>
                  <span className="module-dot" aria-hidden="true" />
                </button>
              );
            })}
          </div>
        </details>
      </div>

      <div className="panel module-panel" data-active-module={activeModule}>
        <div className="module-head">
          <span className="eyebrow">
            SYSTEM {activeMeta.code} · {activeMeta.label.toUpperCase()}
          </span>
          <span className={`chip chip-${activeStep.status}`}>
            {flightStatusLabel(activeStep.status)}
          </span>
        </div>

        <div data-beat="jurisdiction" hidden={activeModule !== "jurisdiction"}>
          <JurisdictionTable
            rows={view.jurisdictions}
            selected={view.selectedJurisdiction}
            focus={view.focusJurisdiction}
            focusReason={view.focusReason}
            onSelect={handleSelectJurisdiction}
          />
        </div>

        <div data-beat="equity" hidden={activeModule !== "equity"}>
          <EquitySlider
            founders={view.founders}
            equityNote={view.equityNote}
            onShareChange={onShareChange}
            onOwnerCountChange={updateOwnerCount}
          />
        </div>

        <div data-beat="checklist" hidden={activeModule !== "checklist"}>
          <FilingChecklist
            items={view.checklist}
            onToggle={updateChecklistItem}
            flags={checklistFlags}
          />
        </div>

        <div data-beat="name" hidden={activeModule !== "name"}>
          <section className="panel module-card" aria-label="Company name approval">
            <span className="eyebrow">COMPANY NAME · DEMO</span>
            <h3 className="module-card-title">{view.companyName || DEMO_COMPANY_NAME}</h3>
            <p className="module-card-copy">
              {view.companyName
                ? "Approved by voice. This name appears in the lawyer summary."
                : "Say “Approve Galactic Bagels”, or “Call it” and a fictional name. The name is approved right after the home base, before equity."}
            </p>
            {!view.companyName ? (
              <button
                type="button"
                className="btn btn-primary"
                data-testid="rail-approve-name"
                onClick={onApproveName}
              >
                APPROVE GALACTIC BAGELS
              </button>
            ) : (
              <p className="module-card-ok" data-testid="name-approved">
                Approved: {view.companyName}
              </p>
            )}
          </section>
        </div>

        <div data-beat="filingsteps" hidden={activeModule !== "filingsteps"}>
          <FilingSteps
            card={view.filingStepsCard}
            filingStepsNote={view.filingStepsNote}
            flagReason={filingFlag ? `${filingFlag.reason}: ${filingFlag.detail}` : null}
          />
        </div>

        <div data-beat="summary" hidden={activeModule !== "summary"}>
          <LawyerSummary
            view={view}
            companyName={view.companyName || DEMO_COMPANY_NAME}
            lawyerPackage={view.lawyerPackage}
            lawyerNote={view.lawyerNote}
            onPrepare={onPrepareSummary}
          />
        </div>
      </div>

      <TrustStrip result={verification} />
    </aside>
  );
}
