export const AGENT_ACTIONS = {
  showJurisdictionComparison: "showJurisdictionComparison",
  setFounderEquity: "setFounderEquity",
  setChecklistItem: "setChecklistItem",
  advanceChecklist: "advanceChecklist",
  showRolloverFact: "showRolloverFact",
  showFilingSteps: "showFilingSteps",
  prepareLawyerSummary: "prepareLawyerSummary",
} as const;

export type AgentActionName = (typeof AGENT_ACTIONS)[keyof typeof AGENT_ACTIONS];
