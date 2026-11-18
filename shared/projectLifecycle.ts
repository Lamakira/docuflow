/**
 * Mapping from the combined `crm_projects.status` lifecycle to Opportunity
 * Stage and Project Status (ADR-0001 / #114). HTTP still reads and writes the
 * combined column; these values are the split records.
 */

import { opportunityTerminalStages, type ProjectStatus } from "./schema";

const PROJECT_STATUS_BY_COMBINED: Record<string, ProjectStatus> = {
  lead: "planned",
  discovering_call_completed: "planned",
  proposal_sent: "planned",
  follow_up: "planned",
  in_negotiation: "planned",
  won: "planned",
  won_not_started: "planned",
  won_in_progress: "active",
  won_in_review: "in_review",
  won_in_review_pm: "in_review",
  won_in_review_client: "in_review",
  in_negociation: "planned",
  won_completed: "completed",
  lost: "archived",
  won_cancelled: "archived",
  documented: "planned",
};

const OPPORTUNITY_STAGE_BY_COMBINED: Record<string, string> = {
  lead: "lead",
  discovering_call_completed: "discovering_call_completed",
  proposal_sent: "proposal_sent",
  follow_up: "follow_up",
  in_negotiation: "in_negotiation",
  won: "won",
  won_not_started: "won",
  won_in_progress: "won",
  won_in_review: "won",
  won_in_review_pm: "won",
  won_in_review_client: "won",
  in_negociation: "in_negotiation",
  won_completed: "won",
  lost: "lost",
  won_cancelled: "won",
};

export function projectStatusFromCombined(status: string | null | undefined): ProjectStatus {
  if (!status) return "planned";
  return PROJECT_STATUS_BY_COMBINED[status] ?? "planned";
}

export function opportunityStageFromCombined(status: string | null | undefined): string {
  if (!status) return "lead";
  return OPPORTUNITY_STAGE_BY_COMBINED[status] ?? status;
}

/**
 * A status that reads as stage Won. A custom open stage whose id happens to
 * start with `won_` (e.g. `won_paid`) is not a win.
 */
export function isWonStatus(status: string | null | undefined): boolean {
  return Boolean(status) && opportunityStageFromCombined(status) === "won";
}

export function projectHasOpportunity(row: {
  isDocumentationOnly?: number | null;
  projectType?: string | null;
  status?: string | null;
}): boolean {
  if (row.isDocumentationOnly) return false;
  if (row.projectType === "internal") return false;
  if (row.status === "documented") return false;
  return true;
}

export function isOpportunityTerminal(stage: string): boolean {
  return (opportunityTerminalStages as readonly string[]).includes(stage);
}
