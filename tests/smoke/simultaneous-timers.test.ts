import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { PARALLEL_WORKSPACE_ID, SEEDED_WORKSPACE_ID, workspaceBilling } from "../../shared/schema";
import { runWithWorkspaceContext } from "../../server/workspaceContext";
import { ownerDb, resetDb } from "../helpers/db";
import {
  addWorkspaceMembership,
  createSeededMember,
  inSeededWorkspace,
  plantParallelWorkspace,
} from "../helpers/workspace";

/**
 * #400, ADR-0031: up to three Timers at once. The Time module interface
 * against a real database is the seam, as for #117 (timer-commands.test.ts).
 * The one-Timer rule with the option off stays frozen in
 * time-tracking.test.ts and timer-counts-once.test.ts.
 */

const LAUNCH_ENV = "SIMULTANEOUS_TIMERS_LAUNCH_AT";
const T0 = new Date("2026-08-01T09:00:00.000Z").getTime();
const at = (minutes: number) => new Date(T0 + minutes * 60_000);

let sequence = 0;

async function seed() {
  const { storage } = await import("../../server/storage");
  const user = await createSeededMember({ email: "multi@test.invalid", firstName: "Multi" });
  return inSeededWorkspace(async () => {
    const { crmProject: atlas } = await storage.createCrmProjectWithBase({ name: "Atlas", ownerId: user.id });
    const { crmProject: borealis } = await storage.createCrmProjectWithBase({ name: "Borealis", ownerId: user.id });
    const { crmProject: cobalt } = await storage.createCrmProjectWithBase({ name: "Cobalt", ownerId: user.id });
    const { crmProject: delta } = await storage.createCrmProjectWithBase({ name: "Delta", ownerId: user.id });
    const ledger = await storage.createTask({ crmProjectId: atlas.id, name: "Ledger" });
    const audit = await storage.createTask({ crmProjectId: atlas.id, name: "Audit" });
    const map = await storage.createTask({ crmProjectId: borealis.id, name: "Map" });
    const ink = await storage.createTask({ crmProjectId: cobalt.id, name: "Ink" });
    const dock = await storage.createTask({ crmProjectId: delta.id, name: "Dock" });
    return { storage, user, atlas, borealis, cobalt, delta, ledger, audit, map, ink, dock };
  });
}

async function setOption(enabled: boolean) {
  const { upsertScreenshotPolicy } = await import("../../server/modules/activity/policy");
  await inSeededWorkspace(() => upsertScreenshotPolicy({ simultaneousTimersEnabled: enabled }));
}

async function time() {
  return import("../../server/modules/time/commands");
}

type Kind = "start" | "pause" | "resume" | "stop";

async function command(
  userId: string,
  kind: Kind,
  minutes: number,
  payload: Record<string, unknown>,
  extra: { floorAtLastCommand?: boolean; receivedMinutes?: number } = {},
) {
  const { applyTimerCommand } = await time();
  return inSeededWorkspace(() =>
    applyTimerCommand({
      userId,
      origin: "web-session-multi",
      sequence: ++sequence,
      kind,
      claimedEffectiveAt: at(minutes),
      receivedAt: at(extra.receivedMinutes ?? minutes),
      payload,
      floorAtLastCommand: extra.floorAtLastCommand,
    }),
  );
}

async function entries(storage: Awaited<ReturnType<typeof seed>>["storage"], userId: string) {
  return inSeededWorkspace(() => storage.getTimeEntries({ userId }));
}

describe("Simultaneous Timers through the Time module (#400)", () => {
  beforeEach(async () => {
    await resetDb();
    process.env[LAUNCH_ENV] = "2026-01-01T00:00:00.000Z";
  });

  afterEach(() => {
    delete process.env[LAUNCH_ENV];
  });

  it("refuses to add a Timer while the option is off, and Start still switches", async () => {
    const w = await seed();
    const { TimerStartRefusedError } = await time();
    await command(w.user.id, "start", 0, { crmProjectId: w.atlas.id, taskId: w.ledger.id });

    await expect(
      command(w.user.id, "start", 10, { crmProjectId: w.borealis.id, taskId: w.map.id, mode: "add" }),
    ).rejects.toMatchObject({ name: TimerStartRefusedError.name, code: "simultaneous_timers_off" });

    await command(w.user.id, "start", 20, { crmProjectId: w.borealis.id, taskId: w.map.id });
    const rows = await entries(w.storage, w.user.id);
    expect(rows.filter((row) => row.status === "running").map((row) => row.taskId)).toEqual([w.map.id]);
  });

  it("refuses to add before the launch and on a Plan without Tasks, even with the option on", async () => {
    const w = await seed();
    await setOption(true);
    await command(w.user.id, "start", 0, { crmProjectId: w.atlas.id, taskId: w.ledger.id });

    process.env[LAUNCH_ENV] = "2099-01-01T00:00:00.000Z";
    await expect(
      command(w.user.id, "start", 5, { crmProjectId: w.borealis.id, taskId: w.map.id, mode: "add" }),
    ).rejects.toMatchObject({ code: "simultaneous_timers_off" });

    process.env[LAUNCH_ENV] = "2026-01-01T00:00:00.000Z";
    await ownerDb
      .update(workspaceBilling)
      .set({ planKey: "starter", registryVersion: 2, billingState: "Active" })
      .where(eq(workspaceBilling.workspaceId, SEEDED_WORKSPACE_ID));
    await expect(
      command(w.user.id, "start", 6, { crmProjectId: w.borealis.id, taskId: w.map.id, mode: "add" }),
    ).rejects.toMatchObject({ code: "simultaneous_timers_off" });
  });

  it("adds keeping the others running, and Switch stops every one of them", async () => {
    const w = await seed();
    await setOption(true);
    await command(w.user.id, "start", 0, { crmProjectId: w.atlas.id, taskId: w.ledger.id });
    await command(w.user.id, "start", 10, { crmProjectId: w.borealis.id, taskId: w.map.id, mode: "add" });

    let rows = await entries(w.storage, w.user.id);
    expect(rows.filter((row) => row.status === "running")).toHaveLength(2);

    await command(w.user.id, "start", 30, { crmProjectId: w.cobalt.id, taskId: w.ink.id, mode: "switch" });
    rows = await entries(w.storage, w.user.id);
    expect(rows.filter((row) => row.status === "running").map((row) => row.taskId)).toEqual([w.ink.id]);
    const ledger = rows.find((row) => row.taskId === w.ledger.id)!;
    const map = rows.find((row) => row.taskId === w.map.id)!;
    expect([ledger.status, ledger.duration]).toEqual(["stopped", 30 * 60]);
    expect([map.status, map.duration]).toEqual(["stopped", 20 * 60]);
  });

  it("refuses a fourth Timer", async () => {
    const w = await seed();
    await setOption(true);
    await command(w.user.id, "start", 0, { crmProjectId: w.atlas.id, taskId: w.ledger.id });
    await command(w.user.id, "start", 1, { crmProjectId: w.borealis.id, taskId: w.map.id, mode: "add" });
    await command(w.user.id, "start", 2, { crmProjectId: w.cobalt.id, taskId: w.ink.id, mode: "add" });

    await expect(
      command(w.user.id, "start", 3, { crmProjectId: w.delta.id, taskId: w.dock.id, mode: "add" }),
    ).rejects.toMatchObject({ code: "timer_limit" });

    // A paused Timer still occupies its place.
    const rows = await entries(w.storage, w.user.id);
    await command(w.user.id, "pause", 4, { timeEntryId: rows.find((row) => row.taskId === w.ink.id)!.id });
    await expect(
      command(w.user.id, "start", 5, { crmProjectId: w.delta.id, taskId: w.dock.id, mode: "add" }),
    ).rejects.toMatchObject({ code: "timer_limit" });
  });

  it("refuses a second Timer on the same Task, and lets two Tasks of one Project run", async () => {
    const w = await seed();
    await setOption(true);
    await command(w.user.id, "start", 0, { crmProjectId: w.atlas.id, taskId: w.ledger.id });

    await expect(
      command(w.user.id, "start", 1, { crmProjectId: w.atlas.id, taskId: w.ledger.id, mode: "add" }),
    ).rejects.toMatchObject({ code: "task_has_timer" });

    await command(w.user.id, "start", 2, { crmProjectId: w.atlas.id, taskId: w.audit.id, mode: "add" });
    const rows = await entries(w.storage, w.user.id);
    expect(rows.filter((row) => row.status === "running")).toHaveLength(2);
  });

  it("lets a Timer without a Task occupy its whole Project", async () => {
    const w = await seed();
    await setOption(true);
    await command(w.user.id, "start", 0, { crmProjectId: w.atlas.id, taskId: null });

    await expect(
      command(w.user.id, "start", 1, { crmProjectId: w.atlas.id, taskId: w.ledger.id, mode: "add" }),
    ).rejects.toMatchObject({ code: "project_has_timer" });
    await expect(
      command(w.user.id, "start", 1, { crmProjectId: w.atlas.id, taskId: null, mode: "add" }),
    ).rejects.toMatchObject({ code: "project_has_timer" });

    await command(w.user.id, "start", 2, { crmProjectId: w.borealis.id, taskId: w.map.id, mode: "add" });
    await expect(
      command(w.user.id, "start", 3, { crmProjectId: w.borealis.id, taskId: null, mode: "add" }),
    ).rejects.toMatchObject({ code: "project_has_timer" });
  });

  it("refuses a Timer while one runs in another Workspace, adding or switching", async () => {
    const w = await seed();
    await setOption(true);
    const { storage } = await import("../../server/storage");
    const { applyTimerCommand } = await time();
    await plantParallelWorkspace();
    await addWorkspaceMembership(w.user.id, PARALLEL_WORKSPACE_ID, "member");
    const inParallel = <T>(fn: () => T) =>
      runWithWorkspaceContext({ workspaceId: PARALLEL_WORKSPACE_ID, userId: w.user.id }, fn);
    const harbour = await inParallel(async () => {
      const { crmProject } = await storage.createCrmProjectWithBase({ name: "Harbour", ownerId: w.user.id });
      const task = await storage.createTask({ crmProjectId: crmProject.id, name: "Quay" });
      return { crmProject, task };
    });
    await inParallel(() =>
      applyTimerCommand({
        userId: w.user.id,
        origin: "web-session-harbour",
        sequence: ++sequence,
        kind: "start",
        claimedEffectiveAt: at(0),
        receivedAt: at(0),
        payload: { crmProjectId: harbour.crmProject.id, taskId: harbour.task.id },
      }),
    );

    await expect(
      command(w.user.id, "start", 5, { crmProjectId: w.atlas.id, taskId: w.ledger.id, mode: "add" }),
    ).rejects.toMatchObject({ code: "timer_in_other_workspace" });
    await expect(
      command(w.user.id, "start", 6, { crmProjectId: w.atlas.id, taskId: w.ledger.id }),
    ).rejects.toMatchObject({ code: "timer_in_other_workspace" });
  });

  it("leaves running Timers running when the option is turned off, and refuses a new one", async () => {
    const w = await seed();
    await setOption(true);
    await command(w.user.id, "start", 0, { crmProjectId: w.atlas.id, taskId: w.ledger.id });
    await command(w.user.id, "start", 5, { crmProjectId: w.borealis.id, taskId: w.map.id, mode: "add" });

    await setOption(false);
    let rows = await entries(w.storage, w.user.id);
    expect(rows.filter((row) => row.status === "running")).toHaveLength(2);

    await expect(
      command(w.user.id, "start", 10, { crmProjectId: w.cobalt.id, taskId: w.ink.id, mode: "add" }),
    ).rejects.toMatchObject({ code: "simultaneous_timers_off" });

    // Each one still stops on its own.
    await command(w.user.id, "stop", 20, { timeEntryId: rows.find((row) => row.taskId === w.ledger.id)!.id });
    rows = await entries(w.storage, w.user.id);
    expect(rows.filter((row) => row.status === "running").map((row) => row.taskId)).toEqual([w.map.id]);
  });

  it("pauses, resumes and stops one Timer without touching the other", async () => {
    const w = await seed();
    await setOption(true);
    const a = (await command(w.user.id, "start", 0, { crmProjectId: w.atlas.id, taskId: w.ledger.id })).timeEntry!;
    const b = (
      await command(w.user.id, "start", 10, { crmProjectId: w.borealis.id, taskId: w.map.id, mode: "add" })
    ).timeEntry!;

    await command(w.user.id, "pause", 20, { timeEntryId: a.id });
    await command(w.user.id, "resume", 30, { timeEntryId: a.id, discardIdleTime: true });
    await command(w.user.id, "stop", 40, { timeEntryId: b.id });
    await command(w.user.id, "stop", 50, { timeEntryId: a.id });

    const rows = await entries(w.storage, w.user.id);
    const ledger = rows.find((row) => row.id === a.id)!;
    const map = rows.find((row) => row.id === b.id)!;
    expect([ledger.status, ledger.duration]).toEqual(["stopped", 40 * 60]);
    expect([map.status, map.duration]).toEqual(["stopped", 30 * 60]);
  });

  it("applies a late pause on one Timer at its claimed time, leaving the Timer added after it whole", async () => {
    const w = await seed();
    await setOption(true);
    const a = (await command(w.user.id, "start", 0, { crmProjectId: w.atlas.id, taskId: w.ledger.id })).timeEntry!;
    const b = (
      await command(w.user.id, "start", 30, { crmProjectId: w.borealis.id, taskId: w.map.id, mode: "add" })
    ).timeEntry!;

    // The agent reports, at 0:40, that A paused at 0:20 when the Member left (ADR-0030).
    await command(w.user.id, "pause", 20, { timeEntryId: a.id }, { floorAtLastCommand: true, receivedMinutes: 40 });
    await command(w.user.id, "stop", 60, { timeEntryId: b.id });

    const rows = await entries(w.storage, w.user.id);
    const ledger = rows.find((row) => row.id === a.id)!;
    const map = rows.find((row) => row.id === b.id)!;
    // The floor is A's own latest command, not B's later start.
    expect([ledger.status, ledger.duration]).toEqual(["paused", 20 * 60]);
    expect([map.status, map.duration]).toEqual(["stopped", 30 * 60]);
  });

  it("floors a dated pause at a later switch that stopped its Timer, as ADR-0030 did with one Timer", async () => {
    const w = await seed();
    const { listTimerCommands } = await time();
    // Option off. The agent's Timer A runs; the web switches to B at 0:30.
    const a = (await command(w.user.id, "start", 0, { crmProjectId: w.atlas.id, taskId: w.ledger.id })).timeEntry!;
    await command(w.user.id, "start", 30, { crmProjectId: w.borealis.id, taskId: w.map.id });
    // At 0:40 the agent reports that A paused at 0:20, when the Member left.
    const late = await command(w.user.id, "pause", 20, { timeEntryId: a.id }, { floorAtLastCommand: true, receivedMinutes: 40 });

    // Floored at the switch: a no-op on a stopped Timer, not a replay of every command.
    expect(late.command).toMatchObject({ clamped: true });
    expect(late.command.claimedEffectiveAt.toISOString()).toBe(at(30).toISOString());
    const rows = await entries(w.storage, w.user.id);
    const ledger = rows.find((row) => row.id === a.id)!;
    expect([ledger.status, ledger.duration]).toEqual(["stopped", 30 * 60]);
    expect(new Date(ledger.endTime!).toISOString()).toBe(at(30).toISOString());
    expect(await inSeededWorkspace(() => listTimerCommands(w.user.id))).toHaveLength(3);
  });

  it("replays a late switch so the Timers it stops end where it took effect", async () => {
    const w = await seed();
    await setOption(true);
    await command(w.user.id, "start", 0, { crmProjectId: w.atlas.id, taskId: w.ledger.id });
    await command(w.user.id, "start", 10, { crmProjectId: w.borealis.id, taskId: w.map.id, mode: "add" });
    // A switch claimed at 0:30 arrives at 0:45, after a stop of nothing later.
    await command(w.user.id, "start", 40, { crmProjectId: w.delta.id, taskId: w.dock.id, mode: "add" });
    await command(
      w.user.id,
      "start",
      30,
      { crmProjectId: w.cobalt.id, taskId: w.ink.id, mode: "switch" },
      { receivedMinutes: 45 },
    );

    const rows = await entries(w.storage, w.user.id);
    const byTask = (taskId: string) => rows.find((row) => row.taskId === taskId)!;
    expect([byTask(w.ledger.id).status, byTask(w.ledger.id).duration]).toEqual(["stopped", 30 * 60]);
    expect([byTask(w.map.id).status, byTask(w.map.id).duration]).toEqual(["stopped", 20 * 60]);
    expect(byTask(w.ink.id).status).toBe("running");
    expect(byTask(w.dock.id).status).toBe("running");
  });

  it("lists every active Timer of the User, newest first", async () => {
    const w = await seed();
    await setOption(true);
    await command(w.user.id, "start", 0, { crmProjectId: w.atlas.id, taskId: w.ledger.id });
    await command(w.user.id, "start", 10, { crmProjectId: w.borealis.id, taskId: w.map.id, mode: "add" });

    const active = await w.storage.getActiveTimeEntries(w.user.id);
    expect(active.map((entry) => entry.taskId)).toEqual([w.map.id, w.ledger.id]);
    expect((await w.storage.getActiveTimeEntry(w.user.id))?.taskId).toBe(w.map.id);
  });

  describe("Worked Time counts each hour once (ADR-0031)", () => {
    const day = { startDate: new Date("2026-08-01T00:00:00.000Z"), endDate: new Date("2026-08-01T23:59:59.999Z") };

    it("gives 4h on A and 2h on B, 1h30 of it together, 4h30 of Worked Time and 1h30 simultaneous", async () => {
      const w = await seed();
      await setOption(true);
      const a = (await command(w.user.id, "start", 0, { crmProjectId: w.atlas.id, taskId: w.ledger.id })).timeEntry!;
      const b = (
        await command(w.user.id, "start", 150, { crmProjectId: w.borealis.id, taskId: w.map.id, mode: "add" })
      ).timeEntry!;
      await command(w.user.id, "stop", 240, { timeEntryId: a.id });
      await command(w.user.id, "stop", 270, { timeEntryId: b.id });

      const stats = await inSeededWorkspace(() => w.storage.getTimeStats({ userId: w.user.id, ...day }));
      expect(stats.totalDuration).toBe(270 * 60);
      expect(stats.simultaneousDuration).toBe(90 * 60);
      expect(stats.byUser).toEqual([expect.objectContaining({ userId: w.user.id, totalDuration: 270 * 60 })]);
      const project = (id: string) => stats.byProject.find((row) => row.crmProjectId === id)?.totalDuration;
      expect([project(w.atlas.id), project(w.borealis.id)]).toEqual([240 * 60, 120 * 60]);

      const analytics = { startDate: day.startDate, endDate: day.endDate, timeZone: "UTC", userId: w.user.id };
      const productivity = await inSeededWorkspace(() => w.storage.getAdminProductivity(analytics));
      expect(productivity.byUser[0].totalSeconds).toBe(270 * 60);
      expect(productivity.dailyTrend).toEqual([{ date: "2026-08-01", totalSeconds: 270 * 60 }]);
      const overview = await inSeededWorkspace(() => w.storage.getAdminOverview(analytics));
      expect(overview.totalTrackedSeconds).toBe(270 * 60);

      const exported = await inSeededWorkspace(() => w.storage.getTimeExport(analytics));
      expect(exported.reduce((sum, row) => sum + row.seconds, 0)).toBe(360 * 60);
      expect(exported.reduce((sum, row) => sum + row.workedSeconds, 0)).toBe(270 * 60);
    });

    it("gives two Tasks of one Project an hour each and the Project one hour when they run together", async () => {
      const w = await seed();
      await setOption(true);
      const a = (await command(w.user.id, "start", 0, { crmProjectId: w.atlas.id, taskId: w.ledger.id })).timeEntry!;
      const b = (
        await command(w.user.id, "start", 0, { crmProjectId: w.atlas.id, taskId: w.audit.id, mode: "add" })
      ).timeEntry!;
      await command(w.user.id, "stop", 60, { timeEntryId: a.id });
      await command(w.user.id, "stop", 60, { timeEntryId: b.id });

      const stats = await inSeededWorkspace(() => w.storage.getTimeStats({ userId: w.user.id, ...day }));
      expect(stats.byProject).toEqual([expect.objectContaining({ crmProjectId: w.atlas.id, totalDuration: 3600 })]);
      expect([stats.totalDuration, stats.simultaneousDuration]).toEqual([3600, 3600]);
      const tasks = await inSeededWorkspace(() =>
        w.storage.getTasksDurationToday(w.user.id, [w.ledger.id, w.audit.id], day.startDate, day.endDate),
      );
      expect(tasks).toEqual({ [w.ledger.id]: 3600, [w.audit.id]: 3600 });

      // The budget meter and the Project Dossier count the Project once too (ADR-0031).
      expect(await inSeededWorkspace(() => w.storage.getCrmProjectTrackedSeconds(w.atlas.id))).toBe(3600);
      const listed = await inSeededWorkspace(() =>
        w.storage.getCrmProjects(w.user.id, { page: 1, pageSize: 50, withTrackedTime: true }),
      );
      const atlas = listed.data.find((row) => row.id === w.atlas.id) as { trackedSeconds?: number } | undefined;
      expect(atlas?.trackedSeconds).toBe(3600);
    });

    it("counts no simultaneous time while one Timer is paused and the other runs", async () => {
      const w = await seed();
      await setOption(true);
      const a = (await command(w.user.id, "start", 0, { crmProjectId: w.atlas.id, taskId: w.ledger.id })).timeEntry!;
      await command(w.user.id, "pause", 10, { timeEntryId: a.id });
      const b = (
        await command(w.user.id, "start", 20, { crmProjectId: w.borealis.id, taskId: w.map.id, mode: "add" })
      ).timeEntry!;
      await command(w.user.id, "stop", 40, { timeEntryId: b.id });
      await command(w.user.id, "resume", 50, { timeEntryId: a.id, discardIdleTime: true });
      await command(w.user.id, "stop", 60, { timeEntryId: a.id });

      const stats = await inSeededWorkspace(() => w.storage.getTimeStats({ userId: w.user.id, ...day }));
      expect([stats.totalDuration, stats.simultaneousDuration]).toEqual([40 * 60, 0]);
    });
  });
});
