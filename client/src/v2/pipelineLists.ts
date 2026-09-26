/**
 * Pipeline & lists, the Administration tab that replaced the CRM field builder.
 *
 * Only three option lists in `crm_module_fields` ever reach a record: the
 * `projects` module's `status` (Opportunity Stages, and the combined status v1
 * Projects read), its `project_type`, and the `contacts` module's `source`.
 * A Workspace that never saved one reads the defaults its consumers fall back
 * to; the first change asks the server to create the built-in lists, then
 * stores the edit.
 *
 * Every option carries a stable id. The server reads an option that keeps its
 * id and changes its value as a rename, and rewrites the records holding the
 * old value in the same transaction; moving, adding or removing renames nothing.
 */

import { isOpportunityTerminal, opportunityStageFromCombined } from "@shared/projectLifecycle";
import {
  BUILT_IN_LISTS,
  OPTION_VALUE_MAX,
  defaultFieldOptions,
  optionValue,
  parseFieldOptions,
  serializeFieldOption,
  type BuiltInList,
  type StoredOption,
} from "@shared/pipelineLists";
import type { CrmModuleWithFields } from "@shared/schema";
import { STAGE_FALLBACK_COLOR, stageColor } from "./stageColor";

export { optionValue };

export type PipelineListId = BuiltInList["key"];

type PipelineListSpec = {
  id: PipelineListId;
  title: string;
  sub: string;
  /** What one option is called in copy: "stage", "type", "source". */
  noun: string;
  builtIn: BuiltInList;
};

function builtIn(key: PipelineListId): BuiltInList {
  const list = BUILT_IN_LISTS.find((candidate) => candidate.key === key);
  if (!list) throw new Error(`No built-in list ${key}`);
  return list;
}

export const PIPELINE_LISTS: PipelineListSpec[] = [
  {
    id: "opportunity-stages",
    title: "Opportunity stages",
    sub: "The open columns of the Opportunities board, in this order. Won and Lost always close the pipeline; only their colour is set here.",
    noun: "stage",
    builtIn: builtIn("opportunity-stages"),
  },
  {
    id: "project-type",
    title: "Project type",
    sub: "The Project type choices on a Project.",
    noun: "type",
    builtIn: builtIn("project-type"),
  },
  {
    id: "source",
    title: "Source",
    sub: "Where a Client came from, as offered on the Client record.",
    noun: "source",
    builtIn: builtIn("source"),
  },
];

export const PIPELINE_LISTS_INTRO =
  "These lists feed the Opportunity stages and the Project type and Source dropdowns on Projects and Clients. A change applies to everyone in the Workspace.";

/** The colours an option can wear; the seeded defaults all come from here. */
export const PIPELINE_COLOURS: Array<{ name: string; hex: string }> = [
  { name: "Pink", hex: "#ec4899" },
  { name: "Violet", hex: "#8b5cf6" },
  { name: "Indigo", hex: "#6366f1" },
  { name: "Blue", hex: "#3b82f6" },
  { name: "Sky", hex: "#0ea5e9" },
  { name: "Cyan", hex: "#06b6d4" },
  { name: "Teal", hex: "#14b8a6" },
  { name: "Green", hex: "#22c55e" },
  { name: "Lime", hex: "#84cc16" },
  { name: "Amber", hex: "#f59e0b" },
  { name: "Orange", hex: "#f97316" },
  { name: "Red", hex: "#ef4444" },
  { name: "Rose", hex: "#f43f5e" },
  { name: "Slate", hex: STAGE_FALLBACK_COLOR },
];

type StageRole = "open" | "outcome" | "follow-on";

/**
 * Won and Lost are fixed outcomes (CONTEXT: Opportunity Stage). The `won_*`
 * entries are the combined statuses v1 Projects move through after a win; the
 * board folds them into Won, so they are kept as saved and not listed.
 */
function stageRole(value: string): StageRole {
  if (value === "won" || value === "lost") return "outcome";
  return isOpportunityTerminal(opportunityStageFromCombined(value)) ? "follow-on" : "open";
}

export type PipelineOptionRow = {
  /** Position in the stored options array. */
  index: number;
  id: string;
  value: string;
  label: string;
  color: string;
  /** Won or Lost: recoloured, never renamed, moved or removed. */
  outcome: boolean;
  /** A value the code reads by name: recoloured and moved, never renamed or removed. */
  builtIn: boolean;
  canMoveUp: boolean;
  canMoveDown: boolean;
  canRemove: boolean;
  removeConsequence: string;
};

export type PipelineListModel = {
  id: PipelineListId;
  title: string;
  sub: string;
  noun: string;
  /** False while the Workspace reads the defaults; the first change saves them. */
  saved: boolean;
  unsavedNote: string | null;
  renameNote: string;
  /** What is stored, or the defaults when nothing is, each with its id. */
  entries: StoredOption[];
  rows: PipelineOptionRow[];
  fieldId: string | null;
  spec: PipelineListSpec;
};

/** The colour lands in a style attribute and a swatch mix, so only a hex colour is taken. */
function colourFor(listId: PipelineListId, value: string, color: string | null): string {
  if (listId === "opportunity-stages") return stageColor(value, color);
  return color && /^#[0-9a-f]{6}$/i.test(color.trim()) ? color.trim().toLowerCase() : STAGE_FALLBACK_COLOR;
}

function renameNote(spec: PipelineListSpec): string {
  if (spec.id === "opportunity-stages") {
    return "Renaming a stage moves every Opportunity already at it. Built-in stages keep their names and cannot be removed.";
  }
  if (spec.id === "project-type") {
    return "Renaming a type updates every Project that already has it. Built-in types keep their names and cannot be removed.";
  }
  return "Renaming a source updates every Client already recorded with it. Fiverr is built in: it keeps its name and cannot be removed.";
}

function removeConsequence(spec: PipelineListSpec, label: string): string {
  const back = `Adding “${label}” back restores it.`;
  if (spec.id === "opportunity-stages") {
    return `No Opportunity is changed. Opportunities already at “${label}” stay there and still show on the board, but no Opportunity can be moved to it. ${back}`;
  }
  if (spec.id === "project-type") {
    return `No Project is changed. Projects already typed “${label}” keep it, but it is no longer offered as a Project type. ${back}`;
  }
  return `No Client is changed. Clients already recorded from “${label}” keep it, but it is no longer offered as a Source. ${back}`;
}

function listRows(spec: PipelineListSpec, entries: StoredOption[]): PipelineOptionRow[] {
  const all = entries.map((entry, index) => ({
    index,
    entry,
    role: spec.id === "opportunity-stages" ? stageRole(entry.value) : ("open" as StageRole),
  }));
  const shown = all.filter((item) => item.role !== "follow-on");
  const movable = shown.filter((item) => item.role === "open");
  return shown.map((item) => {
    const position = movable.indexOf(item);
    const outcome = item.role === "outcome";
    const locked = spec.builtIn.locked.includes(item.entry.value);
    return {
      index: item.index,
      id: item.entry.id,
      value: item.entry.value,
      label: item.entry.label,
      color: colourFor(spec.id, item.entry.value, item.entry.color),
      outcome,
      builtIn: locked,
      canMoveUp: !outcome && position > 0,
      canMoveDown: !outcome && position < movable.length - 1,
      canRemove: !locked && !outcome && movable.length > 1,
      removeConsequence: removeConsequence(spec, item.entry.label),
    };
  });
}

export function composePipelineLists(modules: CrmModuleWithFields[]): PipelineListModel[] {
  return PIPELINE_LISTS.map((spec) => {
    const mod = modules.find((row) => row.slug === spec.builtIn.module.slug) ?? null;
    const field = mod?.fields?.find((row) => row.slug === spec.builtIn.field.slug) ?? null;
    const stored = field?.options ?? [];
    const saved = stored.length > 0;
    const entries = parseFieldOptions(saved ? stored : defaultFieldOptions(spec.builtIn));
    return {
      id: spec.id,
      title: spec.title,
      sub: spec.sub,
      noun: spec.noun,
      saved,
      unsavedNote: saved
        ? null
        : "Not saved for this Workspace yet: these are the defaults every screen falls back to. The first change saves the list.",
      renameNote: renameNote(spec),
      entries,
      rows: listRows(spec, entries),
      fieldId: field?.id ?? null,
      spec,
    };
  });
}

export type PipelineEdit = { ok: true; options: string[] } | { ok: false; reason: string };

function stored(entries: StoredOption[]): string[] {
  return entries.map(serializeFieldOption);
}

function labelIssue(list: PipelineListModel, label: string, exceptIndex: number | null): string | null {
  const value = optionValue(label);
  if (!label) return `Name the ${list.noun}.`;
  if (!value) return "Use at least one letter or number.";
  if (value.length > OPTION_VALUE_MAX) return `Keep the name under ${OPTION_VALUE_MAX} characters.`;
  if (list.id === "opportunity-stages" && stageRole(value) !== "open") {
    return "Won and Lost are fixed outcomes. Name an open stage.";
  }
  const taken = list.entries.some((entry, index) => index !== exceptIndex && entry.value === value);
  if (taken) return `“${label}” is already in this list.`;
  return null;
}

function unusedColour(list: PipelineListModel): string {
  const used = new Set(list.entries.map((entry) => entry.color?.toLowerCase()));
  return PIPELINE_COLOURS.find((colour) => !used.has(colour.hex))?.hex ?? STAGE_FALLBACK_COLOR;
}

export function addPipelineOption(list: PipelineListModel, input: string): PipelineEdit {
  const label = input.trim();
  const issue = labelIssue(list, label, null);
  if (issue) return { ok: false, reason: issue };
  // No id: the server gives a new option one.
  const entry: StoredOption = { id: "", label, value: optionValue(label), color: unusedColour(list) };
  const entries = [...list.entries];
  // A new stage joins the open stages, ahead of Won and Lost.
  const lastOpen = list.id === "opportunity-stages"
    ? Math.max(-1, ...list.rows.filter((row) => !row.outcome).map((row) => row.index))
    : entries.length - 1;
  entries.splice(lastOpen + 1, 0, entry);
  return { ok: true, options: stored(entries) };
}

export function renamePipelineOption(list: PipelineListModel, index: number, input: string): PipelineEdit {
  const row = list.rows.find((candidate) => candidate.index === index);
  if (!row || row.outcome) return { ok: false, reason: "Won and Lost keep their names." };
  if (row.builtIn) return { ok: false, reason: `“${row.label}” is built in and keeps its name.` };
  const label = input.trim();
  const issue = labelIssue(list, label, index);
  if (issue) return { ok: false, reason: issue };
  const entries = [...list.entries];
  entries[index] = { ...entries[index], label, value: optionValue(label), color: row.color };
  return { ok: true, options: stored(entries) };
}

export function recolourPipelineOption(list: PipelineListModel, index: number, color: string): PipelineEdit {
  const row = list.rows.find((candidate) => candidate.index === index);
  if (!row) return { ok: false, reason: "That option is no longer in the list." };
  const entries = [...list.entries];
  entries[index] = { ...entries[index], color };
  return { ok: true, options: stored(entries) };
}

export function movePipelineOption(list: PipelineListModel, index: number, direction: -1 | 1): PipelineEdit {
  const movable = list.rows.filter((row) => !row.outcome);
  const position = movable.findIndex((row) => row.index === index);
  const neighbour = movable[position + direction];
  if (position < 0 || !neighbour) return { ok: false, reason: "That option cannot move further." };
  const entries = [...list.entries];
  [entries[index], entries[neighbour.index]] = [entries[neighbour.index], entries[index]];
  return { ok: true, options: stored(entries) };
}

export function removePipelineOption(list: PipelineListModel, index: number): PipelineEdit {
  const row = list.rows.find((candidate) => candidate.index === index);
  if (!row || !row.canRemove) {
    if (row?.outcome) return { ok: false, reason: "Won and Lost cannot be removed." };
    if (row?.builtIn) return { ok: false, reason: `“${row.label}” is built in and cannot be removed.` };
    return { ok: false, reason: `Keep at least one ${list.noun}.` };
  }
  return { ok: true, options: stored(list.entries.filter((_, position) => position !== index)) };
}

export function adminModulesPath(): string {
  return "/api/admin/modules";
}

export function adminFieldPath(id: string): string {
  return `/api/admin/fields/${id}`;
}

export const ENSURE_SYSTEM_LISTS_PATH = "/api/admin/system-lists/ensure";

/** Every read of these lists: this tab, and the consumers on Opportunities, Projects and Clients. */
export const PIPELINE_LIST_QUERY_KEYS = [
  [adminModulesPath()],
  ["/api/modules/projects/fields"],
  ["/api/modules/contacts/fields"],
];

export type PipelineSend = (method: "POST" | "PATCH", path: string, body: Record<string, unknown>) => Promise<unknown>;

/**
 * Stores one edit. A list the Workspace never saved is created first by the
 * server, with the same defaults and ids this tab showed, so the edit reads
 * against exactly what the Administrator saw.
 */
export async function savePipelineList(list: PipelineListModel, edit: { options: string[] }, send: PipelineSend): Promise<void> {
  let fieldId = list.saved ? list.fieldId : null;
  if (!fieldId) {
    const modules = (await send("POST", ENSURE_SYSTEM_LISTS_PATH, {})) as CrmModuleWithFields[] | null;
    const mod = modules?.find((row) => row.slug === list.spec.builtIn.module.slug);
    fieldId = mod?.fields?.find((row) => row.slug === list.spec.builtIn.field.slug)?.id ?? null;
    if (!fieldId) throw new Error("The list could not be created.");
  }
  await send("PATCH", adminFieldPath(fieldId), { options: edit.options });
}
