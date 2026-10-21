import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { composeActivity, composeActivityGallery } from "../../client/src/v2/activity";
import { composeClientRegister } from "../../client/src/v2/clients";
import { composeDevices } from "../../client/src/v2/devices";
import { composeTeamDailyUpdates } from "../../client/src/v2/dailyUpdate";
import { emptyKindOf, emptyModelOf, filteredEmptyCopy } from "../../client/src/v2/emptyState";
import {
  composeOpportunityPipeline,
  composeOpportunityStages,
  FALLBACK_OPEN_STAGES,
} from "../../client/src/v2/opportunities";
import { composePeople } from "../../client/src/v2/people";
import { composeProjectBoard, composeProjectRegister } from "../../client/src/v2/projects";
import { composeProjectTasks } from "../../client/src/v2/tasks";
import { composeTimeStats, composeTimeTracking } from "../../client/src/v2/time";

/**
 * Empty states (#325). Three cases, one rule each: nothing exists yet reads as
 * the designed V2EmptyState; filters that hide every row read as one short line
 * with Clear filters; a dashboard section with no data for its range keeps a
 * compact in-card line.
 */

const v2 = (name: string) =>
  readFileSync(join(dirname(fileURLToPath(import.meta.url)), "../../client/src/v2", name), "utf8");

const NOW = new Date(2026, 8, 10, 15, 0, 0);

describe("the shared empty-state kinds", () => {
  it("turns a narrow Range into none only once nothing was ever recorded", () => {
    expect(emptyKindOf(true, false, true, false)).toBe("none");
    expect(emptyKindOf(true, false, true, true)).toBe("range");
    expect(emptyKindOf(true, false, true, null)).toBe("range");
    expect(emptyKindOf(true, true, true, false)).toBe("filtered");
    expect(emptyKindOf(false, false, true, false)).toBeNull();
  });

  it("is neither when rows exist, filtered when filters hide them, none otherwise", () => {
    expect(emptyKindOf(false, false)).toBeNull();
    expect(emptyKindOf(true, true)).toBe("filtered");
    expect(emptyKindOf(true, false)).toBe("none");
    expect(filteredEmptyCopy("Projects")).toBe("No Projects match these filters.");
  });

  it("is a range, never none, when an unfiltered list is read over a Range shorter than the widest", () => {
    expect(emptyKindOf(true, false, true)).toBe("range");
    expect(emptyKindOf(true, true, true)).toBe("filtered");
    expect(emptyKindOf(false, false, true)).toBeNull();
  });

  it("bundles the kind, headline and copy as one model, and none for a list that has rows", () => {
    const first = { title: "Add your first Thing", copy: "A Thing is a thing." };
    expect(emptyModelOf(null, "Things", first)).toBeNull();
    expect(emptyModelOf("none", "Things", first)).toEqual({ kind: "none", ...first });
    expect(emptyModelOf("filtered", "Things", first)).toEqual({
      kind: "filtered",
      title: "",
      copy: "No Things match these filters.",
    });
    expect(emptyModelOf("range", "Things", first, "Nothing today.")).toEqual({ kind: "range", title: "", copy: "Nothing today." });
    // A list read only over a Range has no first-use case.
    expect(emptyModelOf("none", "Things", null, "Nothing today.")?.kind).toBe("range");
  });

  it("renders every case through one V2RecordEmpty, and every dashboard section through one compact line", () => {
    for (const file of ["V2Clients.tsx", "V2Projects.tsx", "V2Opportunities.tsx", "V2People.tsx", "V2Activity.tsx", "V2DailyUpdates.tsx", "V2Time.tsx"]) {
      const source = v2(file);
      expect(source, file).toContain("<V2RecordEmpty");
      expect(source, file).not.toContain("<V2FilteredEmpty");
    }
    for (const file of ["V2Analytics.tsx", "V2Today.tsx", "V2Time.tsx", "V2TaskTable.tsx"]) {
      expect(v2(file), file).toContain("<V2CompactEmpty");
    }
    expect(v2("V2EmptyState.tsx")).toContain('<p className="df-empty"');
  });
});

describe("Clients", () => {
  const input = { workspaceName: "Harbor Co", clients: [], filterQuery: "", selectedId: null };

  it("invites the first Client when the Workspace has none", () => {
    const register = composeClientRegister(input);
    expect(register.emptyState?.kind).toBe("none");
    expect(register.filtered).toBe(false);
    expect(register.emptyState?.title).toBe("Add your first Client");
    expect(register.emptyState?.copy).toContain("Client");
  });

  it("says filters hide every row, for a search or a server filter", () => {
    const searched = composeClientRegister({ ...input, filterQuery: "pier" });
    expect(searched.emptyState).toMatchObject({ kind: "filtered", copy: "No Clients match these filters." });
    const narrowed = composeClientRegister({ ...input, activeFilters: ["Status Lead"] });
    expect(narrowed.emptyState?.kind).toBe("filtered");
    expect(narrowed.filtered).toBe(true);
  });

  it("has no empty kind while there are rows", () => {
    const register = composeClientRegister({
      ...input,
      clients: [{ id: "c1", name: "Acme", company: null, status: "lead", source: null, projectCount: 0, createdAt: null }],
    } as Parameters<typeof composeClientRegister>[0]);
    expect(register.emptyState).toBeNull();
  });

  it("renders the designed state, the filtered line and the same Clear filters reset", () => {
    const page = v2("V2Clients.tsx");
    expect(page).toContain("register.emptyState");
    expect(page).toContain("<V2RecordEmpty");
    expect(page).toContain("clearClientFilters(filters)");
  });
});

describe("Projects", () => {
  const input = {
    workspaceName: "Harbor Co",
    projects: [],
    filterQuery: "",
    statusFilter: "all",
    tagFilter: "all",
    selectedId: null,
  };

  it("invites the first Project when there is none and no filter is on", () => {
    const register = composeProjectRegister(input);
    expect(register.emptyState).toMatchObject({ kind: "none", title: "Add your first Project" });
  });

  it("says filters hide every row, whichever filter did it", () => {
    for (const overrides of [{ filterQuery: "x" }, { statusFilter: "on_hold" }, { tagFilter: "t-1" }, { activeFilters: ["Client Acme"] }]) {
      const register = composeProjectRegister({ ...input, ...overrides });
      expect(register.emptyState).toMatchObject({ kind: "filtered", copy: "No Projects match these filters." });
    }
  });

  it("does the same on the board: columns give way to the designed state only when nothing exists", () => {
    const none = composeProjectBoard({ workspaceName: "Harbor Co", projects: [], filterQuery: "", changingId: null });
    expect(none.emptyState).toMatchObject({ kind: "none", title: "Add your first Project" });
    const filtered = composeProjectBoard({ workspaceName: "Harbor Co", projects: [], filterQuery: "x", changingId: null });
    expect(filtered.emptyState?.kind).toBe("filtered");
    const page = v2("V2Projects.tsx");
    expect(page).toContain('board.emptyState?.kind === "none"');
    expect(page).toContain("clearProjectFilters(filters)");
  });
});

describe("Opportunities", () => {
  const input = {
    workspaceName: "Harbor Co",
    stages: composeOpportunityStages(FALLBACK_OPEN_STAGES),
    rows: [],
    filterQuery: "",
    changingId: null,
  };

  it("shows the designed empty state instead of five empty columns when there is none at all", () => {
    const pipeline = composeOpportunityPipeline(input);
    expect(pipeline.emptyState).toMatchObject({ kind: "none", title: "Add your first Opportunity" });
    const page = v2("V2Opportunities.tsx");
    const none = page.indexOf('pipeline.emptyState?.kind === "none"');
    expect(none).toBeGreaterThan(-1);
    // The pipeline of columns lives in the other arm of that conditional.
    expect(page.indexOf("<DragDropContext", none)).toBeGreaterThan(none);
    expect(page.indexOf("<V2RecordEmpty", 0)).toBeLessThan(none);
  });

  it("keeps the columns and adds Clear filters when a search hides every card", () => {
    const pipeline = composeOpportunityPipeline({ ...input, filterQuery: "zzz" });
    expect(pipeline.emptyState).toMatchObject({ kind: "filtered", copy: "No Opportunities match these filters." });
    expect(pipeline.columns.length).toBeGreaterThan(0);
  });
});

describe("Time Tracking", () => {
  const input = {
    now: NOW,
    workspaceName: "Harbor Co",
    currentUserId: "me",
    isAdmin: false,
    isRunning: false,
    displayDuration: 0,
    activeEntryId: null,
    entries: [],
    workdaySeconds: 0,
  };

  it("invites the first Time Entry only when the Range is All time and nothing is recorded", () => {
    const page = composeTimeTracking({ ...input, range: "all" });
    expect(page.emptyState).toMatchObject({ kind: "none", title: "Track your first Time Entry" });
    expect(composeTimeTracking(input).emptyState?.kind).toBe("none");
  });

  it("keeps a compact line that names the window on a short Range, since rows may sit outside it", () => {
    expect(composeTimeTracking({ ...input, range: "today" }).emptyState).toEqual({
      kind: "range",
      title: "",
      copy: "No Time Entries today. Widen the Range to look further back.",
    });
    expect(composeTimeTracking({ ...input, range: "week" }).emptyState?.copy).toBe(
      "No Time Entries this week. Widen the Range to look further back.",
    );
  });

  it("says filters hide every row when the Project, Status or Member filter is on, on any Range", () => {
    for (const range of ["all", "today"] as const) {
      const page = composeTimeTracking({ ...input, range, facetsActive: true });
      expect(page.emptyState).toMatchObject({ kind: "filtered", copy: "No Time Entries match these filters." });
    }
  });

  it("invites the first Time Entry on Today when nothing was ever recorded, and keeps the range line when something exists elsewhere", () => {
    const never = composeTimeTracking({ ...input, range: "today", everRecorded: false });
    expect(never.emptyState).toMatchObject({ kind: "none", title: "Track your first Time Entry" });
    expect(never.emptyState?.copy).toContain("press Start");
    expect(never.emptyAction).toBeNull();
    expect(composeTimeTracking({ ...input, range: "week", everRecorded: false }).emptyState?.kind).toBe("none");
    expect(composeTimeTracking({ ...input, range: "today", everRecorded: true }).emptyState?.kind).toBe("range");
    expect(composeTimeTracking({ ...input, range: "today", everRecorded: null }).emptyState?.kind).toBe("range");
    expect(composeTimeTracking({ ...input, range: "today", everRecorded: false, facetsActive: true }).emptyState?.kind).toBe(
      "filtered",
    );
  });

  it("explains the missing Project, offers New Project only to a reader who may create one", () => {
    const base = { ...input, range: "today" as const, everRecorded: false, hasProjects: false };
    const allowed = composeTimeTracking({ ...base, canCreateProject: true });
    expect(allowed.emptyState?.copy).toContain("a Project has to exist first");
    expect(allowed.emptyAction).toEqual({ label: "New Project", href: "/projects?new=1" });
    expect(allowed.timerHint).toEqual({ copy: "Create a Project to start tracking.", href: "/projects?new=1" });
    const readOnly = composeTimeTracking({ ...base, canCreateProject: false });
    expect(readOnly.emptyAction).toBeNull();
    expect(readOnly.timerHint).toEqual({ copy: "Create a Project to start tracking.", href: null });
    expect(composeTimeTracking({ ...input, hasProjects: true }).timerHint).toBeNull();
    expect(composeTimeTracking(input).timerHint).toBeNull();
  });

  it("keeps Time stats sections as compact lines, never the designed state", () => {
    const stats = composeTimeStats({ period: "week", workspaceName: "Harbor Co", canSeeEveryone: true, stats: null });
    expect(stats.byProject.empty).toBe(true);
    expect(stats.byProject.emptyCopy).toMatch(/^No Time Entry on a Project/);
    expect(v2("V2Time.tsx")).toContain('<V2CompactEmpty>{isLoading ? "Loading…" : page.byProject.emptyCopy}</V2CompactEmpty>');
  });

  it("invites the first Project and the first Task in Projects & Tasks", () => {
    const base = { workspaceName: "Harbor Co", readOnly: false, search: "", selectedProjectId: null, projects: [], tasks: [] };
    expect(composeProjectTasks(base).projectsEmptyState).toMatchObject({ kind: "none", title: "Add your first Project" });
    expect(composeProjectTasks({ ...base, search: "zzz" }).projectsEmptyState?.kind).toBe("filtered");
    const withProject = composeProjectTasks({
      ...base,
      selectedProjectId: "prj-1",
      projects: [{ id: "prj-1", project: { name: "Harbour rebuild" } }],
    } as Parameters<typeof composeProjectTasks>[0]);
    expect(withProject.active.empty).toBe(true);
    expect(withProject.active.emptyState?.title).toBe("Add your first Task");
    expect(withProject.active.emptyState?.copy).toContain("Name the first one above");
  });

  it("offers no New Project button and no instruction to a reader who cannot create", () => {
    const base = { workspaceName: "Harbor Co", search: "", selectedProjectId: "prj-1", projects: [], tasks: [] };
    const readOnly = composeProjectTasks({ ...base, readOnly: true } as Parameters<typeof composeProjectTasks>[0]);
    expect(readOnly.canWrite).toBe(false);
    expect(readOnly.projectsEmptyState?.copy).not.toContain("Create a Project");
    expect(readOnly.active.emptyState?.copy).not.toContain("above");
    const source = v2("V2Time.tsx");
    expect(source).toMatch(/page\.canWrite \? \(\s*<Button asChild[\s\S]*?New Project/);
  });
});

describe("Activity", () => {
  const activity = {
    now: NOW,
    workspaceName: "Harbor Co",
    currentUserId: "me",
    canReview: false,
    ownerName: "Sam Lee",
    requestedUserId: null,
    expandedId: null,
    policy: null,
    projects: [],
    entries: [],
    users: [],
    evidence: [],
  };
  const gallery = {
    now: NOW,
    currentUserId: "me",
    canReview: false,
    lowActivityOnly: false,
    identicalOnly: false,
    selectedIds: [],
    expandedId: null,
    page: 1,
    pageSize: 50,
    total: 0,
    projects: [],
    entries: [],
    users: [],
    evidence: [],
  };

  it("keeps a compact line for a date range with no Evidence", () => {
    const range = { kind: "range", copy: "No Activity Evidence for this date range." };
    expect(composeActivity(activity).emptyState).toMatchObject(range);
    expect(composeActivityGallery(gallery).emptyState).toMatchObject(range);
  });

  it("invites the desktop agent when no Evidence was ever recorded, and keeps the range line when some exists", () => {
    for (const model of [
      composeActivity({ ...activity, everRecorded: false }).emptyState,
      composeActivityGallery({ ...gallery, everRecorded: false }).emptyState,
    ]) {
      expect(model).toMatchObject({ kind: "none", title: "No Activity Evidence yet" });
      expect(model?.copy).toContain("desktop agent");
    }
    expect(composeActivity({ ...activity, everRecorded: true }).emptyState?.kind).toBe("range");
    expect(composeActivityGallery({ ...gallery, everRecorded: true }).emptyState?.kind).toBe("range");
    expect(composeActivity({ ...activity, everRecorded: false, facetsActive: true }).emptyState?.kind).toBe("filtered");
  });

  it("offers Clear filters when a Project, Member or gallery filter hides the Evidence", () => {
    expect(composeActivity({ ...activity, facetsActive: true }).emptyState).toMatchObject({
      kind: "filtered",
      copy: "No Activity Evidence match these filters.",
    });
    expect(composeActivityGallery({ ...gallery, lowActivityOnly: true }).emptyState?.kind).toBe("filtered");
  });
});

describe("People, Devices and team Daily Updates", () => {
  it("invites the first Member, or says the search hides every row", () => {
    const input = {
      workspaceName: "Harbor Co",
      currentUserId: "me",
      ownerName: "Sam Lee",
      condition: null,
      includeArchived: false,
      purchasedSeats: null,
      memberships: [],
    };
    expect(composePeople(input).emptyState).toMatchObject({ kind: "none", title: "Invite your first Member" });
    expect(composePeople({ ...input, filterQuery: "zzz" }).emptyState).toMatchObject({
      kind: "filtered",
      copy: "No Memberships match these filters.",
    });
  });

  it("does not tell a reader who cannot invite to use Invite", () => {
    const input = {
      workspaceName: "Harbor Co",
      currentUserId: "me",
      ownerName: "Sam Lee",
      condition: null,
      includeArchived: false,
      purchasedSeats: null,
      memberships: [],
    };
    expect(composePeople(input).emptyState?.copy).toContain("Use Invite above");
    const cannot = composePeople({ ...input, canInvite: false }).emptyState;
    expect(cannot?.kind).toBe("none");
    expect(cannot?.copy).not.toMatch(/Invite/);
    expect(cannot?.title).not.toMatch(/Invite/);
    expect(v2("V2People.tsx")).toContain("canInvite: !readOnly && canManage");
  });

  it("invites the first paired Device", () => {
    const page = composeDevices({
      now: NOW,
      workspaceName: "Harbor Co",
      condition: null,
      pairing: { pending: false, code: null, expiresAt: null },
      devices: [],
    });
    expect(page.empty).toBe(true);
    expect(page.emptyState).toMatchObject({ kind: "none", title: "Pair your first Device" });
    expect(page.pairAllowed).toBe(true);
  });

  it("shows no Pair button on an empty Devices page when the Workspace is Read-only", () => {
    const page = composeDevices({
      now: NOW,
      workspaceName: "Harbor Co",
      condition: "Read-only",
      pairing: { pending: false, code: null, expiresAt: null },
      devices: [],
    });
    expect(page.pairAllowed).toBe(false);
    expect(v2("V2Devices.tsx")).toMatch(/page\.pairAllowed \? \(\s*<Button[\s\S]*?Pair a device/);
  });

  it("separates no Daily Updates from filters hiding them", () => {
    const input = {
      now: NOW,
      workspaceName: "Harbor Co",
      ownerName: "Sam Lee",
      canView: true,
      kpis: null,
      submittedToday: [],
      missingToday: [],
      updates: [],
      filterQuery: "",
      statusFilter: "all",
      memberFilter: "all",
    };
    // A short Range keeps the compact line: older Daily Updates may exist outside it.
    expect(composeTeamDailyUpdates({ ...input, rangeDays: "7" })).toMatchObject({
      emptyState: { kind: "range", copy: "No Daily Updates in the last 7 days. Widen the Range to look further back." },
    });
    expect(composeTeamDailyUpdates({ ...input, rangeDays: "1" })).toMatchObject({
      emptyState: { kind: "range", copy: "No Daily Updates today. Widen the Range to look further back." },
    });
    // Last 30 days is the widest Range on offer.
    expect(composeTeamDailyUpdates({ ...input, rangeDays: "30" })).toMatchObject({
      emptyState: { kind: "none", title: "No Daily Updates yet" },
    });
    const filtered = composeTeamDailyUpdates({ ...input, rangeDays: "7", statusFilter: "blocked" });
    expect(filtered.emptyState).toMatchObject({ kind: "filtered", copy: "No Daily Updates match these filters." });
  });
});

describe("Gating the primary action", () => {
  it("shows New Client, New Project and New Opportunity on an empty state only to a reader who may create", () => {
    for (const [file, label] of [
      ["V2Clients.tsx", "New Client"],
      ["V2Projects.tsx", "New Project"],
      ["V2Opportunities.tsx", "New Opportunity"],
    ] as const) {
      const source = v2(file);
      expect(source, file).toMatch(new RegExp(`readOnly \\? undefined : \\(\\s*<Button[\\s\\S]*?${label}`));
    }
  });
});

describe("Analytics and Today sections", () => {
  it("keep one compact in-card line (V2CompactEmpty) and never the designed state", () => {
    for (const file of ["V2Analytics.tsx", "V2Today.tsx"]) {
      const source = v2(file);
      expect(source).toContain("<V2CompactEmpty");
      expect(source).not.toContain("<V2EmptyState");
    }
  });
});
