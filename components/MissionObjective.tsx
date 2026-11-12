"use client";

// The left-rail objective card: the one current mission, its single SAY
// cue, and (behind a disclosure) the flight plan and quick-action chips.
// While an owner/equity change waits for confirmation, the card becomes
// the confirm-split prompt. Presentation only: every button calls back
// into the same Canvas paths that voice uses.

import BuildQueuePanel from "./BuildQueuePanel";
import { DEMO_COMPANY_NAME } from "../lib/demo-data";
import type { Beat } from "../lib/beat-progress";
import { flightStatusLabel, type FlightStep } from "../lib/game-ui";
import type { Mission } from "../lib/mission";
import type { ChecklistItem } from "../lib/state";

type Props = {
  equityConfirm: boolean;
  ownerCount: number;
  equityLabel: string;
  mission: Mission;
  celebrated: string;
  doneCount: number;
  requiredTotal: number;
  checklist: ChecklistItem[];
  structures: { built: number; total: number; percent: number };
  nextChecklistId: string | null;
  canSend: boolean;
  requiredFlight: FlightStep[];
  archiveFlight: FlightStep[];
  activeModule: Beat;
  selectModule: (id: Beat) => void;
  confirmEquitySelection: () => void;
  updateChecklistItem: (itemId: string, done: boolean) => void;
  onApproveName: () => void;
  // Chips go through the agent path, exactly as if the command were said.
  onChipCommand: (command: string) => void;
};

export default function MissionObjective({
  equityConfirm,
  ownerCount,
  equityLabel,
  mission,
  celebrated,
  doneCount,
  requiredTotal,
  checklist,
  structures,
  nextChecklistId,
  canSend,
  requiredFlight,
  archiveFlight,
  activeModule,
  selectModule,
  confirmEquitySelection,
  updateChecklistItem,
  onApproveName,
  onChipCommand,
}: Props) {
  return equityConfirm ? (
    <section
      className="panel objective objective-confirm"
      data-testid="mission-banner"
      data-equity-confirm="true"
      data-beat="equity"
      data-celebrated="false"
    >
      <div className="objective-head">
        <span className="eyebrow">CONFIRM CREW SPLIT</span>
        <span className="objective-step">3/5</span>
      </div>
      <h2>
        {ownerCount} owner{ownerCount === 1 ? "" : "s"} — {equityLabel}
      </h2>
      <p className="objective-prompt" data-testid="mission-prompt">
        Does this split look right? One step: confirm it.
      </p>
      <p className="objective-say" data-testid="next-step">
        <span>SAY</span> <q>Confirm</q>
      </p>
      <div className="confirm-actions" data-testid="equity-confirm">
        <button
          type="button"
          className="btn btn-primary"
          data-testid="confirm-equity"
          onClick={confirmEquitySelection}
        >
          CONFIRM SPLIT
        </button>
        <button
          type="button"
          className="btn"
          data-testid="edit-equity"
          onClick={() => selectModule("equity")}
        >
          KEEP EDITING
        </button>
      </div>
      <p className="objective-build-hint">The split already totals 100%. KEEP EDITING is the only alternative.</p>
    </section>
  ) : (
  <section
    className="panel objective"
    data-testid="mission-banner"
    data-beat={mission.beat}
    data-celebrated={celebrated ? "true" : "false"}
  >
    <div className="objective-head">
      <span className="eyebrow">CURRENT OBJECTIVE</span>
      <span className="objective-step">
        {mission.step}/{mission.total}
      </span>
    </div>
    <h2>{mission.title}</h2>
    <p data-testid="mission-prompt" className="objective-prompt">
      {mission.prompt}
    </p>
    <p className="objective-say" data-testid="next-step">
      <span>SAY</span> <q>{mission.voiceCue}</q>
    </p>
    <div className="objective-meter" aria-hidden="true">
      <span style={{ width: `${Math.round((doneCount / requiredTotal) * 100)}%` }} />
    </div>

    {/* The build mission is the one required task where the user
        has to choose among five steps. Keep the five options and
        the running 0/5..5/5 count in the left rail, not only in
        the systems panel, so the spoken question has visible
        answers. Clicks use the same updateChecklistItem path. */}
    {mission.beat === "checklist" ? (
      <BuildQueuePanel
        items={checklist}
        built={structures.built}
        total={structures.total}
        percent={structures.percent}
        nextItemId={nextChecklistId}
        onToggle={updateChecklistItem}
      />
    ) : null}

    {mission.beat === "name" ? (
      <div className="name-approval" data-testid="name-approval-card">
        <span className="eyebrow">PROPOSED COMPANY NAME</span>
        <strong className="name-approval-name">{DEMO_COMPANY_NAME}</strong>
        <p className="name-approval-why">
          This is the one spoken approval that names the company, before equity and the
          build. It feeds the lawyer summary. Fictional demo only.
        </p>
        <div className="confirm-actions">
          <button
            type="button"
            className="btn btn-primary"
            data-testid="approve-name-button"
            onClick={onApproveName}
          >
            APPROVE NAME
          </button>
        </div>
        <p className="objective-build-hint">Or say “Approve Galactic Bagels” / “Call it &lt;name&gt;”.</p>
      </div>
    ) : null}

    {celebrated ? (
      <p data-testid="mission-celebrated" className="celebrate">
        {celebrated}
      </p>
    ) : null}

    {/* The five required missions are the only steps in the open.
        The detailed flight plan, its optional archive rows, and the
        mission chips live behind one disclosure. */}
    <details className="objective-more">
      <summary>
        <span className="eyebrow">PLAN &amp; QUICK ACTIONS</span>
        <span className="panel-note">
          {doneCount}/{requiredTotal} CLEARED
        </span>
      </summary>
      <div className="objective-more-body">
        <div className="chip-row">
          {mission.chips.map((chip) => (
            <button
              key={chip.label}
              type="button"
              className="chip-btn"
              data-testid="mission-chip"
              data-label={chip.label}
              disabled={!canSend}
              onClick={() => onChipCommand(chip.command)}
            >
              {chip.label}
            </button>
          ))}
        </div>
        <ol className="flight-list flight-list-compact" aria-label="Required mission flight plan">
          {requiredFlight.map((step) => (
            <li key={step.id} className={`flight-item is-${step.status}`}>
              <button
                type="button"
                onClick={() => selectModule(step.id)}
                aria-pressed={activeModule === step.id}
                data-testid={`flight-step-${step.id}`}
              >
                <span className="flight-code">{step.code}</span>
                <span className="flight-main">
                  <strong>{step.label}</strong>
                  <span>{step.detail}</span>
                </span>
                <span className="flight-status">{flightStatusLabel(step.status)}</span>
              </button>
            </li>
          ))}
        </ol>
        <details className="plan-archive">
          <summary>
            <span className="eyebrow">ARCHIVE · FILING FEES</span>
            <span className="panel-note">OPTIONAL</span>
          </summary>
          <ol className="flight-list flight-list-compact" aria-label="Optional archive">
            {archiveFlight.map((step) => (
              <li key={step.id} className={`flight-item is-${step.status}`}>
                <button
                  type="button"
                  onClick={() => selectModule(step.id)}
                  aria-pressed={activeModule === step.id}
                  data-testid={`flight-step-${step.id}`}
                >
                  <span className="flight-code">{step.code}</span>
                  <span className="flight-main">
                    <strong>{step.label}</strong>
                    <span>{step.detail}</span>
                  </span>
                  <span className="flight-status">{flightStatusLabel(step.status)}</span>
                </button>
              </li>
            ))}
          </ol>
        </details>
      </div>
    </details>
  </section>
  );
}
