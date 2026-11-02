export const AGENT_ACTIONS = {
  showJurisdictionComparison: "showJurisdictionComparison",
  setFounderEquity: "setFounderEquity",
  setChecklistItem: "setChecklistItem",
  setChecklistItems: "setChecklistItems",
  advanceChecklist: "advanceChecklist",
  showRolloverFact: "showRolloverFact",
  showFilingSteps: "showFilingSteps",
  prepareLawyerSummary: "prepareLawyerSummary",
  undoLastChange: "undoLastChange",
  startOver: "startOver",
  compareJurisdictions: "compareJurisdictions",
} as const;

export type AgentActionName = (typeof AGENT_ACTIONS)[keyof typeof AGENT_ACTIONS];
