import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import { composeProjectTasks } from "../../client/src/v2/tasks";
import {
  composeTimeTracking,
  filterProjectOptions,
  formatEntryWhen,
  isTimerProject,
  knownFilterId,
  projectTasksHref,
  rangeTotalLabel,
  readChosenProject,
  readTimeFilters,
  readTimePeriod,
  secondsSinceRead,
  timeEntriesPath,
  timerProjectOptions,
  timeStatsPath,
  TIME_FILTERS_DEFAULT,
  writeChosenProject,
  writeTimeFilters,
  writeTimePeriod,
  type TimeEntryRowInput,
} from "../../client/src/v2/time";
import { TimeRemovals } from "../../client/src/v2/timeRemovals";

/**
 * The Time Tracking review, client half (F68, F69, F71 to F74).
 * Seams: the pure helpers of time.ts, TimeRemovals, and the source shape of
 * V2Time / V2TimerChip / V2Dossier / TimeTrackerContext / tokens.css.
 */

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
const read = (path: string) => readFileSync(join(root, path), "utf8");
const timeSource = read("client/src/v2/V2Time.tsx");
const chipSource = read("client/src/v2/V2TimerChip.tsx");
const dossierSource = read("client/src/v2/V2Dossier.tsx");
const contextSource = read("client/src/contexts/TimeTrackerContext.tsx");
const css = read("client/src/v2/tokens.css");

const NOW = new Date(2026, 10, 24, 15, 0, 0);

function removals(send: (id: string) => Promise<unknown> = async () => undefined) {
  const toasts: Array<{ key: string; id: string; undo: () => void; end: () => void }> = [];
  const sent = vi.fn(send);
  const onFailed = vi.fn();
  const onSent = vi.fn();
  const hide = vi.fn((key: string) => toasts.find((toast) => toast.key === key)?.end());
  const list = new TimeRemovals({
    send: sent,
    show: (removal, handlers) => toasts.push({ ...removal, ...handlers }),
    hide,
    onSent,
    onFailed,
    onChange: () => undefined,
  });
  return { list, toasts, sent, onFailed, onSent, hide };
}

const settle = () => new Promise((resolve) => setImmediate(resolve));

describe("Remove with Undo (F68)", () => {
  it("hides the entry and sends nothing until its toast ends, then one request", async () => {
    const { list, toasts, sent, onSent } = removals();
    list.remove("a");
    list.remove("a");
    expect(toasts).toHaveLength(1);
    expect(list.isHidden("a")).toBe(true);
    expect(sent).not.toHaveBeenCalled();
    toasts[0].end();
    toasts[0].end();
    list.flush();
    await settle();
    expect(sent).toHaveBeenCalledTimes(1);
    expect(onSent).toHaveBeenCalledWith("a");
    // Refetches that still hold it must not bring it back.
    expect(list.isHidden("a")).toBe(true);
  });

  it("Undo puts it back and sends nothing, whatever the toast says after", async () => {
    const { list, toasts, sent } = removals();
    list.remove("a");
    toasts[0].undo();
    toasts[0].end();
    list.flush();
    await settle();
    expect(list.isHidden("a")).toBe(false);
    expect(sent).not.toHaveBeenCalled();
  });

  it("a toast answers for its own removal only, after Undo and a second Remove", async () => {
    const { list, toasts, sent } = removals();
    list.remove("a");
    toasts[0].undo();
    list.remove("a");
    expect(toasts[1].key).not.toBe(toasts[0].key);
    toasts[0].end();
    expect(sent).not.toHaveBeenCalled();
    expect(list.isHidden("a")).toBe(true);
    toasts[1].end();
    toasts[1].undo();
    await settle();
    expect(sent).toHaveBeenCalledTimes(1);
  });

  it("keeps several removals apart, and leaving the page sends the rest once", async () => {
    const { list, toasts, sent, hide } = removals();
    for (const id of ["a", "b", "c"]) list.remove(id);
    toasts[1].undo();
    toasts[0].end();
    list.flush();
    list.flush();
    await settle();
    expect(sent.mock.calls.map(([id]) => id)).toEqual(["a", "c"]);
    expect(hide).toHaveBeenCalledTimes(1);
    expect(hide).toHaveBeenCalledWith(toasts[2].key);
    expect(list.hiddenIds()).toEqual(["a", "c"]);
  });

  it("a refused delete brings the entry back and says so", async () => {
    const refusal = new Error("nope");
    const { list, toasts, onFailed, onSent } = removals(() => Promise.reject(refusal));
    list.remove("a");
    toasts[0].end();
    await settle();
    expect(list.isHidden("a")).toBe(false);
    expect(onFailed).toHaveBeenCalledWith("a", refusal);
    expect(onSent).not.toHaveBeenCalled();
  });

  it("wires the page: Undo toast, both ends of it, leaving, and no transitionend", () => {
    expect(timeSource).not.toContain("onTransitionEnd");
    expect(timeSource).not.toContain("beforeunload");
    expect(timeSource).toContain('notify.success("Time Entry removed"');
    expect(timeSource).toContain('"Its Activity Evidence goes with it."');
    expect(timeSource).toMatch(/onAutoClose: end,\s*onDismiss: end/);
    expect(timeSource).toContain("useEffect(() => () => removals.flush(), [removals])");
    expect(timeSource).toMatch(/function onDelete\(id: string\) \{\s*if \(readOnly\) \{\s*refuseWrite\(\);\s*return;/);
    expect(timeSource).toContain('data-state={leaving ? "leaving" : "in"}');
  });
});

describe("Pause, Resume and Stop report (F69)", () => {
  it("reports each failure and runs one command at a time", () => {
    for (const command of ["pause", "resume", "stop"]) {
      expect(contextSource).toContain(`onError: (err: unknown) => reportFailure("${command}", err)`);
      expect(contextSource).toMatch(new RegExp(`runCommand\\(\\(\\) => ${command}Mutation\\.mutateAsync`));
    }
    expect(contextSource).toContain("`Could not ${command} the timer`");
    expect(contextSource).toMatch(/if \(commandRef\.current\) return false;/);
  });

  it("the Timer chip signs off only what the server took", () => {
    for (const command of ["Pause", "Resume", "Start", "Stop"]) {
      expect(chipSource).toMatch(new RegExp(`if \\(await handle${command}\\(\\)\\) notify\\.success`));
    }
  });
});

const sale = { id: "s", status: "lead", projectType: "one_time", project: { name: "Audit" }, client: { name: "Bay" } };
const won = { id: "w", status: "won_in_progress", projectType: "one_time", project: { name: "Build" }, client: { name: "Zed" } };
const internal = { id: "i", status: "documented", projectType: "internal", project: { name: "Handbook" }, client: null };
const wiki = { id: "d", status: "documented", isDocumentationOnly: 1, project: { name: "Wiki" }, client: null };

describe("which Projects take time (F71)", () => {
  it("offers delivery Projects only, by Client · Project", () => {
    expect([sale, won, internal, wiki].map(isTimerProject)).toEqual([false, true, true, false]);
    expect(timerProjectOptions([won, sale, wiki, internal])).toEqual([
      { id: "i", label: "Handbook", meta: null },
      { id: "w", label: "Zed · Build", meta: null },
    ]);
  });

  it("keeps every Project in the filter, and marks a sale", () => {
    expect(filterProjectOptions([won, sale]).map(({ label, meta }) => [label, meta])).toEqual([
      ["Bay · Audit", "Opportunity"],
      ["Zed · Build", null],
    ]);
  });

  it("names Projects & Tasks by Client · Project, in order", () => {
    const page = composeProjectTasks({
      workspaceName: "Harbor Co",
      readOnly: false,
      search: "",
      selectedProjectId: null,
      projects: [won, internal],
      tasks: [],
    });
    expect(page.projects.map((project) => project.name)).toEqual(["Handbook", "Zed · Build"]);
  });

  it("uses the one searchable picker, and links a Project with no Task to its Tasks", () => {
    const picker = read("client/src/v2/V2ProjectPicker.tsx");
    expect(picker).toContain('from "@/components/ui/command"');
    expect(picker).toContain('from "@/components/ui/popover"');
    // The Timer, the filter, and the Timer added beside a running one (#400): the same picker each time.
    expect(timeSource.match(/<V2ProjectPicker/g)).toHaveLength(3);
    expect(read("client/src/v2/V2LinkDocumentationDialog.tsx")).toContain("<V2ProjectPicker");
    expect(projectTasksHref("p 1")).toBe("/time/projects?project=p+1");
    expect(timeSource).toContain("This Project has no Task yet.");
    expect(timeSource).toContain("href={projectTasksHref(timerProjectId)}");
    expect(css).toMatch(/\.df-v2 button\.df-project-picker-chip \{/);
  });

  it("starts no Timer on a sale from the chip or the Dossier", () => {
    expect(chipSource).toContain("selected && !isTimerProject(selected)");
    expect(dossierSource.match(/!canTrackTime/g)).toHaveLength(2);
  });
});

describe("the Timer's controls (F74)", () => {
  it("clears the Task with the Project after Stop", () => {
    const stop = contextSource.slice(contextSource.indexOf("const stopMutation"), contextSource.indexOf("commandRef"));
    expect(stop).toMatch(/setSelectedProjectId\(""\);\s*setSelectedTaskId\(""\);/);
  });

  it("makes Start or Stop the main button and Pause or Resume the other", () => {
    expect(timeSource).toMatch(/variant="default"[^>]*onClick=\{onPrimary\}[^>]*>\s*\{busy \? "Stop" : "Start"\}/);
    expect(timeSource).toMatch(/variant="outline"[^>]*onClick=\{onPauseResume\}[^>]*>\s*\{isRunning \? "Pause" : "Resume"\}/);
  });

  it("draws the status as plain text, and only a narrowing filter as active", () => {
    expect(timeSource).not.toContain('className="df-status"');
    expect(timeSource).toContain('className="df-mono df-meta df-time-entry-status">{row.status}');
    expect(timeSource).toContain("active={range !== TIME_FILTERS_DEFAULT.range}");
    for (const name of ["project", "status", "member"]) expect(timeSource).toContain(`active={filters.${name} !== "all"}`);
  });
});

const entry = (overrides: Partial<TimeEntryRowInput> = {}): TimeEntryRowInput => ({
  id: "e1",
  startTime: new Date(2026, 10, 24, 9, 0),
  endTime: new Date(2026, 10, 24, 12, 30),
  duration: 12600,
  status: "stopped",
  userId: "me",
  crmProjectId: "w",
  ...overrides,
});

function register(row: TimeEntryRowInput, overrides = {}) {
  return composeTimeTracking({
    now: NOW,
    currentUserId: "me",
    isAdmin: false,
    isRunning: false,
    displayDuration: 0,
    activeEntryId: null,
    entries: [row],
    workdaySeconds: 9000,
    ...overrides,
  });
}

describe("the register says when and how much (F72)", () => {
  it.each([
    ["today", {}, "09:00 - 12:30"],
    ["running", { status: "running", endTime: null }, "09:00 - now"],
    ["paused", { status: "paused", endTime: null, lastActivityAt: new Date(2026, 10, 24, 10, 5) }, "09:00 - 10:05"],
    ["yesterday", { startTime: new Date(2026, 10, 23, 9, 0), endTime: new Date(2026, 10, 23, 12, 30) }, "Yesterday, 09:00 - 12:30"],
    ["past midnight", { startTime: new Date(2026, 10, 17, 22, 0), endTime: new Date(2026, 10, 18, 2, 0) }, "17 Nov, 22:00 - 02:00 +1 day"],
    ["another year", { startTime: new Date(2025, 11, 30, 9, 0), endTime: new Date(2026, 0, 1, 10, 0) }, "30 Dec 2025, 09:00 - 10:00 +2 days"],
    ["no end", { endTime: null }, "09:00"],
  ])("%s", (_name, overrides, expected) => {
    expect(formatEntryWhen(entry(overrides), NOW)).toBe(expected);
  });

  it("adds the part in the period only when it is a part", () => {
    expect(register(entry({ secondsInPeriod: 12600 })).rows[0].inPeriod).toBeNull();
    expect(register(entry({ secondsInPeriod: 7800 })).rows[0]).toMatchObject({
      duration: "03:30:00",
      inPeriod: "2h 10m in this period",
    });
    // A running entry's own figure ticks; only its start can be outside.
    const running = entry({ status: "running", endTime: null, duration: 600, secondsInPeriod: 900 });
    const period = { periodStart: new Date(2026, 10, 24), liveSeconds: 60 };
    expect(register(running, period).rows[0].inPeriod).toBeNull();
    expect(
      register({ ...running, startTime: new Date(2026, 10, 23, 23, 0) }, period).rows[0].inPeriod,
    ).toBe("16m in this period");
  });

  it("counts the reader's own day and ticks on from the read", () => {
    expect(register(entry()).workdayHours).toBe("You today 2.5 h");
    expect(secondsSinceRead(1_000, 61_500, true, 900)).toBe(60);
    expect(secondsSinceRead(1_000, 61_500, false, 900)).toBe(0);
    expect(secondsSinceRead(0, 61_500, true, 900)).toBe(0);
    // Started elsewhere after the read: only what the entry holds.
    expect(secondsSinceRead(1_000, 61_500, true, 12)).toBe(12);
    expect(timeSource).toMatch(/seenState\.current === activeState/);
    expect(timeSource).toContain("userId: user?.id ?? null,");
    expect(timeStatsPath({ userId: "me" })).toBe("/api/time-tracking/stats?userId=me&includeActive=1");
  });

  it("totals what is listed, under the shared pager", () => {
    expect(rangeTotalLabel(11400, "today")).toBe("3h 10m today");
    expect(rangeTotalLabel(11400, "week")).toBe("3h 10m this week");
    expect(rangeTotalLabel(11400, "all")).toBe("3h 10m in all");
    expect(timeEntriesPath({ page: 2, pageSize: 25 })).toBe("/api/time-tracking/entries?page=2&pageSize=25");
    expect(timeEntriesPath({ limit: 1 })).toBe("/api/time-tracking/entries?limit=1");
    expect(timeSource).toContain("<V2RegisterPager");
  });
});

describe("filters in the address and failed loads (F73)", () => {
  it("round-trips the filters and leaves the defaults out", () => {
    const filters = { range: "all", project: "p1", status: "paused", member: "u1", page: 3, pageSize: 25 } as const;
    expect(readTimeFilters(writeTimeFilters("", filters))).toEqual(filters);
    expect(writeTimeFilters("?range=week&page=2&x=1", TIME_FILTERS_DEFAULT)).toBe("?x=1");
    expect(writeTimePeriod("", "week")).toBe("");
    expect(readTimePeriod(writeTimePeriod("", "30d"))).toBe("30d");
    expect(readChosenProject(writeChosenProject("", "p1"))).toBe("p1");
  });

  it("reads an unknown value as its default", () => {
    expect(readTimeFilters("?range=year&status=odd&page=-2&size=7")).toEqual(TIME_FILTERS_DEFAULT);
    expect(readTimePeriod("?period=year")).toBe("week");
    expect(knownFilterId("gone", [{ id: "p1" }])).toBe("all");
    expect(knownFilterId("p1", [{ id: "p1" }])).toBe("p1");
    expect(knownFilterId("p1", null)).toBe("p1");
  });

  it("gives each list its failed state, keeps cached rows, and re-reads each visit", () => {
    for (const id of ["v2-time", "v2-time-stats", "v2-time-projects", "v2-time-tasks"]) {
      expect(timeSource).toContain(`testId="${id}-load-failed"`);
      expect(timeSource).toContain(`"${id}-refresh-failed"`);
    }
    expect(timeSource.match(/<V2LoadFailed/g)).toHaveLength(4);
    expect(timeSource.match(/staleTime: 0/g)).toHaveLength(4);
    expect(timeSource).toContain("setFilters({ ...filters, page: paging.pageCount })");
    expect(timeSource).toContain("placeholderData: keepPreviousData");
  });
});
