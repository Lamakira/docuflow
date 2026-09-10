import {
  isOpportunityTerminal,
  opportunityStageFromCombined,
  projectHasOpportunity,
} from "@shared/projectLifecycle";
import { chromeRefusal } from "./chrome";
import { projectHref } from "./today";

/**
 * Opportunities pipeline (#187).
 * Novelty: Opportunity Stage-change as state indication (the card moves to another Stage column).
 * Do not animate: pipeline scroll, decorative card tilt, initial mount of columns.
 * Pointer-follow drag is the write, not decoration.
 */

export type OpportunityStageOption = {
  id: string;
  label: string;
  terminal: boolean;
};

export type OpportunityPipelineRowInput = {
  id: string;
  name: string;
  clientName: string | null;
  combinedStatus: string;
  projectType: string | null;
  isDocumentationOnly: number | null;
};

export type OpportunityPipelineInput = {
  workspaceName: string;
  stages: OpportunityStageOption[];
  rows: OpportunityPipelineRowInput[];
  filterQuery: string;
  changingId: string | null;
};

export type OpportunityCard = {
  id: string;
  name: string;
  clientLabel: string;
  stage: string;
  stageLabel: string;
  terminal: boolean;
  canChangeStage: boolean;
  projectHref: string | null;
  changing: boolean;
};

export type OpportunityColumn = {
  id: string;
  label: string;
  terminal: boolean;
  cards: OpportunityCard[];
};

export type OpportunityPipelineModel = {
  subhead: string;
  empty: boolean;
  emptyCopy: string;
  columns: OpportunityColumn[];
  count: number;
};

export const FALLBACK_OPEN_STAGES: OpportunityStageOption[] = [
  { id: "lead", label: "Lead", terminal: false },
  { id: "discovering_call_completed", label: "Discovering call completed", terminal: false },
  { id: "proposal_sent", label: "Proposal sent", terminal: false },
  { id: "follow_up", label: "Follow up", terminal: false },
  { id: "in_negotiation", label: "In negotiation", terminal: false },
];

const TERMINAL_STAGES: OpportunityStageOption[] = [
  { id: "won", label: "Won", terminal: true },
  { id: "lost", label: "Lost", terminal: true },
];

function stageLabel(id: string, provided?: string): string {
  const source = (provided?.trim() || id).trim();
  if (!source) return id;
  const isSlug =
    /_/.test(source) ||
    (!/\s/.test(source) && (source === source.toLowerCase() || source === source.toUpperCase()));
  if (!isSlug) return source;
  const words = source.replace(/[_-]+/g, " ").toLowerCase().replace(/\s+/g, " ").trim();
  return words.replace(/^\w/, (character) => character.toUpperCase());
}

export function stageOptionsFromFieldOptions(options: string[] | null | undefined): OpportunityStageOption[] {
  if (!options || options.length === 0) return FALLBACK_OPEN_STAGES;
  return options.map((option) => {
    try {
      const parsed = JSON.parse(option);
      if (parsed && typeof parsed === "object" && parsed.label) {
        const id = String(parsed.label)
          .toLowerCase()
          .replace(/[\s-]+/g, "_")
          .replace(/[^a-z0-9_]/g, "");
        return { id, label: stageLabel(id, parsed.label), terminal: isOpportunityTerminal(id) };
      }
    } catch {
      /* legacy string */
    }
    const id = option.toLowerCase().replace(/[\s-]+/g, "_").replace(/[^a-z0-9_]/g, "");
    return { id, label: stageLabel(id, option), terminal: isOpportunityTerminal(id) };
  });
}

export function composeOpportunityStages(options: OpportunityStageOption[]): OpportunityStageOption[] {
  const source = options.length ? options : FALLBACK_OPEN_STAGES;
  const seen = new Set<string>();
  const open: OpportunityStageOption[] = [];

  for (const option of source) {
    const id = opportunityStageFromCombined(option.id);
    if (isOpportunityTerminal(id)) continue;
    if (seen.has(id)) continue;
    seen.add(id);
    open.push({
      id,
      label: stageLabel(id, option.label),
      terminal: false,
    });
  }

  return [...open, ...TERMINAL_STAGES];
}

export function canChangeOpportunityStage(from: string, to: string): boolean {
  if (!to || from === to) return false;
  if (isOpportunityTerminal(from)) return false;
  return true;
}

export function combinedStatusForStage(stage: string, currentCombined?: string): string {
  if (
    stage === "won" &&
    currentCombined &&
    opportunityStageFromCombined(currentCombined) === "won"
  ) {
    return currentCombined;
  }
  return stage;
}

export function composeOpportunityPipeline(input: OpportunityPipelineInput): OpportunityPipelineModel {
  const needle = input.filterQuery.trim().toLowerCase();
  const stages = input.stages.length ? input.stages : composeOpportunityStages(FALLBACK_OPEN_STAGES);
  const stageById = new Map(stages.map((stage) => [stage.id, stage]));
  const columns: OpportunityColumn[] = stages.map((stage) => ({
    id: stage.id,
    label: stage.label,
    terminal: stage.terminal || isOpportunityTerminal(stage.id),
    cards: [],
  }));
  const columnById = new Map(columns.map((column) => [column.id, column]));

  for (const row of input.rows) {
    if (
      !projectHasOpportunity({
        isDocumentationOnly: row.isDocumentationOnly,
        projectType: row.projectType,
        status: row.combinedStatus,
      })
    ) {
      continue;
    }
    if (needle) {
      const haystack = `${row.name} ${row.clientName ?? ""}`.toLowerCase();
      if (!haystack.includes(needle)) continue;
    }

    const stage = opportunityStageFromCombined(row.combinedStatus);
    const spec = stageById.get(stage);
    let column = columnById.get(stage);
    if (!column) {
      column = {
        id: stage,
        label: spec?.label ?? stageLabel(stage),
        terminal: spec?.terminal || isOpportunityTerminal(stage),
        cards: [],
      };
      columns.push(column);
      columnById.set(stage, column);
    }

    const terminal = column.terminal;
    column.cards.push({
      id: row.id,
      name: row.name || "Untitled Opportunity",
      clientLabel: row.clientName?.trim() || "",
      stage,
      stageLabel: column.label,
      terminal,
      canChangeStage: !terminal,
      projectHref: stage === "won" ? projectHref(row.id) : null,
      changing: row.id === input.changingId,
    });
  }

  const count = columns.reduce((sum, column) => sum + column.cards.length, 0);
  const empty = count === 0;
  return {
    subhead: `Opportunities in ${input.workspaceName}.`,
    empty,
    emptyCopy: empty
      ? needle
        ? "No Opportunities match this filter."
        : "No Opportunities in this Workspace yet."
      : "",
    columns,
    count,
  };
}

export function opportunityWriteRefusal(input: {
  readOnly: boolean;
  workspaceName: string;
  errorMessage?: string;
  ownerName?: string | null;
  capability?: string;
}): string {
  if (input.readOnly || /read-only/i.test(input.errorMessage ?? "")) {
    return chromeRefusal({
      kind: "workspace-condition",
      workspaceName: input.workspaceName,
      condition: "Read-only",
    });
  }
  const message = input.errorMessage ?? "";
  if (/permission denied|not authorized|access denied|forbidden/i.test(message)) {
    return chromeRefusal({
      kind: "capability",
      capability: input.capability ?? "Create Opportunities",
      ownerName: input.ownerName,
    });
  }
  return chromeRefusal({ kind: "generic", message: message || "Failed to update Opportunity" });
}
