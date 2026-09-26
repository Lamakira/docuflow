/**
 * The option lists records read their values from: the `projects` module's
 * `status` (Opportunity Stages and the combined Project status) and
 * `project_type`, and the `contacts` module's `source`.
 *
 * An option is stored in `crm_module_fields.options` as a JSON string
 * `{ id, label, color }`. Older entries are `{ label, color }` or a plain label;
 * they read back with an id derived from their value, so the same array always
 * yields the same ids. Records store the value, derived from the label, so a
 * rename is an option that keeps its id and changes its value.
 */

export type StoredOption = { id: string; label: string; value: string; color: string | null };

export type BuiltInListKey = "opportunity-stages" | "project-type" | "source";

export type BuiltInModuleSpec = {
  name: string;
  slug: "projects" | "contacts";
  description: string;
  icon: string;
  displayOrder: number;
};

export type BuiltInList = {
  key: BuiltInListKey;
  module: BuiltInModuleSpec;
  field: { name: string; slug: string; displayOrder: number; isRequired: number };
  defaults: Array<{ label: string; color: string }>;
  /**
   * Values the code reads by name. They can be recoloured, moved or relabelled
   * to the same value, never renamed to another value or removed.
   */
  locked: readonly string[];
};

/** The longest value `crm_projects.status`, `project_type` and `crm_clients.source` hold. */
export const OPTION_VALUE_MAX = 50;

const PROJECTS_MODULE: BuiltInModuleSpec = {
  name: "Projects",
  slug: "projects",
  description: "Project management and tracking",
  icon: "folder",
  displayOrder: 1,
};

const CONTACTS_MODULE: BuiltInModuleSpec = {
  name: "Contacts",
  slug: "contacts",
  description: "Client and contact management",
  icon: "users",
  displayOrder: 2,
};

/**
 * Each default names the value `scripts/seed-defaults.ts` and the v1 fallbacks
 * store, so a saved default reads back as the same value on every record.
 */
export const BUILT_IN_LISTS: readonly BuiltInList[] = [
  {
    key: "opportunity-stages",
    module: PROJECTS_MODULE,
    field: { name: "Status", slug: "status", displayOrder: 2, isRequired: 1 },
    defaults: [
      { label: "Lead", color: "#ec4899" },
      { label: "Discovering call completed", color: "#8b5cf6" },
      { label: "Proposal sent", color: "#f59e0b" },
      { label: "Follow up", color: "#06b6d4" },
      { label: "In negotiation", color: "#3b82f6" },
      { label: "Won", color: "#22c55e" },
      { label: "Won - Not started", color: "#6366f1" },
      { label: "Won - In progress", color: "#14b8a6" },
      { label: "Won - In review", color: "#0ea5e9" },
      { label: "Won - Completed", color: "#84cc16" },
      { label: "Lost", color: "#ef4444" },
      { label: "Won - Cancelled", color: "#f43f5e" },
    ],
    // `lead` is the default stage of every new Opportunity; Won and Lost close
    // the pipeline; the `won_*` statuses drive the Project lifecycle after a win.
    locked: [
      "lead",
      "won",
      "lost",
      "won_not_started",
      "won_in_progress",
      "won_in_review",
      "won_completed",
      "won_cancelled",
    ],
  },
  {
    key: "project-type",
    module: PROJECTS_MODULE,
    field: { name: "Project Type", slug: "project_type", displayOrder: 3, isRequired: 0 },
    defaults: [
      { label: "One-time", color: "#3b82f6" },
      { label: "Monthly", color: "#8b5cf6" },
      { label: "Hourly budget", color: "#f59e0b" },
      { label: "Internal", color: "#64748b" },
    ],
    // `one_time` is the default; `monthly` and `hourly_budget` set due dates;
    // `internal` marks a Project that has no Opportunity.
    locked: ["one_time", "monthly", "hourly_budget", "internal"],
  },
  {
    key: "source",
    module: CONTACTS_MODULE,
    field: { name: "Source", slug: "source", displayOrder: 11, isRequired: 0 },
    defaults: [
      { label: "Fiverr", color: "#1dbf73" },
      { label: "Zoho", color: "#e42527" },
      { label: "Direct", color: "#3b82f6" },
    ],
    // A `fiverr` Client carries a Fiverr username.
    locked: ["fiverr"],
  },
];

export function builtInList(moduleSlug: string | null | undefined, fieldSlug: string | null | undefined): BuiltInList | null {
  return BUILT_IN_LISTS.find((list) => list.module.slug === moduleSlug && list.field.slug === fieldSlug) ?? null;
}

/** The value a record stores for an option, derived from its label as v1 and the server do. */
export function optionValue(label: string): string {
  return label.toLowerCase().replace(/[\s-]+/g, "_").replace(/[^a-z0-9_]/g, "");
}

type OptionEntry = { id: string | null; label: string; color: string | null };

function readEntry(raw: string): OptionEntry {
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object" && parsed.label) {
      return {
        id: typeof parsed.id === "string" && parsed.id ? parsed.id : null,
        label: String(parsed.label),
        color: typeof parsed.color === "string" ? parsed.color : null,
      };
    }
  } catch {
    /* a plain-string option */
  }
  return { id: null, label: raw, color: null };
}

function freshId(value: string, taken: Set<string>): string {
  const base = value || "option";
  let id = base;
  for (let suffix = 2; taken.has(id); suffix += 1) id = `${base}_${suffix}`;
  taken.add(id);
  return id;
}

/** Stored options with their ids; an entry saved without one gets its value, suffixed if taken. */
export function parseFieldOptions(raw: readonly string[] | null | undefined): StoredOption[] {
  const entries = (raw ?? []).map(readEntry);
  const taken = new Set<string>();
  const ids = entries.map((entry) => {
    if (!entry.id || taken.has(entry.id)) return null;
    taken.add(entry.id);
    return entry.id;
  });
  return entries.map((entry, index) => {
    const value = optionValue(entry.label);
    return { id: ids[index] ?? freshId(value, taken), label: entry.label, value, color: entry.color };
  });
}

export function serializeFieldOption(option: { id?: string | null; label: string; color?: string | null }): string {
  return JSON.stringify({
    ...(option.id ? { id: option.id } : {}),
    label: option.label,
    ...(option.color ? { color: option.color } : {}),
  });
}

/** A built-in list's defaults as stored; the ids are the values, as a backfill would give them. */
export function defaultFieldOptions(list: BuiltInList): string[] {
  return list.defaults.map((option) =>
    serializeFieldOption({ id: optionValue(option.label), label: option.label, color: option.color }),
  );
}

export type OptionRename = { from: string; to: string };

export type OptionsChange =
  | { ok: true; options: string[]; renames: OptionRename[] }
  | { ok: false; message: string };

/**
 * Reads a new options array against the stored one. An option keeps its id
 * when it sends one; without one it takes the id of the stored option with the
 * same value, or a new id. Only an option whose id is kept and whose value
 * changes is a rename; moving, adding or removing options renames nothing.
 */
export function diffFieldOptions(
  previous: readonly string[] | null | undefined,
  next: unknown,
  list: BuiltInList | null,
): OptionsChange {
  if (!Array.isArray(next) || next.some((entry) => typeof entry !== "string")) {
    return { ok: false, message: "Options must be a list of strings." };
  }
  const before = parseFieldOptions(previous);
  const entries = (next as string[]).map(readEntry).map((entry) => ({ ...entry, label: entry.label.trim() }));

  const taken = new Set(before.map((option) => option.id));
  const claimed = new Set<string>();
  for (const entry of entries) {
    if (!entry.id) continue;
    if (claimed.has(entry.id)) return { ok: false, message: "Two options share one id." };
    claimed.add(entry.id);
    taken.add(entry.id);
  }

  const after: StoredOption[] = [];
  for (const entry of entries) {
    const value = optionValue(entry.label);
    if (!value) return { ok: false, message: "Every option needs a name with a letter or number." };
    if (list && value.length > OPTION_VALUE_MAX) {
      return { ok: false, message: `Keep “${entry.label}” under ${OPTION_VALUE_MAX} characters.` };
    }
    let id = entry.id;
    if (!id) {
      const match = before.find((option) => option.value === value && !claimed.has(option.id));
      id = match ? match.id : freshId(value, taken);
      claimed.add(id);
    }
    after.push({ id, label: entry.label, value, color: entry.color });
  }

  const values = new Set<string>();
  for (const option of after) {
    if (values.has(option.value)) return { ok: false, message: `“${option.label}” is in the list twice.` };
    values.add(option.value);
  }

  for (const option of before) {
    if (!list?.locked.includes(option.value)) continue;
    const kept = after.find((candidate) => candidate.id === option.id);
    if (!kept) return { ok: false, message: `“${option.label}” is built in and cannot be removed.` };
    if (kept.value !== option.value) {
      return { ok: false, message: `“${option.label}” is built in and cannot be renamed.` };
    }
  }

  const renames: OptionRename[] = [];
  for (const option of after) {
    const old = before.find((candidate) => candidate.id === option.id);
    if (old && old.value !== option.value) renames.push({ from: old.value, to: option.value });
  }
  return { ok: true, options: after.map(serializeFieldOption), renames };
}
