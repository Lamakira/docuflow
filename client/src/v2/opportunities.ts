import {
  isOpportunityTerminal,
  opportunityStageFromCombined,
  projectHasOpportunity,
} from "@shared/projectLifecycle";
import {
  DEFAULT_OPPORTUNITY_CURRENCY,
  ESTIMATED_VALUE_MINOR_MAX,
  LOST_REASON_DETAIL_MAX,
  OPPORTUNITY_CURRENCIES,
  currencyExponent,
  isOpportunityCurrency,
} from "@shared/opportunityFields";
import { builtInList, workspaceListOptions } from "@shared/pipelineLists";
import { chromeRefusal } from "./chrome";
import { clientHref } from "./clients";
import { formatDayStamp, formatSpan, formatWhen, noteName, parseDate } from "./dossier";
import { readProjectBudget } from "./projects";
import { stageColor, stageInk } from "./stageColor";
import { memberName, projectHref } from "./today";

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
  estimatedValueMinor?: number | null;
  estimatedValueCurrency?: string | null;
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
  /** The Estimated value, formatted in its own currency. */
  valueLabel: string | null;
};

/** One option of a Pipeline & lists list, as a select offers it. */
export type ListOption = { value: string; label: string };

export type OpportunityRecordInput = OpportunityPipelineRowInput & {
  /** The Workspace's stages, so the record wears the colour its column does. */
  stages?: OpportunityStageOption[];
  clientId?: string | null;
  owner?: { firstName?: string | null; lastName?: string | null; email?: string | null } | null;
  dueDate?: Date | string | null;
  source?: string | null;
  sourceOptions?: ListOption[];
  lostReason?: string | null;
  lostReasonDetail?: string | null;
  lostReasonOptions?: ListOption[];
};

export type OpportunityRecordModel = {
  id: string;
  title: string;
  clientLabel: string;
  clientHref: string | null;
  stageId: string;
  stage: string;
  stageColor: string;
  terminal: boolean;
  fields: Array<{ label: string; value: string }>;
  lostReason: { label: string; detail: string | null } | null;
  /** Lost before a reason was asked for (v1 moves a row to Lost without one). */
  lostReasonMissing: boolean;
};

export type EmptyStateCopy = { title: string; copy: string; action?: string };


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
  const value = estimatedValueLabel(input.estimatedValueMinor, input.estimatedValueCurrency);
  const close = parseDate(input.dueDate ?? null);
  const isLost = stage === "lost";
  const lost = isLost && input.lostReason;
  return {
    id: input.id,
    title: input.name || "Untitled Opportunity",
    clientLabel: input.clientName?.trim() || "—",
    clientHref: input.clientId ? clientHref(input.clientId) : null,
    stageId: stage,
    stage: stageLabel(stage).toUpperCase(),
    stageColor: stageColor(stage, input.stages?.find((option) => option.id === stage)?.color),
    terminal: isOpportunityTerminal(stage),
    fields: [
      { label: "OWNER", value: input.owner ? memberName(input.owner) : "No Owner" },
      { label: "EXPECTED CLOSE", value: close ? formatCloseDate(close) : "Not set" },
      { label: "SOURCE", value: input.source ? optionLabel(input.sourceOptions, input.source) : "Not set" },
      { label: "ESTIMATED VALUE", value: value ?? "Not set" },
    ],
    lostReason: lost
      ? { label: optionLabel(input.lostReasonOptions, input.lostReason!), detail: input.lostReasonDetail?.trim() || null }
      : null,
    lostReasonMissing: isLost && !input.lostReason,
  };
}

function optionLabel(options: ListOption[] | undefined, value: string): string {
  return options?.find((option) => option.value === value)?.label ?? stageLabel(value);
}

/** A date-only field: stored at UTC midnight, read back on the same day everywhere. */
function formatCloseDate(value: Date): string {
  return value.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" });
}

export type OpportunityColumn = {
  id: string;
  label: string;
  terminal: boolean;
  /** The stage colour, as a pill over a tint (v1 parity). */
  color: string;
  ink: "light" | "dark";
  cards: OpportunityCard[];
  /** One total per currency, never summed across currencies. */
  totals: string[];
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
  return { id, label, terminal, color, ink: stageInk(color), cards: [], totals: [] };
}

export function composeOpportunityPipeline(input: OpportunityPipelineInput): OpportunityPipelineModel {
  const needle = input.filterQuery.trim().toLowerCase();
  const stages = input.stages.length ? input.stages : composeOpportunityStages(FALLBACK_OPEN_STAGES);
  const stageById = new Map(stages.map((stage) => [stage.id, stage]));
  const columns: OpportunityColumn[] = stages.map((stage) =>
    stageColumn(stage.id, stage.label, stage.terminal || isOpportunityTerminal(stage.id), stage.color),
  );
  const columnById = new Map(columns.map((column) => [column.id, column]));
  const sums = new Map<string, Map<string, number>>();

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
      valueLabel: estimatedValueLabel(row.estimatedValueMinor, row.estimatedValueCurrency),
    });
    if (row.estimatedValueMinor != null && isOpportunityCurrency(row.estimatedValueCurrency)) {
      const byCurrency = sums.get(column.id) ?? new Map<string, number>();
      byCurrency.set(row.estimatedValueCurrency, (byCurrency.get(row.estimatedValueCurrency) ?? 0) + row.estimatedValueMinor);
      sums.set(column.id, byCurrency);
    }
  }

  for (const column of columns) {
    const byCurrency = sums.get(column.id);
    if (!byCurrency) continue;
    column.totals = [...byCurrency.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([currency, minor]) => formatMoney(minor, currency));
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

/**
 * The Estimated value in its own currency, e.g. "4 500 €" or "1 200,50 $":
 * grouped, the symbol after, minor units only when there are some.
 */
export function formatMoney(minor: number, currency: string): string {
  const exponent = currencyExponent(currency);
  const unit = 10 ** exponent;
  return new Intl.NumberFormat("fr-FR", {
    style: "currency",
    currency,
    currencyDisplay: "narrowSymbol",
    minimumFractionDigits: minor % unit === 0 ? 0 : exponent,
    maximumFractionDigits: exponent,
  }).format(minor / unit);
}

export function estimatedValueLabel(minor: number | null | undefined, currency: string | null | undefined): string | null {
  if (minor == null || !currency) return null;
  return formatMoney(minor, currency);
}

function currencySymbol(currency: string): string {
  const parts = new Intl.NumberFormat("fr-FR", { style: "currency", currency, currencyDisplay: "narrowSymbol" }).formatToParts(0);
  return parts.find((part) => part.type === "currency")?.value ?? currency;
}

export const CURRENCY_OPTIONS: ListOption[] = OPPORTUNITY_CURRENCIES.map((code) => {
  const symbol = currencySymbol(code);
  return { value: code, label: symbol === code ? code : `${code} ${symbol}` };
});

/** An amount as typed ("4500", "4 500", "4500,50"), in the currency's minor units; blank is no value. */
export function readAmount(text: string, currency: string): { minor: number | null; issue: string | null } {
  const compact = text.replace(/[\s\u00a0\u202f']/g, "");
  if (!compact) return { minor: null, issue: null };
  const exponent = currencyExponent(currency);
  const match = compact.match(/^(\d+)(?:[.,](\d+))?$/);
  if (!match || (match[2]?.length ?? 0) > exponent) {
    return {
      minor: null,
      issue: exponent > 0 ? "Write the Estimated value as an amount, e.g. 4500 or 4500.50." : "Write the Estimated value as a whole amount.",
    };
  }
  const minor = Number(match[1]) * 10 ** exponent + Number((match[2] ?? "").padEnd(exponent, "0") || 0);
  if (!Number.isSafeInteger(minor) || minor > ESTIMATED_VALUE_MINOR_MAX) {
    return { minor: null, issue: "That Estimated value is too large." };
  }
  return { minor, issue: null };
}

function amountText(minor: number | null | undefined, currency: string): string {
  if (minor == null) return "";
  const exponent = currencyExponent(currency);
  const unit = 10 ** exponent;
  return minor % unit === 0 ? String(minor / unit) : (minor / unit).toFixed(exponent);
}

type ModuleFieldsRead = ReadonlyArray<{ slug: string; options?: string[] | null }> | null | undefined;

function listOptions(moduleSlug: string, fieldSlug: string, fields: ModuleFieldsRead): ListOption[] {
  const list = builtInList(moduleSlug, fieldSlug);
  if (!list) return [];
  const saved = fields?.find((field) => field.slug === fieldSlug)?.options;
  return workspaceListOptions(list, saved).map((option) => ({ value: option.value, label: option.label }));
}

/** The Pipeline & lists Source list, read from the `contacts` module's fields. */
export function opportunitySourceOptions(contactFields: ModuleFieldsRead): ListOption[] {
  return listOptions("contacts", "source", contactFields);
}

/** The Pipeline & lists Lost reasons, read from the `projects` module's fields. */
export function lostReasonOptions(projectFields: ModuleFieldsRead): ListOption[] {
  return listOptions("projects", "lost_reason", projectFields);
}

/** A win creates a Client Project, so Internal is never offered. */
export function winProjectTypeOptions(projectFields: ModuleFieldsRead): ListOption[] {
  return listOptions("projects", "project_type", projectFields).filter((option) => option.value !== "internal");
}

/** A value already saved stays a choice even after its option left the list. */
export function withSavedChoice(options: ListOption[], saved: string | null | undefined): ListOption[] {
  if (!saved || options.some((option) => option.value === saved)) return options;
  return [...options, { value: saved, label: stageLabel(saved) }];
}

export type SavedOpportunity = {
  name: string;
  clientId: string | null;
  opportunityOwnerId: string | null;
  dueDate: Date | string | null;
  source: string | null;
  estimatedValueMinor: number | null;
  estimatedValueCurrency: string | null;
};

export type OpportunityDraft = {
  name: string;
  clientId: string;
  ownerId: string;
  /** `YYYY-MM-DD`, as a date input holds it. */
  closeDate: string;
  source: string;
  amount: string;
  currency: string;
};

export type NewOpportunityDraft = OpportunityDraft & { stage: string; note: string };

type OpportunityFields = {
  name: string;
  clientId: string | null;
  opportunityOwnerId: string | null;
  dueDate: string | null;
  source: string | null;
  estimatedValueMinor: number | null;
  estimatedValueCurrency: string | null;
};

function closeDateOf(value: Date | string | null | undefined): string {
  return parseDate(value ?? null)?.toISOString().slice(0, 10) ?? "";
}

export function newOpportunityDraft(ownerId: string): NewOpportunityDraft {
  return {
    name: "",
    clientId: "",
    ownerId,
    closeDate: "",
    source: "",
    amount: "",
    currency: DEFAULT_OPPORTUNITY_CURRENCY,
    stage: "lead",
    note: "",
  };
}

export function opportunityDraft(saved: SavedOpportunity): OpportunityDraft {
  const currency = isOpportunityCurrency(saved.estimatedValueCurrency) ? saved.estimatedValueCurrency : DEFAULT_OPPORTUNITY_CURRENCY;
  return {
    name: saved.name,
    clientId: saved.clientId ?? "",
    ownerId: saved.opportunityOwnerId ?? "",
    closeDate: closeDateOf(saved.dueDate),
    source: saved.source ?? "",
    amount: amountText(saved.estimatedValueMinor, currency),
    currency,
  };
}

function readOpportunityDraft(draft: OpportunityDraft): { fields: OpportunityFields; issue: null } | { fields: null; issue: string } {
  const name = draft.name.trim();
  if (!name) return { fields: null, issue: "Name the Opportunity." };
  if (draft.closeDate && !/^\d{4}-\d{2}-\d{2}$/.test(draft.closeDate)) {
    return { fields: null, issue: "Pick the Expected close date from the calendar." };
  }
  if (!isOpportunityCurrency(draft.currency)) return { fields: null, issue: "Choose the currency of the Estimated value." };
  const amount = readAmount(draft.amount, draft.currency);
  if (amount.issue) return { fields: null, issue: amount.issue };
  return {
    fields: {
      name,
      clientId: draft.clientId || null,
      opportunityOwnerId: draft.ownerId || null,
      dueDate: draft.closeDate || null,
      source: draft.source || null,
      estimatedValueMinor: amount.minor,
      estimatedValueCurrency: amount.minor == null ? null : draft.currency,
    },
    issue: null,
  };
}

/** What New Opportunity posts, and the first note it adds once created. */
export function newOpportunityPayload(
  draft: NewOpportunityDraft,
): { body: OpportunityFields & { status: string }; note: string | null; issue: null } | { body: null; note: null; issue: string } {
  const read = readOpportunityDraft(draft);
  if (!read.fields) return { body: null, note: null, issue: read.issue };
  const stage = draft.stage && !isOpportunityTerminal(draft.stage) ? draft.stage : "lead";
  return { body: { ...read.fields, status: stage }, note: draft.note.trim() || null, issue: null };
}

export type OpportunityForm = {
  issue: string | null;
  dirty: boolean;
  canSave: boolean;
  note: string;
  /** Only the keys that change, as `PATCH /api/crm/projects/:id` names them. */
  patch: Record<string, unknown> | null;
};

/** The Opportunity record's edit form: what would be written, and whether it changes anything. */
export function composeOpportunityForm(draft: OpportunityDraft, saved: SavedOpportunity): OpportunityForm {
  const read = readOpportunityDraft(draft);
  if (!read.fields) return { issue: read.issue, dirty: true, canSave: false, note: read.issue, patch: null };
  const next = read.fields;
  const patch: Record<string, unknown> = {};
  if (next.name !== saved.name) patch.projectName = next.name;
  if (next.clientId !== (saved.clientId ?? null)) patch.clientId = next.clientId;
  if (next.opportunityOwnerId !== (saved.opportunityOwnerId ?? null)) patch.opportunityOwnerId = next.opportunityOwnerId;
  if ((next.dueDate ?? "") !== closeDateOf(saved.dueDate)) patch.dueDate = next.dueDate;
  if (next.source !== (saved.source ?? null)) patch.source = next.source;
  if (
    next.estimatedValueMinor !== (saved.estimatedValueMinor ?? null) ||
    next.estimatedValueCurrency !== (saved.estimatedValueCurrency ?? null)
  ) {
    patch.estimatedValueMinor = next.estimatedValueMinor;
    patch.estimatedValueCurrency = next.estimatedValueCurrency;
  }
  const dirty = Object.keys(patch).length > 0;
  return {
    issue: null,
    dirty,
    canSave: dirty,
    note: dirty ? "Unsaved changes." : "Every field is saved.",
    patch: dirty ? patch : null,
  };
}

export type WinDraft = { projectType: string; hours: string; minutes: string; managerId: string; clientId: string };

/**
 * Mark as won: the Client Project's Project type and hours budget, and its
 * Project Manager, proposed as the Opportunity Owner. Choosing another Project
 * Manager leaves the Owner as it is.
 */
export function winDraft(
  row: {
    projectType: string | null;
    opportunityOwnerId: string | null;
    assigneeId: string | null;
    clientId: string | null;
    budgetedHours: number | null;
    budgetedMinutes?: number | null;
  },
  typeOptions: ListOption[],
): WinDraft {
  const projectType = typeOptions.some((option) => option.value === row.projectType)
    ? (row.projectType as string)
    : typeOptions[0]?.value ?? "one_time";
  const hours = row.budgetedHours ?? 0;
  const minutes = row.budgetedMinutes ?? 0;
  return {
    projectType,
    hours: hours > 0 || minutes > 0 ? String(hours) : "",
    minutes: minutes > 0 ? String(minutes) : "",
    managerId: row.opportunityOwnerId ?? row.assigneeId ?? "",
    clientId: row.clientId ?? "",
  };
}

export function readWinDraft(
  draft: WinDraft,
  current: { status: string; clientId: string | null },
): { payload: Record<string, unknown>; issue: null } | { payload: null; issue: string } {
  if (!draft.projectType || draft.projectType === "internal") return { payload: null, issue: "Choose the Project type." };
  if (!current.clientId && !draft.clientId) return { payload: null, issue: "Choose the Client this Client Project is for." };
  const budget = readProjectBudget({ hours: draft.hours, minutes: draft.minutes });
  if (!budget.budget) return { payload: null, issue: budget.issue };
  return {
    payload: {
      status: combinedStatusForStage("won", current.status),
      projectType: draft.projectType,
      budgetedHours: budget.budget.budgetedHours,
      budgetedMinutes: budget.budget.budgetedMinutes,
      assigneeId: draft.managerId || null,
      ...(current.clientId ? {} : { clientId: draft.clientId }),
    },
    issue: null,
  };
}

export type LostDraft = { reason: string; detail: string };

export function lostDraft(row: { lostReason?: string | null; lostReasonDetail?: string | null }): LostDraft {
  return { reason: row.lostReason ?? "", detail: row.lostReasonDetail ?? "" };
}

/** What `POST /api/crm/projects/:id/lost` takes: marks Lost, or edits the reason once Lost. */
export function readLostDraft(
  draft: LostDraft,
): { payload: Record<string, unknown>; issue: null } | { payload: null; issue: string } {
  if (!draft.reason) return { payload: null, issue: "Choose a Lost reason." };
  const detail = draft.detail.trim();
  if (detail.length > LOST_REASON_DETAIL_MAX) {
    return { payload: null, issue: `Keep the detail under ${LOST_REASON_DETAIL_MAX} characters.` };
  }
  return {
    payload: {
      lostReason: draft.reason,
      lostReasonDetail: detail || null,
    },
    issue: null,
  };
}

type Person = { firstName?: string | null; lastName?: string | null; email?: string | null };

export type OpportunityStageChange = {
  id: string;
  fromStatus: string | null;
  toStatus: string;
  changedAt: Date | string | null;
  changedBy?: Person | null;
};

export type OpportunityHistoryModel = {
  rows: Array<{ id: string; from: string | null; fromColor: string | null; to: string; toColor: string; when: string; who: string; held: string }>;
  empty: boolean;
  emptyState: EmptyStateCopy;
};

/**
 * Stage history, like the Dossier's Status history. A win's later delivery
 * moves (Won → Won - In progress) are the Client Project's, not a Stage change.
 */
export function composeOpportunityHistory(
  changes: OpportunityStageChange[],
  stages: OpportunityStageOption[],
  now: Date,
): OpportunityHistoryModel {
  const describe = (combined: string) => {
    const stage = opportunityStageFromCombined(combined);
    const spec = stages.find((option) => option.id === stage);
    return { label: (spec?.label ?? stageLabel(stage)).toUpperCase(), color: stageColor(stage, spec?.color) };
  };
  const moves = changes
    .filter((change) => !change.fromStatus || opportunityStageFromCombined(change.fromStatus) !== opportunityStageFromCombined(change.toStatus))
    .map((change) => ({ change, at: parseDate(change.changedAt) }))
    .sort((a, b) => (b.at?.getTime() ?? 0) - (a.at?.getTime() ?? 0));
  const rows = moves.map(({ change, at }, index) => {
    const next = index > 0 ? moves[index - 1].at : null;
    const held = at ? formatSpan((next ?? now).getTime() - at.getTime()) : "—";
    const from = change.fromStatus ? describe(change.fromStatus) : null;
    const to = describe(change.toStatus);
    return {
      id: change.id,
      from: from?.label ?? null,
      fromColor: from?.color ?? null,
      to: to.label,
      toColor: to.color,
      when: at ? formatDayStamp(at) : "",
      who: change.changedBy ? memberName(change.changedBy) : "—",
      held: next || !at ? held : `${held} so far`,
    };
  });
  return {
    rows,
    empty: rows.length === 0,
    emptyState: {
      title: "No Stage changes yet",
      copy: "Each move along the pipeline is recorded here: the Stage it left, the one it reached, who moved it, and how long it held.",
    },
  };
}

export type OpportunityNoteInput = {
  id: string;
  content: string;
  createdAt: Date | string | null;
  createdBy?: Person | null;
};

export type OpportunityNotesModel = {
  rows: Array<{ id: string; content: string; meta: string; deleteConsequence: string }>;
  empty: boolean;
  emptyState: { title: string; copy: string; action: string };
};

/** The Opportunity's thread of dated notes, as the Dossier's Notes tab shows a Project's. */
export function composeOpportunityNotes(notes: OpportunityNoteInput[], now: Date): OpportunityNotesModel {
  const rows = notes.map((note) => ({
    id: note.id,
    content: note.content,
    meta: [note.createdAt ? formatWhen(note.createdAt, now) : null, note.createdBy ? memberName(note.createdBy).toUpperCase() : null]
      .filter(Boolean)
      .join(" · "),
    deleteConsequence: `${noteName(note.content)} will be deleted from this Opportunity. This cannot be undone.`,
  }));
  return {
    rows,
    empty: rows.length === 0,
    emptyState: {
      title: "No notes yet",
      copy: "Notes keep what was said and decided on this Opportunity: a call, a meeting, what the Client asked for.",
      action: "Write the first note",
    },
  };
}

export function opportunityNotesPath(id: string): string {
  return `/api/crm/projects/${id}/notes`;
}

export function opportunityNotePath(id: string, noteId: string): string {
  return `/api/crm/projects/${id}/notes/${noteId}`;
}

export function opportunityLostPath(id: string): string {
  return `/api/crm/projects/${id}/lost`;
}

export function opportunityStageHistoryPath(id: string): string {
  return `/api/crm/projects/${id}/stage-history`;
}
