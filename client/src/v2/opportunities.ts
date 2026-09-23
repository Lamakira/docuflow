import {
  isOpportunityTerminal,
  opportunityStageFromCombined,
  projectHasOpportunity,
} from "@shared/projectLifecycle";
import { chromeRefusal } from "./chrome";
import { stageColor, stageInk } from "./stageColor";
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
  /** The colour an Administrator gave the stage in the CRM field options. */
  color?: string;
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
  recordHref: string;
  changing: boolean;
};

export type OpportunityRecordInput = OpportunityPipelineRowInput & {
};

export type OpportunityRecordModel = {
  id: string;
  title: string;
  clientLabel: string;
  stage: string;
  terminal: boolean;
};

export function opportunityHref(id: string): string {
  return `/opportunities/${id}`;
}

/**
 * No linked-Client-Project link here. An Opportunity and the Client Project a
 * win may create are distinct records (CONTEXT: "is not itself delivery work"),
 * and nothing in the data says which Project a won Opportunity produced — the
 * legacy rows share one `crm_projects` id, so linking on it would point the
 * Opportunity back at itself. #213 does not ask for the link either.
 */
export function composeOpportunityRecord(input: OpportunityRecordInput): OpportunityRecordModel {
  const stage = opportunityStageFromCombined(input.combinedStatus);
  return {
    id: input.id,
    title: input.name || "Untitled Opportunity",
    clientLabel: input.clientName?.trim() || "—",
    stage: stageLabel(stage).toUpperCase(),
    terminal: isOpportunityTerminal(stage),
  };
}

export type OpportunityColumn = {
  id: string;
  label: string;
  terminal: boolean;
  /** The stage colour, as a pill over a tint (v1 parity). */
  color: string;
  ink: "light" | "dark";
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
        return {
          id,
          label: stageLabel(id, parsed.label),
          terminal: isOpportunityTerminal(id),
          ...(typeof parsed.color === "string" ? { color: parsed.color } : {}),
        };
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
  const terminalColor = new Map<string, string>();

  for (const option of source) {
    const id = opportunityStageFromCombined(option.id);
    if (isOpportunityTerminal(id)) {
      if (option.color && !terminalColor.has(id)) terminalColor.set(id, option.color);
      continue;
    }
    if (seen.has(id)) continue;
    seen.add(id);
    open.push({
      id,
      label: stageLabel(id, option.label),
      terminal: false,
      ...(option.color ? { color: option.color } : {}),
    });
  }

  const terminal = TERMINAL_STAGES.map((stage) => {
    const color = terminalColor.get(stage.id);
    return color ? { ...stage, color } : stage;
  });
  return [...open, ...terminal];
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

function stageColumn(id: string, label: string, terminal: boolean, configured?: string): OpportunityColumn {
  const color = stageColor(id, configured);
  return { id, label, terminal, color, ink: stageInk(color), cards: [] };
}

export function composeOpportunityPipeline(input: OpportunityPipelineInput): OpportunityPipelineModel {
  const needle = input.filterQuery.trim().toLowerCase();
  const stages = input.stages.length ? input.stages : composeOpportunityStages(FALLBACK_OPEN_STAGES);
  const stageById = new Map(stages.map((stage) => [stage.id, stage]));
  const columns: OpportunityColumn[] = stages.map((stage) =>
    stageColumn(stage.id, stage.label, stage.terminal || isOpportunityTerminal(stage.id), stage.color),
  );
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
      column = stageColumn(
        stage,
        spec?.label ?? stageLabel(stage),
        spec?.terminal || isOpportunityTerminal(stage),
        spec?.color,
      );
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
      projectHref: projectHref(row.id),
      recordHref: opportunityHref(row.id),
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
