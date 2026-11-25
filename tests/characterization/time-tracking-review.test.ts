import { randomUUID } from "crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { crmProjects, opportunities, projects, tasks, timeEntries, timeEntryScreenshots } from "@shared/schema";
import { eq } from "drizzle-orm";
import { timeEntrySpan, timePortion, type TimeSpan } from "../../shared/timePortion";
import { makeApp } from "../helpers/app";
import { ownerDb, resetDb } from "../helpers/db";
import { registerAdmin, registerUser, type TestUser } from "../helpers/auth";
import { createClient, createCrmProject, createTask, startTimer } from "../helpers/fixtures";
import { loginDevice } from "../helpers/agent";
import { plantParallelWorkspace } from "../helpers/workspace";

/** Server half of the Time Tracking review: F67, F70, F71, F74. */

const HOUR = 3600;
const MIN = 60_000;

/** Days in UTC+1, as a browser there sends them. */
function day(date: string): { startDate: string; endDate: string } {
  return {
    startDate: new Date(`${date}T00:00:00.000+01:00`).toISOString(),
    endDate: new Date(`${date}T23:59:59.999+01:00`).toISOString(),
  };
}
const period = (date: string) => ({ start: new Date(day(date).startDate), end: new Date(day(date).endDate) });
const at = (local: string) => new Date(`${local}:00.000+01:00`);

function span(start: string, end: string, seconds: number, idleSeconds = 0): TimeSpan {
  return { start: at(start), end: at(end), seconds, idleSeconds };
}

type Overrides = Partial<typeof timeEntries.$inferInsert>;

async function plant(userId: string, crmProjectId: string, values: Overrides): Promise<string> {
  const id = values.id ?? randomUUID();
  await ownerDb.insert(timeEntries).values({
    userId,
    crmProjectId,
    startTime: at("2026-03-10T09:00"),
    status: "stopped",
    workspaceId: "seeded",
    ...values,
    id,
  } as typeof timeEntries.$inferInsert);
  return id;
}

async function setup() {
  const app = await makeApp();
  const admin = await registerAdmin(app, { firstName: "Ada", lastName: "Min" });
  const member = await registerUser(app, { firstName: "Mel", lastName: "Ber" });
  const { crmProject } = await createCrmProject(admin.agent, {
    name: "Delivery",
    projectType: "internal",
    memberIds: [admin.id, member.id],
  });
  return { app, admin, member, projectId: crmProject.id };
}

const stats = async (user: TestUser, query: object) => {
  const res = await user.agent.get("/api/time-tracking/stats").query(query);
  expect(res.status).toBe(200);
  return res.body;
};
const page = async (user: TestUser, query: object) => {
  const res = await user.agent.get("/api/time-tracking/entries").query({ page: 1, ...query });
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return res.body;
};

describe("the part of a Time Entry inside a period (F67)", () => {
  it("cuts both ends in proportion of the wall time", () => {
    const entry = span("2026-03-10T22:00", "2026-03-11T02:00", 4 * HOUR, 1200);
    expect(timePortion(entry, period("2026-03-10"))).toEqual({ seconds: 2 * HOUR, idleSeconds: 600 });
    expect(timePortion(entry, period("2026-03-11"))).toEqual({ seconds: 2 * HOUR, idleSeconds: 600 });
    expect(timePortion(entry, period("2026-03-12"))).toEqual({ seconds: 0, idleSeconds: 0 });
    expect(timePortion(entry, {})).toEqual({ seconds: 4 * HOUR, idleSeconds: 1200 });
    expect(timePortion(entry, { start: at("2026-03-11T01:00") }).seconds).toBe(HOUR);
    expect(timePortion(entry, { end: at("2026-03-10T23:00") }).seconds).toBe(HOUR);
  });

  it.each([
    ["over three days", span("2026-03-10T17:43", "2026-03-13T05:11", 100_003, 4_001)],
    ["163 hours long", span("2026-03-08T03:07", "2026-03-14T22:07", 163 * HOUR, 7)],
    ["shorter than its wall time", span("2026-03-10T22:00", "2026-03-11T02:00", 5_003, 9_397)],
    ["longer than its wall time", span("2026-03-10T23:00", "2026-03-11T01:00", 50_001)],
  ])("gives days that add up to an entry %s", (_name, entry) => {
    const days = Array.from({ length: 10 }, (_, i) => period(`2026-03-${String(7 + i).padStart(2, "0")}`));
    const sum = days.reduce((total, d) => total + timePortion(entry, d).seconds, 0);
    const idle = days.reduce((total, d) => total + timePortion(entry, d).idleSeconds, 0);
    // Each midnight loses the millisecond between 23:59:59.999 and 00:00.
    expect(Math.abs(sum - entry.seconds)).toBeLessThanOrEqual(7);
    expect(Math.abs(idle - entry.idleSeconds)).toBeLessThanOrEqual(7);
    // Periods that share their bound lose nothing at all.
    const whole = days.reduce(
      (total, d) => total + timePortion(entry, { start: d.start, end: new Date(d.end.getTime() + 1) }).seconds,
      0,
    );
    expect(whole).toBe(entry.seconds);
  });

  it("gives an entry with no wall time whole to the period its instant is in", () => {
    const now = at("2026-03-20T12:00");
    const base = { duration: 90, idleTime: 5, status: "stopped", lastActivityAt: null };
    const noon = at("2026-03-10T12:00");
    for (const endTime of [noon, at("2026-03-09T12:00")]) {
      const entry = timeEntrySpan({ ...base, startTime: noon, endTime }, now);
      expect(timePortion(entry, period("2026-03-10"))).toEqual({ seconds: 90, idleSeconds: 5 });
      expect(timePortion(entry, period("2026-03-09")).seconds).toBe(0);
    }
    // No end recorded: it ends where its seconds do.
    const open = timeEntrySpan({ ...base, duration: 4 * HOUR, startTime: at("2026-03-10T22:00"), endTime: null }, now);
    expect(timePortion(open, period("2026-03-11")).seconds).toBe(2 * HOUR);
  });

  it("reads a running, a stale and a paused entry", () => {
    const now = at("2026-03-10T12:00");
    const base = { startTime: at("2026-03-10T10:00"), endTime: null, duration: 600, idleTime: 0 };
    const ago = (ms: number) => new Date(now.getTime() - ms);
    expect(timeEntrySpan({ ...base, status: "running", lastActivityAt: ago(30_000) }, now)).toMatchObject({ seconds: 630, end: now });
    expect(timeEntrySpan({ ...base, status: "running", lastActivityAt: ago(10 * MIN) }, now).seconds).toBe(1200);
    expect(timeEntrySpan({ ...base, status: "running", lastActivityAt: ago(10 * MIN + 1) }, now)).toMatchObject({
      seconds: 600,
      end: ago(10 * MIN + 1),
    });
    // A device whose clock is ahead takes nothing back.
    expect(timeEntrySpan({ ...base, status: "running", lastActivityAt: ago(-5 * MIN) }, now).seconds).toBe(600);
    expect(timeEntrySpan({ ...base, status: "paused", lastActivityAt: ago(60 * MIN) }, now)).toMatchObject({
      seconds: 600,
      end: ago(60 * MIN),
    });
  });
});

describe("time figures (F67)", () => {
  beforeEach(resetDb);

  it("counts an entry across midnight once, in every figure, and the agent agrees", async () => {
    const { app, member, projectId } = await setup();
    const device = await loginDevice(app, member);
    const task = await createTask(member.agent, projectId, "Night work");
    await plant(member.id, projectId, {
      taskId: task.id,
      startTime: at("2026-03-10T22:00"),
      endTime: at("2026-03-11T02:00"),
      duration: 3 * HOUR,
      idleTime: HOUR,
    });
    // A start after the period, a start before it, and one with no end recorded.
    await plant(member.id, projectId, { startTime: at("2026-03-09T21:00"), endTime: at("2026-03-12T03:00"), duration: 54 * HOUR });
    await plant(member.id, projectId, { startTime: at("2026-03-11T23:00"), endTime: null, duration: 2 * HOUR });

    const expected: Record<string, [number, number]> = {
      "2026-03-09": [3, 1],
      "2026-03-10": [24 + 1.5, 2],
      "2026-03-11": [24 + 1.5 + 1, 3],
      "2026-03-12": [3 + 1, 2],
    };
    let sum = 0;
    for (const [date, [hours, count]] of Object.entries(expected)) {
      const body = await stats(member, day(date));
      expect(Math.abs(body.totalDuration - hours * HOUR), date).toBeLessThanOrEqual(3);
      expect(body.entriesCount, date).toBe(count);
      expect(body.byProject).toEqual([{ crmProjectId: projectId, projectName: "Delivery", totalDuration: body.totalDuration }]);
      expect(body.byUser).toEqual([{ userId: member.id, userName: "Mel Ber", totalDuration: body.totalDuration }]);
      sum += body.totalDuration;

      const window = { start: day(date).startDate, end: day(date).endDate };
      const worked = await device.request.get("/api/agent/worked-today").query(window);
      expect(worked.body.total, date).toBe(body.totalDuration);
      const breakdown = await device.request.get("/api/agent/today-breakdown").query(window);
      const rows = breakdown.body.rows as Array<{ stoppedSeconds: number }>;
      expect(rows.reduce((total, row) => total + row.stoppedSeconds, 0), date).toBe(body.totalDuration);
    }
    expect(Math.abs(sum - (3 + 54 + 2) * HOUR)).toBeLessThanOrEqual(6);
    expect(Math.abs((await stats(member, day("2026-03-11"))).totalIdleTime - HOUR / 2)).toBeLessThanOrEqual(1);
    const bounded = await stats(member, { startDate: at("2026-03-12T00:00").toISOString() });
    expect(Math.abs(bounded.totalDuration - 4 * HOUR)).toBeLessThanOrEqual(1);

    const { storage } = await import("../../server/storage");
    const { inSeededWorkspace } = await import("../helpers/workspace");
    const { start, end } = period("2026-03-11");
    expect(await inSeededWorkspace(() => storage.getTaskDurationToday(member.id, task.id, start, end))).toBe(1.5 * HOUR);
    expect(await inSeededWorkspace(() => storage.getTasksDurationToday(member.id, [task.id], start, end))).toEqual({
      [task.id]: 1.5 * HOUR,
    });
  });

  it("counts running and paused entries only when asked, and not the time since the agent died", async () => {
    const { app, admin, member, projectId } = await setup();
    const device = await loginDevice(app, member);
    const now = Date.now();
    await plant(member.id, projectId, {
      status: "running",
      startTime: new Date(now - 60 * MIN),
      lastActivityAt: new Date(now - 2 * MIN),
      duration: 1000,
    });
    await plant(admin.id, projectId, {
      status: "paused",
      startTime: new Date(now - 4 * 60 * MIN),
      lastActivityAt: new Date(now - 3 * 60 * MIN),
      duration: 1800,
    });
    const third = await registerUser(app);
    await plant(third.id, projectId, {
      status: "running",
      startTime: new Date(now - 9 * 60 * MIN),
      lastActivityAt: new Date(now - 8 * 60 * MIN),
      duration: 1700,
    });

    expect(await stats(member, {})).toMatchObject({ totalDuration: 0, entriesCount: 0, byProject: [] });
    expect((await device.request.get("/api/agent/worked-today")).body).toEqual({ total: 0 });
    expect((await device.request.get("/api/agent/today-breakdown")).body).toEqual({ rows: [] });

    const live = await stats(member, { includeActive: "1" });
    expect(live.entriesCount).toBe(1);
    expect(live.totalDuration).toBeGreaterThanOrEqual(1120);
    expect(live.totalDuration).toBeLessThan(1135);

    const everyone = await stats(admin, { includeActive: "1" });
    expect(everyone.totalDuration - 1800 - 1700).toBeGreaterThanOrEqual(1120);
    expect(everyone.totalDuration - 1800 - 1700).toBeLessThan(1135);

    // Since 30 minutes ago the paused and the dead ones are over: only half the live one is left.
    const since = { startDate: new Date(now - 30 * MIN).toISOString() };
    const recent = await stats(admin, { includeActive: "1", ...since });
    expect(recent.entriesCount).toBe(1);
    expect(Math.abs(recent.totalDuration - 560)).toBeLessThanOrEqual(10);
    const listed = await page(admin, since);
    expect(listed.total).toBe(1);
    expect(Math.abs(listed.totals.duration - recent.totalDuration)).toBeLessThanOrEqual(2);
    const paused = await page(admin, { ...since, startDate: new Date(now - 3.5 * 60 * MIN).toISOString(), status: "paused" });
    expect(paused.data.map((row: { secondsInPeriod: number }) => row.secondsInPeriod)).toEqual([900]);
  });

  it("keeps another Workspace's entries and captures out of the figures", async () => {
    const { admin, projectId } = await setup();
    const workspaceId = await plantParallelWorkspace();
    const [project] = await ownerDb.insert(projects).values({ name: "Other", ownerId: admin.id, workspaceId }).returning();
    const [other] = await ownerDb.insert(crmProjects).values({ projectId: project.id, status: "won_in_progress", workspaceId }).returning();
    const foreign = await plant(admin.id, other.id, { workspaceId, endTime: at("2026-03-10T10:00"), duration: HOUR });
    const own = await plant(admin.id, projectId, { endTime: at("2026-03-10T10:00"), duration: 60 });
    const shot = (timeEntryId: string, crmProjectId: string, ws: string) => ({
      timeEntryId,
      crmProjectId,
      userId: admin.id,
      storageKey: `/objects/${randomUUID()}`,
      capturedAt: at("2026-03-10T09:30"),
      workspaceId: ws,
    });
    await ownerDb.insert(timeEntryScreenshots).values([shot(foreign, other.id, workspaceId), shot(own, projectId, "seeded")]);

    const body = await stats(admin, day("2026-03-10"));
    expect(body).toMatchObject({ totalDuration: 60, entriesCount: 1, screenshotCount: 1 });
    const listed = await page(admin, {});
    expect(listed.data.map((row: { id: string }) => row.id)).toEqual([own]);
    expect((await admin.agent.delete(`/api/time-tracking/${foreign}`)).status).toBe(404);
  });
});

describe("the register's pages (F70)", () => {
  beforeEach(resetDb);

  it("pages the entries touching the period, with totals over every match", async () => {
    const { admin, member, projectId } = await setup();
    const before = await plant(member.id, projectId, { startTime: at("2026-03-09T22:00"), endTime: at("2026-03-10T02:00"), duration: 4 * HOUR, idleTime: 400 });
    await plant(member.id, projectId, { startTime: at("2026-03-10T09:00"), endTime: at("2026-03-10T10:00"), duration: HOUR });
    const twins = ["aaa", "bbb"];
    for (const id of twins) {
      await plant(admin.id, projectId, { id, startTime: at("2026-03-10T11:00"), endTime: at("2026-03-10T12:00"), duration: 1800 });
    }
    await plant(member.id, projectId, { startTime: at("2026-03-11T09:00"), endTime: at("2026-03-11T10:00"), duration: HOUR });

    const query = { ...day("2026-03-10"), pageSize: 2 };
    const one = await page(admin, query);
    expect(one).toMatchObject({ total: 4, page: 1, pageSize: 2, totals: { duration: 4 * HOUR, idle: 200 } });
    expect(one.data.map((row: { id: string }) => row.id)).toEqual(twins);
    const two = await page(admin, { ...query, page: 2 });
    expect(two.totals).toEqual(one.totals);
    expect(two.data[1]).toMatchObject({ id: before, duration: 4 * HOUR, secondsInPeriod: 2 * HOUR });
    expect(await page(admin, { ...query, page: 3 })).toMatchObject({ data: [], total: 4, totals: one.totals });

    const asMember = await page(member, { ...query, userId: admin.id });
    expect(asMember).toMatchObject({ total: 2, totals: { duration: 3 * HOUR } });
    expect((await page(admin, { status: "running" })).total).toBe(0);
    expect((await page(admin, {})).pageSize).toBe(50);

    // Without `page` the list still goes by its start.
    const plain = await admin.agent.get("/api/time-tracking/entries").query(day("2026-03-10"));
    expect(Object.keys(plain.body)).toEqual(["data"]);
    expect(plain.body.data).toHaveLength(3);
    expect(plain.body.data[0]).not.toHaveProperty("secondsInPeriod");
  });

  it("refuses a page or a date it cannot read", async () => {
    const { admin } = await setup();
    for (const query of [{ page: 0 }, { page: "x" }, { page: 1, pageSize: 0 }, { page: 1, pageSize: 201 }, { page: 1.5 }]) {
      const res = await admin.agent.get("/api/time-tracking/entries").query(query);
      expect(res.status, JSON.stringify(query)).toBe(400);
    }
    for (const path of ["entries", "stats"]) {
      for (const startDate of ["x", "+275760-09-13T00:00:00.000Z"]) {
        const res = await admin.agent.get(`/api/time-tracking/${path}`).query({ startDate });
        expect(res.status).toBe(400);
        expect(res.body).toEqual({ message: "startDate is not a valid date" });
      }
    }
  });

  it("carries the person's name only, and the same row as before", async () => {
    const { admin, member, projectId } = await setup();
    const client = await createClient(admin.agent, { name: "Acme" });
    const withClient = await createCrmProject(admin.agent, { status: "won_in_progress", clientId: client.id });
    const task = await createTask(admin.agent, projectId, "Plan");
    await plant(member.id, projectId, { taskId: task.id, duration: 60 });
    await plant(member.id, withClient.crmProject.id, { startTime: at("2026-03-10T08:00"), duration: 60 });
    const paged = await page(admin, {});
    const plain = await admin.agent.get("/api/time-tracking/entries");
    for (const body of [paged, plain.body]) {
      const [row, second] = body.data;
      expect(Object.keys(row.user).sort()).toEqual(["email", "firstName", "id", "lastName", "profileImageUrl"]);
      expect(row.crmProject.project.name).toBe("Delivery");
      expect(row.crmProject).not.toHaveProperty("client");
      expect(row.task.name).toBe("Plan");
      expect(second.crmProject.client.name).toBe("Acme");
      expect(second).not.toHaveProperty("task");
    }
  });

  it("asks as many questions for 50 entries as for 5", async () => {
    const { admin, member, projectId } = await setup();
    const { storage } = await import("../../server/storage");
    const { pool } = await import("../../server/db");
    const { inSeededWorkspace } = await import("../helpers/workspace");
    const fill = async (n: number) => {
      for (let i = 0; i < n; i++) {
        const task = { id: randomUUID(), crmProjectId: projectId, name: `T${i}`, workspaceId: "seeded" };
        await ownerDb.insert(tasks).values(task);
        await plant(i % 2 ? admin.id : member.id, projectId, {
          taskId: task.id,
          startTime: new Date(at("2026-03-10T09:00").getTime() + i * 1000),
          duration: 10,
        });
      }
    };
    const count = async (read: () => Promise<unknown>) => {
      const spy = vi.spyOn(pool, "query");
      try {
        await inSeededWorkspace(read);
        return spy.mock.calls.filter((call) => {
          const statement: unknown = call[0];
          const text = typeof statement === "string" ? statement : ((statement as { text?: string })?.text ?? "");
          return /\bfrom "/i.test(text);
        }).length;
      } finally {
        spy.mockRestore();
      }
    };
    const reads = [
      () => storage.getTimeEntries({}),
      () => storage.getTimeEntriesPage({ page: 1, pageSize: 200, includeActive: true }),
      () => storage.getTimeStats({ includeActive: true }),
    ];
    const measure = async () => {
      const counts: number[] = [];
      for (const read of reads) counts.push(await count(read));
      return counts;
    };
    await fill(5);
    const few = await measure();
    await fill(45);
    expect((await storageTotal())).toBe(50);
    const many = await measure();
    expect(many).toEqual(few);
    expect(few).toEqual([2, 3, 2]);

    async function storageTotal() {
      return (await inSeededWorkspace(() => storage.getTimeEntries({}))).length;
    }
  });
});

describe("new Timers run on Projects only (F71)", () => {
  beforeEach(resetDb);

  it("refuses a sale and a documentation-only Project, and lets a running one on a sale finish", async () => {
    const { admin, projectId } = await setup();
    const start = async (crmProjectId: string) => {
      const task = await createTask(admin.agent, crmProjectId);
      return admin.agent.post("/api/time-tracking/start").send({ crmProjectId, taskId: task.id });
    };
    for (const status of ["lead", "lost"]) {
      const sale = await createCrmProject(admin.agent);
      await ownerDb.update(crmProjects).set({ status }).where(eq(crmProjects.id, sale.crmProject.id));
      const refused = await start(sale.crmProject.id);
      expect(refused.status, status).toBe(400);
      expect(refused.body).toEqual({ message: "Time is tracked on Projects. Win this Opportunity first." });
    }
    const docs = await createCrmProject(admin.agent, { status: "documented", isDocumentationOnly: true });
    const refused = await start(docs.crmProject.id);
    expect(refused.status).toBe(400);
    expect(refused.body).toEqual({ message: "Time is tracked on Client and Internal Projects." });

    const won = await createCrmProject(admin.agent, { status: "won_in_progress" });
    expect((await start(won.crmProject.id)).status).toBe(200);

    // The Project turns into a sale under a running Timer.
    const task = await createTask(admin.agent, projectId);
    const entry = await startTimer(admin.agent, projectId, task.id);
    await ownerDb.update(crmProjects).set({ projectType: "one_time", status: "lead" }).where(eq(crmProjects.id, projectId));
    for (const action of ["pause", "resume", "stop"]) {
      expect((await admin.agent.post(`/api/time-tracking/${entry.id}/${action}`).send({})).status, action).toBe(200);
    }
  });

  it("lists Projects only on the agent, keeps the Projects it creates, and never loses its time", async () => {
    const { app, member, projectId } = await setup();
    const device = await loginDevice(app, member);
    const sale = await createCrmProject(member.agent, { name: "Sale" });
    const won = await createCrmProject(member.agent, { name: "Won", status: "won_in_progress" });
    const created = await device.request.post("/api/agent/projects").send({ name: "From the desk" });
    expect(created.status).toBe(201);
    expect(Object.keys(created.body).sort()).toEqual(["id", "name", "status"]);

    const listed = await device.request.get("/api/agent/projects");
    expect(listed.body.data.map((row: { id: string }) => row.id).sort()).toEqual(
      [projectId, won.crmProject.id, created.body.id].sort(),
    );
    const [row] = await ownerDb.select().from(crmProjects).where(eq(crmProjects.id, created.body.id));
    expect(row).toMatchObject({ projectType: "internal", status: "won_in_progress", projectStatus: "active" });
    expect(await ownerDb.select().from(opportunities).where(eq(opportunities.crmProjectId, created.body.id))).toEqual([]);

    const task = await createTask(member.agent, sale.crmProject.id);
    const started = await device.request.post("/api/agent/timer/start").send({ crmProjectId: sale.crmProject.id, taskId: task.id });
    expect(started.status).toBe(200);
  });
});

describe("Tasks and deletion (F74)", () => {
  beforeEach(resetDb);

  it("refuses a name, status or description it cannot hold", async () => {
    const { member, projectId } = await setup();
    const task = await createTask(member.agent, projectId, "Plan");
    const patch = (body: object) => member.agent.patch(`/api/tasks/${task.id}`).send(body);
    for (const name of ["", "   ", "x".repeat(256), 42, null, {}, ["a"]]) {
      const res = await patch({ name });
      expect(res.status, JSON.stringify(name)).toBe(400);
      expect(res.body).toEqual({ message: "Task name must be 1 to 255 characters" });
    }
    for (const status of ["later", "", 1, null]) expect((await patch({ status })).status).toBe(400);
    expect((await patch({ description: 4 })).status).toBe(400);
    const renamed = await patch({ name: `  ${"x".repeat(255)}  `, status: "in_progress" });
    expect(renamed.status).toBe(200);
    expect(renamed.body).toMatchObject({ name: "x".repeat(255), status: "in_progress" });

    for (const name of ["x".repeat(256), 42, {}]) {
      const res = await member.agent.post("/api/tasks").send({ crmProjectId: projectId, name });
      expect(res.status).toBe(400);
      expect(res.body).toEqual({ message: "Task name must be 1 to 255 characters" });
    }
    for (const body of [{ name: " " }, { name: "ok", description: 4 }, { crmProjectId: 4, name: "ok" }]) {
      expect((await member.agent.post("/api/tasks").send({ crmProjectId: projectId, ...body })).status).toBe(400);
    }
  });

  it("answers 404 for a Time Entry that is gone, was never there, or cannot be an id", async () => {
    const { member, projectId } = await setup();
    const id = await plant(member.id, projectId, { duration: 1 });
    expect((await member.agent.delete(`/api/time-tracking/${id}`)).status).toBe(200);
    for (const bad of [id, randomUUID(), "not-an-id", "%00", "x".repeat(2000), "%27%3B"]) {
      expect((await member.agent.delete(`/api/time-tracking/${bad}`)).status, bad).toBe(404);
    }
  });
});
