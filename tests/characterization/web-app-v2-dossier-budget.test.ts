import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { composeDossier, DOSSIER_FIELD, type DossierInput } from "../../client/src/v2/dossier";
import {
  budgetLabel,
  composeBudgetForm,
  newProjectPayload,
  projectBudgetDraft,
  projectBudgetPercent,
  readProjectBudget,
  EMPTY_PROJECT_BUDGET_DRAFT,
} from "../../client/src/v2/projects";
import { budgetedHoursTotal } from "../../client/src/v2/today";

/**
 * Project Dossier budget, Settings groups, empty states and the Task row (#277).
 * Seams: the budget composers in projects.ts, composeDossier, and the source and
 * CSS shape of V2Dossier / V2Projects. The budget reuses v1's routes.
 */

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
const read = (path: string) => readFileSync(join(root, path), "utf8");
const dossierSource = read("client/src/v2/V2Dossier.tsx");
const projectsSource = read("client/src/v2/V2Projects.tsx");
const routesSource = read("server/routes.ts");
const css = read("client/src/v2/tokens.css").replace(/\/\*[\s\S]*?\*\//g, "");

function rule(selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = css.match(new RegExp(`${escaped}\\s*\\{([^}]*)\\}`));
  if (!match) throw new Error(`missing rule ${selector}`);
  return match[1];
}

function input(overrides: Partial<DossierInput> = {}): DossierInput {
  return {
    now: new Date(2026, 8, 8, 12, 41, 0),
    currentUserId: "user-1",
    tab: "overview",
    project: {
      id: "prj-live",
      projectStatus: "active",
      projectType: "one_time",
      budgetedHours: 40,
      budgetedMinutes: 0,
      actualHours: 30,
      project: { id: "doc-1", name: "Onboarding" },
      client: { id: "cli-1", name: "Harbor Co" },
      documentationEnabled: 1,
    },
    tasks: [],
    documents: [],
    dailyUpdate: null,
    dailyUpdateCapabilityMiss: false,
    ownerName: null,
    monthSeconds: 0,
    screenshots: [],
    users: [],
    trackingTaskId: null,
    clientActiveProjectCount: 0,
    timeEntries: [],
    dailyUpdates: [],
    files: [],
    reminders: [],
    notes: [],
    stageHistory: [],
    tags: [],
    workspaceTags: [],
    ...overrides,
  };
}

describe("a Project's budget reads and writes hours and minutes (#277)", () => {
  it("parses a draft into budgetedHours and budgetedMinutes, a blank or zero budget into none", () => {
    expect(readProjectBudget({ hours: "120", minutes: "30" })).toEqual({
      budget: { budgetedHours: 120, budgetedMinutes: 30 },
      issue: null,
    });
    expect(readProjectBudget({ hours: "", minutes: "45" }).budget).toEqual({ budgetedHours: 0, budgetedMinutes: 45 });
    expect(readProjectBudget(EMPTY_PROJECT_BUDGET_DRAFT).budget).toEqual({ budgetedHours: null, budgetedMinutes: 0 });
    expect(readProjectBudget({ hours: "0", minutes: "0" }).budget).toEqual({ budgetedHours: null, budgetedMinutes: 0 });
  });

  it("names what does not read, rather than saving it", () => {
    expect(readProjectBudget({ hours: "1.5", minutes: "" }).issue).toMatch(/hours must be a whole number/i);
    expect(readProjectBudget({ hours: "-2", minutes: "" }).issue).toMatch(/hours/i);
    expect(readProjectBudget({ hours: "2", minutes: "60" }).issue).toMatch(/minutes must be a whole number from 0 to 59/i);
  });

  it("drafts a saved budget back into the fields, and labels it in hours and minutes", () => {
    expect(projectBudgetDraft({ budgetedHours: 120, budgetedMinutes: 30 })).toEqual({ hours: "120", minutes: "30" });
    expect(projectBudgetDraft({ budgetedHours: 120, budgetedMinutes: 0 })).toEqual({ hours: "120", minutes: "" });
    expect(projectBudgetDraft({ budgetedHours: null, budgetedMinutes: 0 })).toEqual(EMPTY_PROJECT_BUDGET_DRAFT);
    expect(budgetLabel({ budgetedHours: 120, budgetedMinutes: 30 })).toBe("120 h 30 min");
    expect(budgetLabel({ budgetedHours: 0, budgetedMinutes: 45 })).toBe("45 min");
    expect(budgetLabel({ budgetedHours: null })).toBe("No budget");
  });

  it("saves only a change, and says so in the form's footer", () => {
    const saved = { budgetedHours: 40, budgetedMinutes: 0 };
    const unchanged = composeBudgetForm({ hours: "40", minutes: "" }, saved);
    expect(unchanged).toMatchObject({ dirty: false, canSave: false, note: "Budget 40 h." });
    const changed = composeBudgetForm({ hours: "42", minutes: "15" }, saved);
    expect(changed).toMatchObject({ dirty: true, canSave: true, note: "Unsaved changes." });
    expect(changed.payload).toEqual({ budgetedHours: 42, budgetedMinutes: 15 });
    const cleared = composeBudgetForm(EMPTY_PROJECT_BUDGET_DRAFT, saved);
    expect(cleared.payload).toEqual({ budgetedHours: null, budgetedMinutes: 0 });
    const broken = composeBudgetForm({ hours: "4x", minutes: "" }, saved);
    expect(broken.canSave).toBe(false);
    expect(broken.issue).toBeTruthy();
    expect(composeBudgetForm(EMPTY_PROJECT_BUDGET_DRAFT, { budgetedHours: null }).note).toBe("No budget set.");
  });

  it("New Project posts the name, and the budget only when one was given", () => {
    expect(newProjectPayload("  Onboarding ", EMPTY_PROJECT_BUDGET_DRAFT)).toEqual({ name: "Onboarding" });
    expect(newProjectPayload("Onboarding", { hours: "40", minutes: "30" })).toEqual({
      name: "Onboarding",
      budgetedHours: 40,
      budgetedMinutes: 30,
    });
    expect(newProjectPayload("", { hours: "40", minutes: "" })).toBeNull();
    expect(newProjectPayload("Onboarding", { hours: "40", minutes: "75" })).toBeNull();

    expect(projectsSource).toContain('apiRequest("POST", "/api/crm/projects", payload)');
    expect(projectsSource).toContain('aria-label="Budget hours"');
    expect(projectsSource).toContain('aria-label="Budget minutes"');
    expect(projectsSource).toContain("canSubmit={newProjectPayload(name, budgetDraft) !== null}");
  });

  it("Settings writes the budget through the route v1's Project page used", () => {
    expect(dossierSource).toMatch(/saveBudget = useMutation\(\{\s*mutationFn: \(budget[^)]*\) =>\s*apiRequest\("PATCH", `\/api\/crm\/projects\/\$\{projectId\}`, budget\)/);
    // Both routes accept the minutes the model has; neither silently drops them.
    const minutes = routesSource.match(/budgetedMinutes: z\.number\(\)\.int\(\)\.min\(0\)\.max\(59\)\.nullable\(\)\.optional\(\)/g) ?? [];
    expect(minutes).toHaveLength(2);
    expect(routesSource).toContain("budgetedMinutes: parsed.data.budgetedMinutes ?? 0");
  });

  it("the meters and figures read hours and minutes back", () => {
    expect(budgetedHoursTotal({ budgetedHours: 40, budgetedMinutes: 30 })).toBe(40.5);
    expect(projectBudgetPercent({ budgetedHours: 40, budgetedMinutes: 0, actualHours: 30 })).toBe(75);
    expect(projectBudgetPercent({ budgetedHours: null, budgetedMinutes: 0, actualHours: 30 })).toBeNull();

    const base = input();
    const dossier = composeDossier({
      ...base,
      project: { ...base.project!, budgetedHours: 0, budgetedMinutes: 30, actualHours: 0 },
    });
    expect(dossier.stats.budgetPercent).toBe(0);
    expect(dossier.stats.planHours).toBe("0.5 h");
    expect(dossier.settings.budget.draft).toEqual({ hours: "0", minutes: "30" });

    const set = composeDossier(input({ tab: "settings" }));
    expect(set.stats.budgetPercent).toBe(75);
    expect(set.budgetTime.consumedLabel).toBe("30.0 h / 40.0 h");
    expect(set.settings.budget.consumed).toBe("30.0 h of 40 h · 75% used");
    expect(set.settings.budget.saved).toEqual({ budgetedHours: 40, budgetedMinutes: 0 });
  });
});

describe("Dossier Settings reads as labelled groups (#277)", () => {
  it("draws identity, lifecycle, budget, team, documentation and the danger zone as cards", () => {
    for (const group of ["identity", "lifecycle", "budget", "team", "documentation", "danger"]) {
      expect(dossierSource).toContain(`testId="v2-dossier-settings-${group}"`);
    }
    // The old single card of key-value pairs spread to both edges is gone.
    expect(dossierSource).not.toContain("df-settings-fields");
    expect(dossierSource).not.toContain("settings.fields");
  });

  it("puts every label in one fixed column, so labels and values line up", () => {
    expect(rule(".df-settings-row")).toMatch(/grid-template-columns:\s*160px minmax\(0, 1fr\)/);
    expect(rule(".df-settings-row")).toMatch(/min-height:\s*calc\(var\(--df-control-h\)/);
    expect(rule(".df-settings-label")).toMatch(/var\(--df-archive-slate\)/);
    expect(rule(".df-settings-value input")).toMatch(/height:\s*var\(--df-control-h\)/);
    expect(rule(".df-settings-value .df-select-trigger")).toMatch(/height:\s*var\(--df-control-h\)/);
  });

  it("uses the v2 select inside a field, with no prefix and a name for screen readers", () => {
    expect(dossierSource).toMatch(/<V2FilterSelect\s+label=""\s+ariaLabel="Project lead"/);
    expect(dossierSource).toMatch(/<V2FilterSelect\s+label=""\s+ariaLabel="Add Project Assignment"/);
  });

  it("asks before deleting a Project, and names everything the delete takes", () => {
    const dossier = composeDossier(input({ tab: "settings" }));
    expect(dossier.settings.deleteConsequence).toContain("Onboarding");
    expect(dossier.settings.deleteConsequence).toMatch(/Tasks, Time Entries, Notes, Reminders and Project Documents/);
    expect(dossier.settings.deleteConsequence).toContain("cannot be undone");
    expect(dossierSource).toContain('apiRequest("DELETE", `/api/crm/projects/${projectId}`)');
    const danger = dossierSource.slice(dossierSource.indexOf('title="Danger zone"'));
    expect(danger).toMatch(/<AlertDialog>[\s\S]*<AlertDialogTrigger asChild>[\s\S]*variant="destructiveOutline"/);
    expect(rule(".df-settings-danger .df-card-title")).toMatch(/var\(--df-destructive\)/);
    expect(rule(".df-settings-danger")).toMatch(/var\(--df-alert-line\)/);
  });

  it("composes the lifecycle from the Project and its latest Status change", () => {
    const dossier = composeDossier(
      input({
        tab: "settings",
        stageHistory: [
          {
            id: "h1",
            fromStatus: "won_in_progress",
            toStatus: "won_in_review",
            changedAt: new Date(2026, 8, 7, 10, 0, 0),
            changedBy: { firstName: "Pat", lastName: "Ng" },
          },
        ],
      }),
    );
    expect(dossier.settings.lifecycle.rows.find((row) => row.label === "LAST CHANGE")?.value).toBe("07 SEP · Pat Ng");
    expect(dossier.settings.lifecycle.rows[0]).toMatchObject({ label: "STATUS", value: "ACTIVE", chip: true });
    expect(dossier.settings.lifecycle.note).toMatch(/Projects board/);
  });
});

describe("every Dossier tab empties into a designed empty state (#277)", () => {
  const TABS = ["tasks", "notes", "files", "documents", "reminders", "time"] as const;

  it("says what each tab holds and offers the action that adds the first item", () => {
    const dossier = composeDossier(input());
    for (const tab of TABS) {
      const state = dossier[tab].emptyState;
      expect(state.title, tab).toBeTruthy();
      expect(state.copy.length, tab).toBeGreaterThan(40);
      expect(state.action, tab).not.toBeNull();
    }
    expect(dossier.tasks.emptyState.action).toEqual({
      kind: "focus",
      label: "Create the first Task",
      target: DOSSIER_FIELD.taskName,
    });
    expect(dossier.notes.emptyState.action).toMatchObject({ kind: "focus", target: DOSSIER_FIELD.note });
    expect(dossier.reminders.emptyState.action).toMatchObject({ kind: "focus", target: DOSSIER_FIELD.reminderTitle });
    expect(dossier.time.emptyState.action).toEqual({ kind: "start-timer", label: "Start Timer" });
    expect(dossier.files.emptyState.action).toMatchObject({ kind: "link", href: "/projects/prj-live/notes" });
    expect(dossier.documents.emptyState.action).toEqual({ kind: "new-document", label: "New Document" });
  });

  it("sends an empty Documents tab to Settings while Documentation is off", () => {
    const base = input();
    const off = composeDossier({ ...base, project: { ...base.project!, documentationEnabled: 0 } });
    expect(off.documents.canCreate).toBe(false);
    expect(off.documents.emptyState.title).toBe("Documentation is off");
    expect(off.documents.emptyState.action).toMatchObject({ kind: "link", href: "/projects/prj-live/settings" });
  });

  it("renders all six through one shared component, not six bare lines", () => {
    expect(dossierSource).toContain('from "./V2EmptyState"');
    // The Overview's Documents summary card keeps its one-line empty copy; the tabs do not.
    const tabBodies = dossierSource.slice(dossierSource.indexOf("function DossierTasks("));
    for (const tab of TABS) {
      expect(dossierSource, tab).toContain(`state={dossier.${tab}.emptyState}`);
      expect(tabBodies, tab).not.toContain(`<p className="df-empty">{dossier.${tab}.emptyCopy}</p>`);
    }
    // Each focus target is a real field on its tab.
    for (const key of ["taskName", "note", "reminderTitle"] as const) {
      expect(dossierSource).toContain(`id={DOSSIER_FIELD.${key}}`);
    }
    // The empty Documents tab creates in a dialog, like every other New action.
    expect(dossierSource).toContain('testId="v2-dossier-new-document"');
    expect(dossierSource).toContain("apiRequest(\"POST\", `/api/projects/${projectRecordId}/documents`");
  });

  it("draws the empty state on tokens that hold in both palettes, and never animates it in", () => {
    const panel = rule(".df-empty-panel");
    expect(panel).toMatch(/animation:\s*none/);
    expect(panel).toMatch(/padding:\s*var\(--df-space-8\) var\(--df-space-6\)/);
    expect(rule(".df-empty-panel-icon")).toMatch(/var\(--df-cold-stock\)/);
    expect(rule(".df-empty-panel-title")).toMatch(/var\(--df-case-ink\)/);
    expect(rule(".df-empty-panel-copy")).toMatch(/var\(--df-archive-slate\)/);
    for (const selector of [".df-empty-panel", ".df-empty-panel-icon", ".df-empty-panel-title", ".df-empty-panel-copy"]) {
      expect(rule(selector), selector).not.toMatch(/#[0-9a-f]{3,8}\b/i);
    }
  });
});

describe("a Task row sits on one axis with matching controls (#277)", () => {
  it("draws the tick as a centred icon in paper on the green badge, not a text glyph", () => {
    expect(dossierSource).not.toContain('"✓"');
    expect(dossierSource).toContain("{row.done ? <TaskCheckIcon /> : null}");
    const icons = read("client/src/v2/icons.tsx");
    expect(icons).toMatch(/export function TaskCheckIcon\(\)[\s\S]*?tone\("--df-fill-paper"\)/);
    // `.df-v2 button:not(.df-btn)` resets font and colour; the badge must outrank it.
    const check = rule(".df-v2 button.df-check");
    expect(check).toMatch(/place-items:\s*center/);
    expect(check).toMatch(/color:\s*var\(--df-fill-paper\)/);
    expect(rule('.df-check[data-checked="true"]')).toMatch(/var\(--df-signed-off\)/);
  });

  it("gives the status control and Start Timer one height, radius, padding and case", () => {
    expect(dossierSource).toContain('<span className="df-task-controls">');
    const shared = rule(
      ".df-v2 .df-task-controls > .df-select-trigger,\n.df-v2 .df-task-controls > button.df-btn,\n.df-v2 .df-task-controls > .df-flag",
    );
    expect(shared).toMatch(/height:\s*var\(--df-control-h\)/);
    expect(shared).toMatch(/padding:\s*0 var\(--df-space-3\)/);
    expect(shared).toMatch(/border-radius:\s*var\(--df-radius-2\)/);
    const face = rule(".df-v2 .df-task-controls > .df-select-trigger,\n.df-v2 .df-task-controls > button.df-btn");
    expect(face).toMatch(/font-family:\s*var\(--df-font-ui\)/);
    expect(face).toMatch(/border:\s*1px solid var\(--df-divider\)/);
    expect(rule(".df-task-controls")).toMatch(/align-items:\s*center/);
  });
});
