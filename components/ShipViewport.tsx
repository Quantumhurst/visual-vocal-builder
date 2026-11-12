"use client";

// The centre viewport: STAR MAP / COLONY tabs, the live Pixi scenes, the
// status footer, and the rocket-travel cinematic shown while the ship
// switches home base. Presentation only.

import dynamic from "next/dynamic";
import type { SharedState } from "../lib/state";

// PixiJS touches window/WebGL at import time; both scenes are client-only.
const GalaxyHero = dynamic(() => import("./GalaxyHero"), { ssr: false });
const ColonyView = dynamic(() => import("./ColonyView"), { ssr: false });

type Props = {
  view: SharedState;
  stageTab: "galaxy" | "colony";
  selectStage: (tab: "galaxy" | "colony") => void;
  handleSelectJurisdiction: (jurisdiction: string) => void;
  clockLabel: string;
  homeBase: string;
  structures: { built: number; total: number };
  equityLabel: string;
  ship: string;
  activeMeta: { label: string };
  travel: { planet: string; id: number } | null;
  travelColor: string;
};

export default function ShipViewport({
  view,
  stageTab,
  selectStage,
  handleSelectJurisdiction,
  clockLabel,
  homeBase,
  structures,
  equityLabel,
  ship,
  activeMeta,
  travel,
  travelColor,
}: Props) {
  return (
    <section className="stage" aria-label="Ship viewport">
      <div className="stage-head">
        <div className="stage-tabs" role="tablist" aria-label="Viewport">
          <button
            type="button"
            role="tab"
            aria-selected={stageTab === "galaxy"}
            className={stageTab === "galaxy" ? "is-active" : ""}
            onClick={() => selectStage("galaxy")}
          >
            STAR MAP
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={stageTab === "colony"}
            className={stageTab === "colony" ? "is-active" : ""}
            onClick={() => selectStage("colony")}
          >
            COLONY
          </button>
        </div>
        <div className="stage-live">
          <span className="live-dot" aria-hidden="true" />
          LIVE FEED
          <span className="stage-clock">T+{clockLabel}</span>
        </div>
      </div>

      <div className="stage-viewport">
        <div className="stage-scene-wrap" hidden={stageTab !== "galaxy"}>
          <GalaxyHero
            rows={view.jurisdictions}
            selected={view.selectedJurisdiction}
            onSelect={handleSelectJurisdiction}
          />
        </div>
        <div className="stage-scene-wrap" hidden={stageTab !== "colony"}>
          <ColonyView
            selected={view.selectedJurisdiction}
            checklist={view.checklist}
            founders={view.founders}
            lawyerPackage={view.lawyerPackage}
          />
        </div>
        <span className="reticle" aria-hidden="true" />
        <span className="scanlines" aria-hidden="true" />
      </div>

      <div className="stage-foot">
        <span>
          HOME BASE <strong>{homeBase}</strong>
        </span>
        <span>
          COLONY{" "}
          <strong>
            {structures.built}/{structures.total}
          </strong>
        </span>
        <span>
          CREW <strong>{equityLabel}</strong>
        </span>
        <span>
          SHIP <strong data-testid="ship-name">{ship}</strong>
        </span>
        <span>
          PHASE <strong>{activeMeta.label.toUpperCase()}</strong>
        </span>
      </div>

      {travel ? (
        <div className="warp" key={travel.id} data-testid="warp-transition">
          <div className="warp-stars warp-stars-a" aria-hidden="true" />
          <div className="warp-stars warp-stars-b" aria-hidden="true" />
          <div className="warp-flash" aria-hidden="true" />
          <div className="warp-target" aria-hidden="true">
            <span
              className="warp-planet"
              style={{
                background: `radial-gradient(circle at 34% 30%, #fff 0 5%, ${travelColor} 36%, #0b1026 100%)`,
                boxShadow: `0 0 70px ${travelColor}`,
              }}
            />
            <span className="warp-ring" />
          </div>
          <div className="warp-rocket" aria-hidden="true">
            <svg viewBox="0 0 64 64" width="64" height="64">
              <path
                d="M32 4c8 7 12 17 12 28l-6 8H26l-6-8C20 21 24 11 32 4Z"
                fill="#e9eeff"
                stroke="#7fe7ff"
                strokeWidth="1.6"
              />
              <circle cx="32" cy="24" r="5" fill="#08101f" stroke="#ffd166" strokeWidth="2" />
              <path d="M26 40 18 52l10-3M38 40l8 12-10-3" fill="#ff6b7a" />
              <path d="M32 46v13" stroke="#ffd166" strokeWidth="4" strokeLinecap="round" />
            </svg>
          </div>
          <div className="warp-copy">
            <span className="eyebrow">COURSE LOCKED</span>
            <strong>{travel.planet}</strong>
            <span className="warp-sub">ENTERING ORBIT</span>
          </div>
        </div>
      ) : null}
    </section>
  );
}
