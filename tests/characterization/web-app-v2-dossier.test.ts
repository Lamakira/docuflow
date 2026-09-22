import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { motionForSurface } from "../../client/src/v2/motion";
import { breadcrumbFor, matchV2Route, navIdForPath } from "../../client/src/v2/presentation";
import { composeDossier, type DossierInput } from "../../client/src/v2/dossier";

/**
 * Project Dossier Overview (#173) and remaining live tabs (#188).
 * Seams: matchV2Route (flagged app chrome) and composeDossier (existing `/api/*`).
 * Do not assert hex values or the prototype DOM. No new BFF routes.
 */

const SAMPLE_NAMES = ["Keystone", "Northwind", "Amina", "Kofi", "Elena", "Jules", "Meridian", "Kaleido"];

function emptyInput(overrides: Partial<DossierInput> = {}): DossierInput {
  return {
    now: new Date(2026, 8, 8, 12, 41, 0),
    currentUserId: "user-1",
    tab: "overview",
    project: null,
    tasks: [],
    documents: [],
    dailyUpdate: null,
    dailyUpdateCapabilityMiss: false,
    ownerName: "Sam Lee",
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

function liveProject(): NonNullable<DossierInput["project"]> {
  return {
    id: "prj-live",
    projectStatus: "active",
    projectType: "one_time",
    budgetedHours: 120,
    actualHours: 74,
    updatedAt: new Date(2026, 8, 8, 12, 41, 0),
    project: { id: "doc-1", name: "Ledger rebuild" },
    client: {
      id: "cli-1",
      name: "Harbor Co",
      contacts: [
        { id: "c1", name: "Pat Ng", role: "Approver" },
        { id: "c2", name: "Riley Cho", role: "Finance" },
      ],
    },
    assignee: { id: "user-1", firstName: "Sam", lastName: "Lee", email: "sam@example.com" },
    members: [
      { user: { id: "user-1", firstName: "Sam", lastName: "Lee", email: "sam@example.com" } },
      { user: { id: "user-2", firstName: "Pat", lastName: "Ng", email: "pat@example.com" } },
    ],
    startDate: new Date(2026, 7, 1),
    dueDate: new Date(2026, 9, 30),
    documentationEnabled: 1,
  };
}

describe("Project Dossier routing (#173)", () => {
  it("opens a Project row into the Dossier Overview, not a v1 page", () => {
    const match = matchV2Route("/projects/prj-live");
    expect(match.kind).toBe("dossier");
    if (match.kind !== "dossier") return;
    expect(match.projectId).toBe("prj-live");
    expect(match.tab).toBe("overview");
    expect(navIdForPath("/projects/prj-live")).toBe("projects");
    expect(breadcrumbFor("/projects/prj-live", "Harbor Co").map((crumb) => crumb.label)).toEqual([
      "HARBOR CO",
      "PROJECTS",
      "OVERVIEW",
    ]);
  });

  it("keeps remaining Dossier tabs in the same chrome, not v1 screens", () => {
    for (const tab of ["tasks", "time", "activity", "updates", "notes", "reminders", "documents", "files", "settings"] as const) {
      const match = matchV2Route(`/projects/prj-live/${tab}`);
      expect(match.kind, tab).toBe("dossier");
      if (match.kind !== "dossier") continue;
      expect(match.projectId).toBe("prj-live");
      expect(match.tab).toBe(tab);
    }
    expect(matchV2Route("/projects").kind).toBe("projects");
    expect(matchV2Route("/project/prj-live").kind).not.toBe("placeholder");
    expect(matchV2Route("/crm/project/1").kind).toBe("dossier");
  });

  it("composes Reminders CRUD, notes with audio, and openable File rows (#213)", () => {
    const dossier = composeDossier(emptyInput({
      tab: "notes",
      project: liveProject(),
      reminders: [{
        id: "rem-1",
        title: "Call Client",
        note: "Confirm approval",
        dueAt: new Date(2026, 8, 15, 9, 0),
        status: "upcoming",
        notified: 0,
      }],
      notes: [{
        id: "note-1",
        content: "Voice update",
        createdAt: new Date(2026, 8, 14, 10, 0),
        audioUrl: "/objects/audio.webm",
        audioRecordingId: "audio-1",
        transcriptStatus: "processing",
        audioTranscript: null,
        attachments: JSON.stringify([{ url: "/public-objects/scope.pdf", filename: "scope.pdf", filesize: 12, filetype: "application/pdf" }]),
        createdBy: { id: "user-1", firstName: "Sam", lastName: "Lee" },
      }],
      files: [{ id: "f1", title: "Kickoff deck.pdf", updatedAt: new Date(2026, 8, 8, 11, 0), href: "/documents/f1" }],
    }));

    expect(dossier.reminders.rows[0]).toMatchObject({ id: "rem-1", status: "UPCOMING" });
    expect(dossier.notes.rows[0]).toMatchObject({ id: "note-1", audioRecordingId: "audio-1" });
    expect(dossier.files.rows[0].href).toBe("/documents/f1");
    // Custom CRM field values are out of scope: `crm_custom_field_values` has no
    // route, so the Dossier shows no custom field rather than an empty pretence.
    expect(pageSource).not.toContain("modules/projects/fields");
    expect(pageSource).toContain("/api/audio/upload");
    expect(pageSource).toContain("/reminders`");
    expect(pageSource).toContain("/notes`");
  });
});

describe("Project Dossier Overview from live Workspace records (#173)", () => {
  it("empty and missing Projects use empty geometry and never show another Workspace's sample names", () => {
    const empty = composeDossier(emptyInput());
    const missing = composeDossier(emptyInput({ project: null }));
    const blob = JSON.stringify(empty) + JSON.stringify(missing);

    expect(empty.missing).toBe(true);
    expect(empty.identity).toBeNull();
    expect(empty.nextActions.rows).toEqual([]);
    expect(empty.nextActions.empty).toBe(true);
    expect(empty.documents.rows).toEqual([]);
    expect(empty.evidence.tiles).toEqual([]);
    expect(empty.dailyUpdate.kind).toBe("empty");
    expect(missing.missing).toBe(true);
    for (const name of SAMPLE_NAMES) {
      expect(blob).not.toContain(name);
    }
  });

  it("fills the identity header and Overview from this Project in this Workspace", () => {
    const dossier = composeDossier(
      emptyInput({
        project: liveProject(),
        tasks: [
          { id: "t-open", name: "Reconcile import totals", status: "open" },
          { id: "t-done", name: "Export snapshot", status: "done", updatedAt: new Date(2026, 7, 8, 9, 0, 0) },
        ],
        documents: [
          { id: "d1", title: "Scope notes", updatedAt: new Date(2026, 8, 8, 12, 41, 0), projectId: "doc-1" },
        ],
        dailyUpdate: {
          id: "u1",
          whatHappened: "Imported the remaining vendor batches.",
          blockageType: "client",
          waitingOnClient: true,
          updateDate: new Date(2026, 8, 8, 12, 41, 0),
          user: { firstName: "Pat", lastName: "Ng", email: "pat@example.com" },
        },
        monthSeconds: 258120,
        screenshots: [
          {
            id: "s1",
            capturedAt: new Date(2026, 8, 8, 12, 40, 0),
            userId: "user-2",
            deletedAt: null,
          },
        ],
        users: [{ id: "user-2", firstName: "Pat", lastName: "Ng", email: "pat@example.com" }],
        trackingTaskId: "t-open",
        clientActiveProjectCount: 2,
      }),
    );

    expect(dossier.missing).toBe(false);
    expect(dossier.identity).toMatchObject({
      clientLabel: "Harbor Co",
      kindLabel: "CLIENT PROJECT",
      title: "Ledger rebuild",
      status: "ACTIVE",
    });
    expect(dossier.identity?.lead?.name).toBe("Sam Lee");
    expect(dossier.identity?.lead?.self).toBe(true);
    expect(dossier.identity?.team.map((member) => member.name)).toEqual(["Sam Lee", "Pat Ng"]);
    expect(dossier.stats.budgetPercent).toBe(62);
    expect(dossier.stats.trackedMtd).toBe("71.7 h");
    expect(dossier.stats.showFinance).toBe(false);
    expect(dossier.nextActions.openCount).toBe(1);
    expect(dossier.nextActions.blockedCount).toBe(0);
    expect(dossier.nextActions.rows[0]).toMatchObject({
      id: "t-open",
      title: "Reconcile import totals",
      done: false,
      flag: "TIMER RUNNING",
    });
    expect(dossier.nextActions.rows[1].done).toBe(true);
    expect(dossier.dailyUpdate.kind).toBe("record");
    expect(dossier.dailyUpdate.prose).toContain("Imported the remaining vendor batches.");
    expect(dossier.dailyUpdate.blocker).toBeTruthy();
    expect(dossier.documents.rows).toEqual([
      {
        id: "d1",
        title: "Scope notes",
        meta: "12:41",
        href: "/document/d1",
        order: { parentId: null, up: null, down: null },
      },
    ]);
    expect(matchV2Route(dossier.documents.rows[0].href).kind).toBe("document-editor");
    expect(dossier.evidence.tiles).toHaveLength(1);
    expect(dossier.evidence.tiles[0].kind).toBe("screenshot");
    expect(dossier.client?.name).toBe("Harbor Co");
    expect(dossier.client?.contacts.map((row) => row.role)).toEqual(["APPROVER", "FINANCE"]);
    expect(JSON.stringify(dossier)).not.toContain("Keystone");
  });

  it("hides Restricted Project Documents and does not invent Keystone library rows", () => {
    const dossier = composeDossier(
      emptyInput({
        project: liveProject(),
        documents: [
          { id: "visible", title: "Scope notes", updatedAt: new Date(2026, 8, 8, 12, 41, 0), access: "workspace" },
          { id: "hidden", title: "Payroll ledger", updatedAt: new Date(2026, 8, 8, 9, 0, 0), access: "restricted" },
        ],
      }),
    );
    expect(dossier.documents.rows.map((row) => row.id)).toEqual(["visible"]);
    expect(JSON.stringify(dossier.documents)).not.toContain("Payroll");
    expect(JSON.stringify(dossier.documents)).not.toContain("Keystone");
  });

  it("names the Capability when a Member cannot read Daily Updates", () => {
    const dossier = composeDossier(
      emptyInput({
        project: liveProject(),
        dailyUpdateCapabilityMiss: true,
        ownerName: "Sam Lee",
      }),
    );
    expect(dossier.dailyUpdate.kind).toBe("refusal");
    expect(dossier.dailyUpdate.copy).toContain("View Daily Updates");
    expect(dossier.dailyUpdate.copy.toLowerCase()).not.toContain("permission denied");
    expect(dossier.dailyUpdate.copy).toContain("Sam Lee");
    expect(dossier.dailyUpdate.copy).toContain("Owner");
  });

  it("keeps identity chrome when switching tabs and never marks a Dossier tab as a placeholder", () => {
    const dossier = composeDossier(
      emptyInput({
        tab: "time",
        project: liveProject(),
        tasks: [{ id: "t-open", name: "Reconcile import totals", status: "open" }],
      }),
    );
    expect(dossier.tabIsPlaceholder).toBe(false);
    expect(dossier.tab).toBe("time");
    expect(dossier.identity?.title).toBe("Ledger rebuild");
    expect(dossier.tabs.find((tab) => tab.id === "overview")?.href).toBe("/projects/prj-live");
    expect(dossier.tabs.find((tab) => tab.id === "time")?.href).toBe("/projects/prj-live/time");
    expect(dossier.tabs.find((tab) => tab.id === "tasks")?.count).toBe("1");
  });
});

const pageSource = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "../../client/src/v2/V2Dossier.tsx"),
  "utf8",
);

describe("Project Dossier remaining tabs from live records (#188)", () => {
  it("Tasks create, complete, and take use existing writes, with an honest empty", () => {
    const empty = composeDossier(emptyInput({ tab: "tasks", project: liveProject() }));
    expect(empty.tabIsPlaceholder).toBe(false);
    expect(empty.tasks.empty).toBe(true);
    expect(empty.tasks.emptyCopy.toLowerCase()).toContain("task");
    expect(JSON.stringify(empty.tasks)).not.toContain("Keystone");

    const dossier = composeDossier(
      emptyInput({
        tab: "tasks",
        project: liveProject(),
        tasks: [
          { id: "t-open", name: "Reconcile import totals", status: "open" },
          { id: "t-taken", name: "Map vendor codes", status: "in_progress" },
          { id: "t-done", name: "Export snapshot", status: "done", updatedAt: new Date(2026, 7, 8, 9, 0, 0) },
        ],
        trackingTaskId: "t-taken",
      }),
    );
    expect(dossier.tasks.rows).toHaveLength(3);
    expect(dossier.tasks.rows[0]).toMatchObject({
      id: "t-open",
      title: "Reconcile import totals",
      status: "TO DO",
      done: false,
    });
    expect(dossier.tasks.rows[1]).toMatchObject({
      id: "t-taken",
      title: "Map vendor codes",
      status: "IN PROGRESS",
      flag: "TIMER RUNNING",
    });
    expect(dossier.tasks.rows[2].done).toBe(true);
    expect(dossier.tasks.assignees.map((member) => member.name)).toEqual(["Sam Lee", "Pat Ng"]);

    expect(pageSource).toContain('apiRequest("POST", "/api/tasks"');
    expect(pageSource).toContain('apiRequest("PATCH", `/api/tasks/${id}`');
    expect(pageSource).not.toContain("v2-dossier-placeholder-tab");
    expect(pageSource).not.toContain('data-testid="v2-placeholder"');
  });

  it("Time lists Time Entries for this Project and stays empty without sample hours", () => {
    const empty = composeDossier(emptyInput({ tab: "time", project: liveProject() }));
    expect(empty.time.empty).toBe(true);
    expect(empty.time.emptyCopy.toLowerCase()).toContain("time");
    expect(JSON.stringify(empty.time)).not.toContain("Keystone");

    const dossier = composeDossier(
      emptyInput({
        tab: "time",
        project: liveProject(),
        tasks: [{ id: "t-open", name: "Reconcile import totals", status: "open" }],
        timeEntries: [
          {
            id: "e1",
            duration: 5400,
            startTime: new Date(2026, 8, 8, 9, 0, 0),
            userId: "user-1",
            taskId: "t-open",
            status: "stopped",
            user: { id: "user-1", firstName: "Sam", lastName: "Lee", email: "sam@example.com" },
          },
        ],
      }),
    );
    expect(dossier.time.rows).toEqual([
      {
        id: "e1",
        when: "09:00",
        who: "Sam Lee",
        task: "Reconcile import totals",
        duration: "1.5 h",
        status: "STOPPED",
      },
    ]);
    expect(dossier.tabs.find((tab) => tab.id === "time")?.count).toBe("1");
  });

  it("Activity shows allowed Activity Evidence and never staggers a screenshot grid", () => {
    const empty = composeDossier(emptyInput({ tab: "activity", project: liveProject() }));
    expect(empty.evidence.empty).toBe(true);
    expect(empty.evidence.emptyCopy.toLowerCase()).toContain("activity evidence");

    const dossier = composeDossier(
      emptyInput({
        tab: "activity",
        project: liveProject(),
        screenshots: [
          {
            id: "s1",
            capturedAt: new Date(2026, 8, 8, 12, 40, 0),
            userId: "user-2",
            deletedAt: null,
          },
        ],
        users: [{ id: "user-2", firstName: "Pat", lastName: "Ng", email: "pat@example.com" }],
      }),
    );
    expect(dossier.evidence.tiles).toHaveLength(1);
    expect(dossier.evidence.footnote.toLowerCase()).toContain("tracking");
    expect(rule(".df-dossier-activity .df-evidence-grid")).toMatch(/animation:\s*none/);
  });

  it("Updates lists Daily Updates or names the Capability, never a generic permission denied", () => {
    const refusal = composeDossier(
      emptyInput({
        tab: "updates",
        project: liveProject(),
        dailyUpdateCapabilityMiss: true,
        ownerName: "Sam Lee",
      }),
    );
    expect(refusal.updates.kind).toBe("refusal");
    expect(refusal.updates.copy).toContain("View Daily Updates");
    expect(refusal.updates.copy).toContain("Sam Lee");
    expect(refusal.updates.copy.toLowerCase()).not.toContain("permission denied");

    const dossier = composeDossier(
      emptyInput({
        tab: "updates",
        project: liveProject(),
        dailyUpdates: [
          {
            id: "u1",
            whatHappened: "Imported the remaining vendor batches.",
            blockageType: "client",
            waitingOnClient: true,
            updateDate: new Date(2026, 8, 8, 12, 41, 0),
            user: { firstName: "Pat", lastName: "Ng", email: "pat@example.com" },
          },
          {
            id: "u2",
            whatWasDone: "Closed the import checklist.",
            updateDate: new Date(2026, 8, 7, 17, 0, 0),
            user: { firstName: "Sam", lastName: "Lee", email: "sam@example.com" },
          },
        ],
      }),
    );
    expect(dossier.updates.kind).toBe("records");
    expect(dossier.updates.rows).toHaveLength(2);
    expect(dossier.updates.rows[0].prose).toContain("Imported the remaining vendor batches.");
    expect(dossier.updates.rows[0].blocker).toBeTruthy();
    expect(JSON.stringify(dossier.updates)).not.toContain("Keystone");
  });

  it("Documents and Files honor access and stay honestly empty when none are visible", () => {
    const hidden = composeDossier(
      emptyInput({
        tab: "documents",
        project: liveProject(),
        documents: [
          { id: "hidden", title: "Payroll ledger", updatedAt: new Date(2026, 8, 8, 9, 0, 0), access: "restricted" },
        ],
        files: [
          { id: "f-hidden", title: "Payroll scan.pdf", updatedAt: new Date(2026, 8, 8, 9, 0, 0), access: "restricted" },
        ],
      }),
    );
    expect(hidden.documents.empty).toBe(true);
    expect(hidden.files.empty).toBe(true);
    expect(JSON.stringify(hidden.documents)).not.toContain("Payroll");
    expect(JSON.stringify(hidden.files)).not.toContain("Payroll");

    const dossier = composeDossier(
      emptyInput({
        tab: "files",
        project: liveProject(),
        documents: [
          { id: "d1", title: "Scope notes", updatedAt: new Date(2026, 8, 8, 12, 41, 0), access: "workspace" },
        ],
        files: [
          { id: "f1", title: "Kickoff deck.pdf", updatedAt: new Date(2026, 8, 8, 11, 0, 0), access: "workspace" },
        ],
      }),
    );
    expect(dossier.documents.rows[0].title).toBe("Scope notes");
    // No href means no destination: the row is listed but is not a link to nowhere.
    expect(dossier.files.rows).toEqual([
      { id: "f1", title: "Kickoff deck.pdf", meta: "11:00", href: "", target: "none" },
    ]);
    expect(dossier.files.empty).toBe(false);
  });

  it("Settings expose BFF Project fields and Project Assignment, not custom Workspace Roles or Timesheets", () => {
    const dossier = composeDossier(emptyInput({ tab: "settings", project: liveProject() }));
    expect(dossier.settings.fields).toEqual(
      expect.arrayContaining([
        { label: "NAME", value: "Ledger rebuild" },
        { label: "CLIENT", value: "Harbor Co" },
        { label: "KIND", value: "CLIENT PROJECT" },
        { label: "STATUS", value: "ACTIVE" },
        { label: "LEAD", value: "Sam Lee" },
        { label: "BUDGET", value: "120.0 h" },
        { label: "DOCUMENTATION", value: "ON" },
      ]),
    );
    expect(dossier.settings.lead?.id).toBe("user-1");
    expect(dossier.settings.members.map((member) => member.id)).toEqual(["user-1", "user-2"]);
    expect(JSON.stringify(dossier.settings)).not.toContain("Timesheet");
    expect(JSON.stringify(dossier.settings)).not.toContain("custom role");
    expect(pageSource).toContain('apiRequest("PATCH", `/api/crm/projects/${projectId}`');
    expect(pageSource).toContain('apiRequest("POST", `/api/crm/projects/${projectId}/members`');
  });
});

describe("Project Dossier tab swap motion (#188)", () => {
  it("crossfades tab content and treats the underline as state; reduced-motion is opacity only", () => {
    const motion = motionForSurface("dossier-tab-swap");
    expect(motion.enterExit).toBe("standard");
    expect(motion.keepOpacity).toBe(true);

    const reduced = motionForSurface("dossier-tab-swap", { reducedMotion: true });
    expect(reduced.movement).toBe("none");
    expect(reduced.keepOpacity).toBe(true);
    expect(reduced.enterExit).toBe("standard");

    expect(rule(".df-dossier-identity")).toMatch(/transition:\s*none/);
    expect(rule(".df-tab")).toMatch(/transition:\s*none/);
    expect(rule('.df-dossier-pane[data-motion="standard"]')).toMatch(/opacity/);
    expect(css).toMatch(/@starting-style[\s\S]*\.df-dossier-pane/);
    expect(reducedMotionCss()).toMatch(/\.df-dossier-pane[^{]*\{[^}]*transform:\s*none/);
    expect(reducedMotionCss()).not.toMatch(/opacity:\s*0/);
    expect(pageSource).toContain('motionForSurface("dossier-tab-swap")');
  });

  it("does not animate Task rows, screenshot grids, or typing in Settings fields", () => {
    expect(rule(".df-dossier-tasks .df-task-row")).toMatch(/transition:\s*none/);
    expect(rule(".df-dossier-tasks .df-task-row")).toMatch(/animation:\s*none/);
    expect(rule(".df-dossier-activity .df-evidence-grid")).toMatch(/animation:\s*none/);
    expect(rule(".df-dossier-settings input")).toMatch(/transition:\s*none/);
    expect(rule(".df-dossier-settings input")).toMatch(/animation:\s*none/);
  });
});

const css = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "../../client/src/v2/tokens.css"),
  "utf8",
).replace(/\/\*[\s\S]*?\*\//g, "");

function rule(selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = css.match(new RegExp(`${escaped}\\s*\\{([^}]*)\\}`));
  if (!match) throw new Error(`missing rule ${selector}`);
  return match[1];
}

function reducedMotionCss(): string {
  return [...css.matchAll(/@media\s*\(\s*prefers-reduced-motion:\s*reduce\s*\)\s*\{([\s\S]*?)\n\}/g)]
    .map((match) => match[1])
    .join("\n");
}

describe("Dossier voice notes stay in the v2 visual system (#213)", () => {
  it("does not pull the discarded v1 audio components into v2 chrome", () => {
    // ADR-0003: v2 must not mix in the discarded visual system.
    expect(pageSource).not.toContain("@/components/editor/AudioRecorder");
    expect(pageSource).not.toContain("@/components/NoteAudioPlayer");
    expect(pageSource).toContain("./V2NoteAudio");

    const audioSource = readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), "../../client/src/v2/V2NoteAudio.tsx"),
      "utf8",
    );
    // No Tailwind utility classes, and the transcript poll is kept.
    expect(audioSource).not.toMatch(/className="[^"]*\b(flex|gap-\d|p-\d|bg-muted|rounded-lg)\b/);
    expect(audioSource).toContain("/api/audio/");
    // Recording is a state, not a celebration.
    expect(rule(".df-audio-clock")).toMatch(/animation:\s*none/);
  });
});

describe("Dossier Reminders are editable, not just completable (#213)", () => {
  it("carries the raw fields an edit needs, and says when a Reminder can reopen", () => {
    const dossier = composeDossier(
      emptyInput({
        tab: "reminders",
        project: liveProject(),
        reminders: [
          {
            id: "rem-1",
            title: "Chase signature",
            note: "Before the review",
            dueAt: new Date(2026, 8, 10, 9, 0, 0),
            status: "upcoming",
          },
          {
            id: "rem-2",
            title: "Send invoice",
            note: null,
            dueAt: new Date(2026, 8, 9, 9, 0, 0),
            status: "done",
          },
        ],
      }),
    );

    const [open, done] = dossier.reminders.rows;
    expect(open).toMatchObject({ id: "rem-1", done: false, canComplete: true, canReopen: false });
    expect(done).toMatchObject({ id: "rem-2", done: true, canComplete: false, canReopen: true });

    // An edit form needs the values back, not the formatted ones.
    expect(open.draft).toEqual({
      title: "Chase signature",
      note: "Before the review",
      dueAt: "2026-09-10T09:00",
    });
    expect(done.draft.note).toBe("");
  });

  it("edits a Reminder through the route that already takes those fields", () => {
    expect(pageSource).toMatch(/PATCH", `\/api\/reminders\/\$\{[^}]+\}`, \{ title/);
    expect(pageSource).toContain("canReopen");
  });
});

describe("Dossier Files open the File (#213)", () => {
  it("renders an object path as a real link out, never client-routed into the placeholder", () => {
    // wouter <Link> would client-route /public-objects/... and fall through to
    // V2PlaceholderPage — the dead name the ticket forbids.
    expect(pageSource).toContain('row.target === "file"');
    expect(pageSource).toMatch(/<a\s[^>]*href=\{row\.href\}/);
    expect(pageSource).toContain('rel="noreferrer"');
  });

  it("opens the File from its row, which is this ticket's one novelty", () => {
    const recipe = motionForSurface("dossier-file-open");
    expect(recipe.enterExit).toBe("standard");
    expect(recipe.keepOpacity).toBe(true);

    const reduced = motionForSurface("dossier-file-open", { reducedMotion: true });
    expect(reduced.movement).toBe("none");

    // The row is the origin, so the row itself carries the motion.
    expect(pageSource).toContain("FILE_OPEN_MOTION");
    expect(rule('.df-file-row[data-motion="standard"]')).toMatch(/var\(--ease-out\)/);
    expect(rule('.df-file-row[data-motion="standard"]')).not.toMatch(/transition\s*:\s*all\b/);
    expect(reducedMotionCss()).toMatch(/\.df-file-row\[data-motion="standard"\]/);
  });

  it("carries an object URL into the File viewer instead of the placeholder", () => {
    const dossier = composeDossier(
      emptyInput({
        tab: "files",
        project: liveProject(),
        // The only source of Dossier Files is a note attachment, whose href is
        // an object path served by the backend — not a v2 route.
        files: [
          {
            id: "note-1-0",
            title: "Kickoff deck.pdf",
            updatedAt: new Date(2026, 8, 8, 11, 0, 0),
            href: "/public-objects/uploads/kickoff.pdf",
          },
        ],
      }),
    );

    expect(dossier.files.rows).toHaveLength(1);
    const row = dossier.files.rows[0];
    // The object path is carried into the v2 File viewer (#216) rather than
    // client-routed as itself, which would land on the placeholder — the dead
    // name this ticket forbids.
    expect(row.href).toContain("/files?");
    expect(row.href).toContain(encodeURIComponent("/public-objects/uploads/kickoff.pdf"));
    expect(row.target).toBe("app");
  });

  it("never invents a Document route for a File that has no href", () => {
    const dossier = composeDossier(
      emptyInput({
        tab: "files",
        project: liveProject(),
        files: [{ id: "note-9-2", title: "Orphan.pdf", updatedAt: null }],
      }),
    );

    const row = dossier.files.rows[0];
    // "note-9-2" is a note-attachment id, never a Document id.
    expect(row.href).not.toContain("/documents/");
    expect(row.target).toBe("none");
  });
});

