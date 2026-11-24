import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  composeDossier,
  DOSSIER_HISTORY_PREVIEW,
  dossierRedirect,
  type DossierInput,
  type DossierStageChange,
} from "../../client/src/v2/dossier";
import { projectStatusColor } from "../../client/src/v2/palette";
import { breadcrumbFor } from "../../client/src/v2/presentation";
import { projectBudgetPercent } from "../../client/src/v2/projects";
import { readActivityFilters } from "../../client/src/v2/activity";

/**
 * The Dossier review (F44-F51, 2026-11-23). Seams: composeDossier and the
 * pure helpers beside it, the breadcrumb composer, and the source and CSS
 * shape of V2Dossier / V2CommandBar / V2Activity.
 */

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
const read = (path: string) => readFileSync(join(root, path), "utf8");
const dossierSource = read("client/src/v2/V2Dossier.tsx");
const commandBarSource = read("client/src/v2/V2CommandBar.tsx");
const css = read("client/src/v2/tokens.css").replace(/\/\*[\s\S]*?\*\//g, "");

function rule(selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = css.match(new RegExp(`(?:^|\\n)${escaped}\\s*\\{([^}]*)\\}`));
  if (!match) throw new Error(`missing rule ${selector}`);
  return match[1];
}

const HOUR = 3600;

function input(overrides: Partial<DossierInput> = {}): DossierInput {
  return {
    now: new Date(2026, 10, 23, 12, 0, 0),
    currentUserId: "user-1",
    tab: "overview",
    project: {
      id: "prj-live",
      projectStatus: "active",
      status: "won_in_progress",
      projectType: "one_time",
      budgetedHours: 80,
      budgetedMinutes: 0,
      trackedSeconds: 25 * HOUR,
      project: { id: "doc-1", name: "Ledger migration" },
      client: { id: "cli-1", name: "Caldera Health" },
      documentationEnabled: 1,
    },
    tasks: [],
    documents: [],
    dailyUpdate: null,
    dailyUpdateCapabilityMiss: false,
    ownerName: null,
    monthSeconds: 20.5 * HOUR,
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

function change(id: string, fromStatus: string | null, toStatus: string, day: number): DossierStageChange {
  return { id, fromStatus, toStatus, changedAt: new Date(2026, 10, day, 12, 0, 0), changedBy: null };
}

function tabCount(dossier: ReturnType<typeof composeDossier>, id: string): string | null | undefined {
  return dossier.tabs.find((tab) => tab.id === id)?.count;
}

describe("Dossier review (F44-F51)", () => {
  describe("F44: budget consumed is the Project's tracked time", () => {
    it("reads trackedSeconds and ignores the v1 typed actualHours", () => {
      const typed = { budgetedHours: 40, budgetedMinutes: 0, actualHours: 30 } as Parameters<typeof projectBudgetPercent>[0];
      // No trackedSeconds (a Member is not sent it): unknown, not 0%.
      expect(projectBudgetPercent(typed)).toBeNull();
      expect(projectBudgetPercent({ budgetedHours: 40, budgetedMinutes: 0, trackedSeconds: 30 * HOUR })).toBe(75);
      expect(projectBudgetPercent({ budgetedHours: 10, budgetedMinutes: 0, trackedSeconds: 14.1 * HOUR })).toBe(141);
      expect(projectBudgetPercent({ budgetedHours: null, budgetedMinutes: 0, trackedSeconds: 30 * HOUR })).toBeNull();
    });

    it("gives every meter the total tracked: header, Overview and Settings", () => {
      const base = input();
      const dossier = composeDossier({
        ...base,
        // A typed v1 figure is no longer read anywhere.
        project: { ...base.project!, actualHours: 70 } as DossierInput["project"],
      });
      expect(dossier.stats.budgetPercent).toBe(31);
      expect(dossier.stats.tracked).toBe("25.0 h");
      expect(dossier.stats.trackedSub).toBe("of 80.0 h budget");
      expect(dossier.budgetTime).toEqual({
        consumedLabel: "25.0 h / 80.0 h",
        percent: 31,
        trackedThisMonth: "20.5 h",
        unapproved: null,
      });
      expect(dossier.settings.budget.consumed).toBe("25.0 h of 80 h · 31% used");
      // One block in the header: the figure, its budget and its percent over a meter that has a size.
      expect(dossierSource.match(/data-testid="v2-dossier-budget"/g)).toHaveLength(1);
      expect(dossierSource).not.toContain('<div className="df-mono df-meta">Tracked</div>');
      expect(read("client/src/v2/tokens.css")).toMatch(/\n\.df-meter \{[^}]*display:\s*block/);
      expect(dossierSource).not.toContain("Tracked MTD");
      expect(dossierSource).not.toContain("actualHours");
    });

    it("reads every meter as unknown when trackedSeconds is absent (Members)", () => {
      const base = input();
      const { trackedSeconds: _omitted, ...rest } = base.project!;
      const dossier = composeDossier({ ...base, project: rest });
      expect(dossier.stats.budgetPercent).toBeNull();
      expect(dossier.stats.tracked).toBe("-");
      expect(dossier.stats.trackedSub).toBe("of 80.0 h budget");
      expect(dossier.budgetTime.percent).toBeNull();
      expect(dossier.budgetTime.consumedLabel).toBe("-");
      expect(dossier.budgetTime.trackedThisMonth).toBe("20.5 h");
      expect(dossier.settings.budget.consumed).toBe("-");
      const unbudgeted = composeDossier({ ...base, project: { ...rest, budgetedHours: null } });
      expect(unbudgeted.stats.tracked).toBe("-");
      expect(unbudgeted.stats.trackedSub).toBe("tracked · 20.5 h this month");
    });

    it("without a budget, the consumed label is the total and the header sub-line the month", () => {
      const base = input();
      const dossier = composeDossier({ ...base, project: { ...base.project!, budgetedHours: null } });
      expect(dossier.stats.budgetPercent).toBeNull();
      expect(dossier.stats.trackedSub).toBe("tracked · 20.5 h this month");
      expect(dossier.budgetTime.consumedLabel).toBe("25.0 h");
      expect(dossier.settings.budget.consumed).toBe("No budget set");
    });
  });

  describe("F45: Status history speaks in Project Status", () => {
    const realShaped = [
      change("sale", "lead", "proposal_sent", 1),
      change("signed", "in_negociation", "won", 2),
      change("started", "won", "won_in_progress", 3),
      change("review", "won_in_progress", "won_in_review_pm", 5),
      change("same", "won_in_review_pm", "won_in_review_client", 6),
    ];

    it("drops sales moves and same-status moves, and labels both ends like the header chip", () => {
      const dossier = composeDossier(input({ stageHistory: realShaped }));
      expect(dossier.history.rows.map((row) => [row.id, row.from, row.to])).toEqual([
        ["review", "ACTIVE", "IN REVIEW"],
        ["started", "PLANNED", "ACTIVE"],
        ["signed", null, "PLANNED"],
      ]);
      const [review, started, signed] = dossier.history.rows;
      expect(review.fromColor).toBe(projectStatusColor("active"));
      expect(review.toColor).toBe(projectStatusColor("in_review"));
      expect(started.fromColor).toBe(projectStatusColor("planned"));
      expect(signed.fromColor).toBeNull();
    });

    it("measures held over the filtered rows, and Settings' Last change reads them", () => {
      const dossier = composeDossier(input({ stageHistory: realShaped }));
      expect(dossier.history.rows.map((row) => [row.id, row.held])).toEqual([
        // The dropped In review → In review move on the 6th does not cut this span.
        ["review", "18 d so far"],
        ["started", "2 d"],
        ["signed", "1 d"],
      ]);
      const lastChange = dossier.settings.lifecycle.rows.find((row) => row.label === "Last change");
      expect(lastChange?.value).toBe(`${dossier.history.rows[0].when} · -`);
    });

    it("caps the Overview card at five rows with a Show all that expands in place", () => {
      const moves = Array.from({ length: 7 }, (_, index) =>
        change(`m${index}`, index % 2 ? "won_in_review_pm" : "won_in_progress", index % 2 ? "won_in_progress" : "won_in_review_pm", index + 1),
      );
      const dossier = composeDossier(input({ stageHistory: moves }));
      expect(dossier.history.rows).toHaveLength(7);
      expect(DOSSIER_HISTORY_PREVIEW).toBe(5);
      expect(dossierSource).toContain("dossier.history.rows.slice(0, DOSSIER_HISTORY_PREVIEW)");
      expect(dossierSource).toContain("Show all {dossier.history.rows.length}");
    });
  });

  describe("F47: a sale never opens as a Dossier", () => {
    it("sends an open or lost sale to its Opportunity record, and keeps delivery work", () => {
      expect(dossierRedirect({ id: "int", projectType: "internal", status: "lead" })).toBeNull();
      expect(dossierRedirect({ id: "won", projectType: "one_time", status: "won_in_progress" })).toBeNull();
      expect(dossierRedirect({ id: "doc", projectType: "one_time", status: "lead", isDocumentationOnly: 1 })).toBeNull();
      expect(dossierRedirect({ id: "lead", projectType: "one_time", status: "lead" })).toBe("/opportunities/lead");
      expect(dossierRedirect({ id: "lost", projectType: "monthly", status: "lost" })).toBe("/opportunities/lost");
    });

    it("replaces the URL once the row loads and draws only the loading shell meanwhile", () => {
      expect(dossierSource).toContain("const redirect = project ? dossierRedirect(project, { tab, documentId: openDocumentId }) : null;");
      expect(dossierSource).toContain("navigate(redirect, { replace: true })");
      expect(dossierSource).toContain("if (projectLoading || redirect) {");
    });
  });

  describe("F48: the Activity count is the total", () => {
    const shots = Array.from({ length: 8 }, (_, index) => ({
      id: `s${index}`,
      capturedAt: new Date(2026, 10, 23, 11, index, 0),
      userId: "user-1",
    }));

    it("counts the route's total and links to Activity filtered to the Project", () => {
      const dossier = composeDossier(input({ screenshots: shots, screenshotTotal: 3598 }));
      expect(tabCount(dossier, "activity")).toBe("3598");
      expect(dossier.evidence.total).toBe(3598);
      expect(dossier.evidence.tiles).toHaveLength(8);
      expect(dossier.evidence.allHref).toBe("/activity/gallery?range=all&project=prj-live");
      expect(dossierSource).toContain("See all {dossier.evidence.total} in Activity");
      expect(dossierSource).toContain('<span className="df-count-chip">{dossier.evidence.total}</span>');
    });

    it("falls back to what was loaded, with no link when every tile is shown", () => {
      const dossier = composeDossier(input({ screenshots: shots.slice(0, 3) }));
      expect(tabCount(dossier, "activity")).toBe("3");
      expect(dossier.evidence.allHref).toBeNull();
      expect(composeDossier(input({ screenshots: shots.slice(0, 3), screenshotTotal: 3 })).evidence.allHref).toBeNull();
    });

    it("reads total from the screenshot page and Activity reads an old crmProjectId link as the Project over All time", () => {
      expect(dossierSource).toContain('screenshotTotal: typeof screenshotPage?.total === "number" ? screenshotPage.total : null');
      expect(readActivityFilters("?crmProjectId=prj-live")).toMatchObject({ project: "prj-live", range: "all" });
    });
  });

  describe("F49: rename a Task; Next actions holds open Tasks", () => {
    const tasks = [
      { id: "t-open", name: "Reconcile totals", status: "open" },
      { id: "t-done", name: "Import batches", status: "done" },
      { id: "t-progress", name: "Map accounts", status: "in_progress" },
      { id: "t-archived", name: "Old step", status: "archived" },
    ];

    it("lists open Tasks only under Next actions, every non-archived one on the Tasks tab", () => {
      const dossier = composeDossier(input({ tasks }));
      expect(dossier.nextActions.rows.map((row) => row.id)).toEqual(["t-open", "t-progress"]);
      expect(dossier.nextActions.openCount).toBe(2);
      expect(dossier.nextActions.blockedCount).toBe(0);
      expect(dossier.tasks.rows.map((row) => row.id)).toEqual(["t-open", "t-done", "t-progress"]);
      expect(tabCount(dossier, "tasks")).toBe("3");
    });

    it("renames in place through PATCH /api/tasks/:id, trimmed, never empty, at most 255", () => {
      expect(dossierSource).toContain('apiRequest("PATCH", `/api/tasks/${id}`, { name })');
      expect(dossierSource).toContain('notify.success("Task renamed")');
      expect(dossierSource).toContain("maxLength={255}");
      expect(dossierSource).toContain("if (save && name && name !== title) onRename(id, name);");
      expect(dossierSource).toContain('event.key === "Escape"');
      expect(dossierSource).toContain("<TaskTitle id={row.id} title={row.title} onRename={onRenameTask} />");
    });
  });

  describe("F50: the Client card", () => {
    it("says how many Active and In review Projects the Client has, and links to it", () => {
      const one = composeDossier(input({ clientActiveProjectCount: 1 }));
      expect(one.client?.meta).toBe("1 active project");
      expect(one.client?.id).toBe("cli-1");
      expect(one.identity?.clientHref).toBe("/clients/cli-1");
      expect(composeDossier(input({ clientActiveProjectCount: 8 })).client?.meta).toBe("8 active projects");
    });

    it("lets the server count, instead of loading 500 rows", () => {
      expect(dossierSource).toContain('clientId, kind: "delivery", projectStatus: "active,in_review", pageSize: "1"');
      expect(dossierSource).toContain("clientProjects?.total ?? 0");
      expect(dossierSource).not.toContain("pageSize=500");
      expect(dossierSource).not.toContain("LIVE_PROJECT_STATUSES");
      expect(dossierSource).toContain("<Link href={clientHref(dossier.client.id)} className=\"df-client-name\">");
      expect(dossierSource).toContain("<Link href={dossier.identity.clientHref}");
    });
  });

  describe("F51: polish", () => {
    it("counts Project Documents as 1 doc / N docs", () => {
      const doc = (id: string) => ({ id, title: id, updatedAt: null });
      expect(composeDossier(input({ documents: [doc("a")] })).documents.countLabel).toBe("1 doc");
      expect(composeDossier(input({ documents: [doc("a"), doc("b")] })).documents.countLabel).toBe("2 docs");
      expect(composeDossier(input()).documents.countLabel).toBe("0 docs");
      expect(dossierSource).toContain("{dossier.documents.countLabel}");
    });

    it("counts note Files and uploaded Files on the Files tab, as the card chip does", () => {
      const dossier = composeDossier(
        input({ files: [{ id: "f1", title: "Scope.pdf", updatedAt: null, href: "/objects/f1" }], projectFileCount: 2 }),
      );
      expect(tabCount(dossier, "files")).toBe("3");
      expect(dossier.files.count).toBe(3);
      expect(dossierSource).toContain('<span className="df-count-chip">{dossier.files.count}</span>');
    });

    it("offers Upload File on the empty Files tab when Documentation is on, the note path when off", () => {
      const on = composeDossier(input({ tab: "files" }));
      expect(on.files.emptyState).toEqual({
        title: "No Files yet",
        copy: "Upload a File here, or attach one to a note: both land on this tab.",
        action: { kind: "compose", label: "Upload File" },
      });
      const base = input({ tab: "files" });
      const off = composeDossier({ ...base, project: { ...base.project!, documentationEnabled: 0 } });
      expect(off.files.emptyState.action).toMatchObject({ kind: "link", href: "/projects/prj-live/notes" });
      expect(dossierSource).toMatch(/testId="v2-dossier-files-empty"\s*onCompose=\{onUploadFile\}/);
    });

    it("shows 0 on the Updates tab when there are none, nothing only on refusal", () => {
      expect(tabCount(composeDossier(input()), "updates")).toBe("0");
      expect(tabCount(composeDossier(input({ dailyUpdateCapabilityMiss: true })), "updates")).toBeNull();
    });

    it("has no Filed under this Project card", () => {
      expect(dossierSource).not.toContain("Filed under this Project");
      expect(dossierSource).not.toContain("Every record above resolves");
      expect("filed" in composeDossier(input())).toBe(false);
    });

    it("keeps Save name off until the name changes", () => {
      expect(dossierSource).toContain("disabled={!projectName.trim() || projectName.trim() === documentProjectName}");
    });

    it("totals the Time tab and draws a row's status as plain meta text", () => {
      const dossier = composeDossier(
        input({
          timeEntries: [
            { id: "e1", duration: HOUR, startTime: null, userId: "user-1", status: "stopped" },
            { id: "e2", duration: HOUR / 2, startTime: null, userId: "user-1", status: "approved" },
          ],
        }),
      );
      expect(dossier.time.total).toBe("1.5 h");
      expect(dossier.time.rows[0].duration).toBe("1.0 h");
      expect(dossierSource).toContain("{dossier.time.total}");
      expect(dossierSource).toContain('<span className="df-mono df-meta df-time-entry-status">{row.status}</span>');
      expect(dossierSource).not.toContain('<span className="df-status">{row.status}</span>');
      expect(rule(".df-time-entry-status")).not.toMatch(/border/);
    });

    it("ends the breadcrumb on the Project's name, the tab only while it loads", () => {
      expect(breadcrumbFor("/projects/prj-live/settings", "Acme", "Ledger migration")).toEqual([
        { label: "Acme", href: "/" },
        { label: "Projects", href: "/projects" },
        { label: "Ledger migration" },
      ]);
      expect(breadcrumbFor("/projects/prj-live", "Acme").at(-1)).toEqual({ label: "Overview" });
      // The top-level trimming is untouched.
      expect(breadcrumbFor("/projects", "Acme")).toEqual([{ label: "Acme" }]);
      expect(commandBarSource).toContain('const projectId = route.kind === "dossier" ? route.projectId : "";');
      expect(commandBarSource).toMatch(/queryKey: \["\/api\/crm\/projects", projectId\],\s*enabled: false,/);
    });

    it("holds the search field still: the crumb has a fixed width and its last crumb ellipsizes", () => {
      const crumb = rule(".df-crumb");
      expect(crumb).toMatch(/flex:\s*none/);
      expect(crumb).toMatch(/width:\s*18rem/);
      expect(crumb).toMatch(/overflow:\s*hidden/);
      const last = rule(".df-crumb > span:last-child > :last-child");
      expect(last).toMatch(/text-overflow:\s*ellipsis/);
      expect(last).toMatch(/white-space:\s*nowrap/);
    });
  });

  describe("Overview empty states", () => {
    it("says every Task is done when only done Tasks exist, and offers a New Task", () => {
      const dossier = composeDossier(input({ tasks: [{ id: "t1", name: "Ship", status: "done" }] }));
      expect(dossier.nextActions.empty).toBe(true);
      expect(dossier.nextActions.emptyState).toEqual({
        title: "Every Task is done",
        copy: "Done Tasks stay on the Tasks tab. Add the next step when there is one.",
        action: { kind: "compose", label: "New Task" },
      });
    });

    it("reuses the no-Task empty state when the Project has no Task at all", () => {
      const dossier = composeDossier(input());
      expect(dossier.nextActions.emptyState).toEqual(dossier.tasks.emptyState);
      expect(dossier.nextActions.emptyState.title).toBe("No Tasks yet");
      expect(dossier.nextActions.emptyState.action).toEqual({ kind: "compose", label: "Create the first Task" });
    });

    it("gives the Status history its own title and copy", () => {
      const dossier = composeDossier(input());
      expect(dossier.history.emptyState).toEqual({
        title: "No Status changes yet",
        copy: "Each move between Planned, Active, In review, Completed and Archived lands here: who made it, when, and how long the Project held each status.",
      });
    });

    it("renders every empty Overview card through DossierEmptyStateView", () => {
      for (const testId of [
        "v2-dossier-overview-tasks-empty",
        "v2-dossier-overview-update-empty",
        "v2-dossier-overview-evidence-empty",
        "v2-dossier-overview-documents-empty",
        "v2-dossier-status-history-empty",
      ]) {
        expect(dossierSource).toMatch(new RegExp(`<DossierEmptyStateView[^>]*testId="${testId}"`));
      }
    });
  });
});
