export const AGENT_ACTIONS = {
  showJurisdictionComparison: "showJurisdictionComparison",
  setFounderEquity: "setFounderEquity",
  setOwnerCount: "setOwnerCount",
  setChecklistItem: "setChecklistItem",
  setChecklistItems: "setChecklistItems",
  advanceChecklist: "advanceChecklist",
  approveCompanyName: "approveCompanyName",
  showFilingSteps: "showFilingSteps",
  prepareLawyerSummary: "prepareLawyerSummary",
  undoLastChange: "undoLastChange",
  startOver: "startOver",
  compareJurisdictions: "compareJurisdictions",
} as const;

export type AgentActionName = (typeof AGENT_ACTIONS)[keyof typeof AGENT_ACTIONS];
