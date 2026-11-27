import { randomUUID } from "crypto";
import { beforeEach, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import {
  agentActivityEvents,
  deviceEnrollments,
  devices,
  memberships,
  PARALLEL_WORKSPACE_ID,
  tasks,
  timeEntries,
  timeEntryScreenshots,
  users,
} from "@shared/schema";
import { csvText, timeExportCsv } from "../../server/modules/time/timeExport";
import { dayCalendar, dayPortions } from "../../server/modules/time/dayCalendar";
import { timePortion } from "../../shared/timePortion";
import { makeApp } from "../helpers/app";
import { ownerDb, resetDb } from "../helpers/db";
import { createUnlinkedUser, registerAdmin, registerUser, type TestUser } from "../helpers/auth";
import { createClient, createCrmProject, createTask } from "../helpers/fixtures";
import { addWorkspaceMembership, plantParallelWorkspace } from "../helpers/workspace";

/** Server half of the Analytics review: F93, F94, F95, F98, F99. */

const HOUR = 3600;
const MIN = 60_000;
const DAY = 24 * 60 * MIN;

const ROUTES = [
  "overview",
  "productivity",
  "activity",
  "screenshots",
  "alerts",
  "data-quality",
  "coverage",
  "evidence-quality",
  "devices",
  "export",
];

const RANGE = { start: "2026-03-10T00:00:00.000Z", end: "2026-03-10T23:59:59.999Z", tz: "UTC" };
const at = (utc: string) => new Date(`${utc}:00.000Z`);

async function read(user: TestUser, report: string, query: object = RANGE) {
  const res = await user.agent.get(`/api/admin/analytics/${report}`).query(query);
  expect(res.status, `${report} ${JSON.stringify(res.body)}`).toBe(200);
  return res.body;
}

async function plant(userId: string, crmProjectId: string, values: Partial<typeof timeEntries.$inferInsert>): Promise<string> {
  const id = values.id ?? randomUUID();
  await ownerDb.insert(timeEntries).values({
    userId,
    crmProjectId,
    startTime: at("2026-03-10T09:00"),
    endTime: at("2026-03-10T10:00"),
    duration: HOUR,
    status: "stopped",
    workspaceId: "seeded",
    ...values,
    id,
  } as typeof timeEntries.$inferInsert);
  return id;
}

async function shoot(
  timeEntryId: string,
  userId: string,
  crmProjectId: string,
  values: Partial<typeof timeEntryScreenshots.$inferInsert> = {},
) {
  await ownerDb.insert(timeEntryScreenshots).values({
    timeEntryId,
    userId,
    crmProjectId,
    storageKey: `/objects/${randomUUID()}`,
    capturedAt: at("2026-03-10T09:30"),
    workspaceId: "seeded",
    ...values,
  } as typeof timeEntryScreenshots.$inferInsert);
}

async function plantDevice(userId: string, workspaceId: string, values: Partial<typeof devices.$inferInsert> = {}): Promise<string> {
  const id = randomUUID();
  await ownerDb.insert(devices).values({
    id,
    userId,
    name: `Device ${id}`,
    deviceTokenHash: id,
    lastSeenAt: new Date(Date.now() - 10 * DAY),
    ...values,
  });
  const [membership] = await ownerDb
    .select()
    .from(memberships)
    .where(and(eq(memberships.userId, userId), eq(memberships.workspaceId, workspaceId)));
  await ownerDb.insert(deviceEnrollments).values({ deviceId: id, workspaceId, membershipId: membership.id });
  return id;
}

async function setup() {
  const app = await makeApp();
  const admin = await registerAdmin(app, { firstName: "Ada", lastName: "Min" });
  const member = await registerUser(app, { firstName: "Mel", lastName: "Ber" });
  const client = await createClient(admin.agent, { name: "Société Générale" });
  const { crmProject } = await createCrmProject(admin.agent, {
    name: "Delivery",
    status: "won_in_progress",
    clientId: client.id,
    memberIds: [admin.id, member.id],
  });
  return { app, admin, member, projectId: crmProject.id };
}

async function savePolicy(admin: TestUser, screenshotPolicy: object) {
  const res = await admin.agent.patch("/api/admin/org-settings").send({ screenshotPolicy });
  expect(res.status).toBe(200);
}

describe("days in a time zone", () => {
  it.each([
    ["Europe/Paris", "2026-03-29", 23],
    ["Europe/Paris", "2026-10-25", 25],
    ["America/Toronto", "2026-03-08", 23],
    ["America/Toronto", "2026-11-01", 25],
    ["America/Santiago", "2026-09-06", 23],
    ["Asia/Kolkata", "2026-03-10", 24],
    ["Pacific/Kiritimati", "2026-03-10", 24],
    ["Africa/Porto-Novo", "2026-03-10", 24],
  ])("finds the start of a day in %s on %s, %d hours long", (zone, day, length) => {
    const calendar = dayCalendar(zone);
    const start = calendar.startOfDay(day);
    const next = calendar.startOfDay(new Date(Date.parse(day) + DAY).toISOString().slice(0, 10));
    expect(calendar.dayOf(start)).toBe(day);
    expect(calendar.dayOf(new Date(start.getTime() - 1))).not.toBe(day);
    expect((next.getTime() - start.getTime()) / 3_600_000).toBe(length);
  });

  it("reads the day and the clock with minutes", () => {
    const instant = at("2026-03-10T18:30");
    expect(dayCalendar("Asia/Kolkata").dayOf(instant)).toBe("2026-03-11");
    expect(dayCalendar("Asia/Kolkata").clockOf(instant)).toBe("00:00");
    expect(dayCalendar("Asia/Kathmandu").clockOf(instant)).toBe("00:15");
    expect(dayCalendar("America/Toronto").hourOf(instant)).toBe(14);
  });

  it("splits a span between days that add up to its part of the range", () => {
    const span = { start: at("2026-03-27T17:43"), end: at("2026-03-31T05:11"), seconds: 100_003, idleSeconds: 4_001 };
    const period = { start: at("2026-03-28T10:00"), end: at("2026-03-30T10:00") };
    const days = dayPortions(span, period, dayCalendar("Europe/Paris"));
    expect(days.map((day) => day.date)).toEqual(["2026-03-28", "2026-03-29", "2026-03-30"]);
    const whole = timePortion(span, period);
    expect(days.reduce((sum, day) => sum + day.seconds, 0)).toBe(whole.seconds);
    expect(days.reduce((sum, day) => sum + day.idleSeconds, 0)).toBe(whole.idleSeconds);
  });

  it("gives an instant at midnight to one day only, and nothing outside the range", () => {
    const midnight = at("2026-03-10T00:00");
    const span = { start: midnight, end: midnight, seconds: 90, idleSeconds: 0 };
    const period = { start: at("2026-03-09T00:00"), end: at("2026-03-11T00:00") };
    const utc = dayCalendar("UTC");
    expect(dayPortions(span, period, utc)).toEqual([{ date: "2026-03-10", seconds: 90, idleSeconds: 0 }]);
    expect(dayPortions(span, { start: at("2026-03-11T00:00"), end: at("2026-03-12T00:00") }, utc)).toEqual([]);
  });

  it("passes the day a zone skipped", () => {
    const samoa = dayCalendar("Pacific/Apia");
    const span = { start: at("2011-12-29T12:00"), end: at("2011-12-31T12:00"), seconds: 48 * HOUR, idleSeconds: 0 };
    expect(dayPortions(span, { start: span.start, end: span.end }, samoa).map((day) => day.date)).toEqual([
      "2011-12-29",
      "2011-12-31",
      "2012-01-01",
    ]);
  });
});

describe("CSV cells", () => {
  it.each([
    ["=SUM(A1)", `"'=SUM(A1)"`],
    ["+1", `"'+1"`],
    ["-1", `"'-1"`],
    ["@x", `"'@x"`],
    ["\tx", `"'\tx"`],
    ["\rx", `"'\rx"`],
    ['say "hi"', '"say ""hi"""'],
    ["a=b", '"a=b"'],
    [null, '""'],
  ])("writes %j as %s", (value, cell) => {
    expect(csvText(value)).toBe(cell);
  });

  it("is the header alone when there is no entry", () => {
    expect(timeExportCsv([], dayCalendar("UTC"))).toBe(
      "﻿Date,Start,End,Member,Client,Project,Task,Description,Status,Tracked (h),Idle (h),Worked (h)",
    );
  });
});

describe("Devices stay in the Workspace they are enrolled in (F93)", () => {
  beforeEach(resetDb);

  it("shows nothing of a Workspace that shares no one", async () => {
    const { admin, projectId } = await setup();
    await plantParallelWorkspace();
    const stranger = await createUnlinkedUser({ firstName: "Zed", lastName: "Stranger" });
    await addWorkspaceMembership(stranger.id, PARALLEL_WORKSPACE_ID);
    await ownerDb.delete(memberships).where(and(eq(memberships.userId, stranger.id), eq(memberships.workspaceId, "seeded")));
    const foreign = await plantDevice(stranger.id, PARALLEL_WORKSPACE_ID);
    // With time of its own, or the quality report would stop before it reads Devices.
    await plant(admin.id, projectId, {});

    const alerts = await read(admin, "alerts");
    expect(alerts.stalledDevices).toEqual([]);
    expect((await read(admin, "data-quality")).org.stalledDevices).toBe(0);
    const everything = JSON.stringify([alerts, await read(admin, "devices"), await read(admin, "data-quality")]);
    expect(everything).not.toContain(foreign);
    expect(everything).not.toContain("Stranger");
  });

  it("shows a shared Member's Device only where it is enrolled", async () => {
    const { admin, member, projectId } = await setup();
    await plantParallelWorkspace();
    await addWorkspaceMembership(member.id, PARALLEL_WORKSPACE_ID);
    const here = await plantDevice(member.id, "seeded", { lastSeenAt: new Date(Date.now() - 8 * DAY) });
    const older = await plantDevice(member.id, "seeded", { lastSeenAt: new Date(Date.now() - 30 * DAY) });
    await plantDevice(member.id, PARALLEL_WORKSPACE_ID);
    await plantDevice(member.id, PARALLEL_WORKSPACE_ID, { lastSeenAt: new Date() });
    await plantDevice(member.id, PARALLEL_WORKSPACE_ID, { revokedAt: new Date() });
    const revoked = await plantDevice(member.id, "seeded", { revokedAt: new Date(), lastSeenAt: new Date(Date.now() - 40 * DAY) });
    await plant(member.id, projectId, {});

    const listed = await read(admin, "devices");
    expect(listed.map((d: { id: string }) => d.id).sort()).toEqual([here, older, revoked].sort());
    expect((await read(admin, "overview")).revokedDevices).toBe(1);
    const { stalledDevices } = await read(admin, "alerts");
    expect(stalledDevices.map((d: { deviceId: string }) => d.deviceId)).toEqual([older, here]);
    expect(stalledDevices[0]).toMatchObject({ userName: "Mel Ber", daysSinceLastSeen: 30 });
    const quality = await read(admin, "data-quality");
    expect(quality.org.stalledDevices).toBe(2);
    // The Device seen today is the other Workspace's.
    expect(quality.byUser[0].flags).toContain("stale_device");
    expect((await read(admin, "evidence-quality")).byUser[0]).toMatchObject({ deviceScore: 0, deviceLastSeenDaysAgo: 8 });
  });

  it("does not warn about the Device of an archived Membership, and lists every other one", async () => {
    const { admin, member } = await setup();
    await plantDevice(member.id, "seeded");
    for (let i = 0; i < 25; i++) await plantDevice(admin.id, "seeded");
    await ownerDb.update(memberships).set({ archivedAt: new Date() }).where(eq(memberships.userId, member.id));

    const { stalledDevices } = await read(admin, "alerts");
    expect(stalledDevices).toHaveLength(25);
    expect(stalledDevices.every((d: { userId: string }) => d.userId === admin.id)).toBe(true);
    expect((await read(admin, "devices"))).toHaveLength(26);
  });
});

describe("coverage counts the time once (F94)", () => {
  beforeEach(resetDb);

  async function captured(userId: string, projectId: string, values: Partial<typeof timeEntries.$inferInsert> = {}) {
    const entry = await plant(userId, projectId, values);
    for (let i = 0; i < 12; i++) {
      await shoot(entry, userId, projectId, {
        capturedAt: new Date(at("2026-03-10T09:01").getTime() + i * 4 * MIN),
        contentHash: `hash-${i}`,
        keyboardActivityPercent: 10,
        mouseActivityPercent: 10,
      });
    }
    await shoot(entry, userId, projectId, {
      capturedAt: at("2026-03-10T09:01"),
      contentHash: "hash-0",
      deletedAt: new Date(),
      deleteReason: "system:duplicate-capture",
    });
    await shoot(entry, userId, projectId, { storageKey: `pending-${randomUUID()}` });
    return entry;
  }

  it("takes the expected count from the policy and leaves copies out", async () => {
    const { admin, member, projectId } = await setup();
    const entry = await captured(member.id, projectId);
    // Deleted by an Administrator, and one taken outside the range.
    await shoot(entry, member.id, projectId, { deletedAt: new Date(), deletedBy: admin.id });
    await shoot(entry, member.id, projectId, { capturedAt: at("2026-03-11T09:00") });

    const one = await read(admin, "coverage");
    expect(one.summary).toEqual({
      totalTrackedSeconds: 3600,
      totalScreenshots: 12,
      expectedScreenshots: 12,
      coveragePercent: 100,
      totalEntries: 1,
      entriesWithoutScreenshots: 0,
      lowCoverageEntries: 0,
      deletedScreenshots: 1,
      captureEveryMinutes: 5,
    });
    const figures = { trackedSeconds: 3600, screenshotCount: 12, expectedScreenshots: 12, coveragePct: 100 };
    expect(one.byUser).toEqual([{ userId: member.id, userName: "Mel Ber", entriesCount: 1, entriesWithoutScreenshots: 0, ...figures }]);
    expect(one.byProject).toEqual([
      { crmProjectId: projectId, projectName: "Delivery", entriesCount: 1, entriesWithoutScreenshots: 0, ...figures },
    ]);
    expect(one.byDay).toEqual([{ date: "2026-03-10", ...figures }]);

    await plant(member.id, projectId, { startTime: at("2026-03-10T11:00"), endTime: at("2026-03-10T12:00") });
    const two = await read(admin, "coverage");
    expect(two.summary).toMatchObject({
      totalTrackedSeconds: 7200,
      totalScreenshots: 12,
      expectedScreenshots: 24,
      coveragePercent: 50,
      entriesWithoutScreenshots: 1,
      lowCoverageEntries: 1,
    });

    const quality = await read(admin, "data-quality");
    expect(quality.byUser[0]).toMatchObject({
      trackedSeconds: 7200,
      screenshotCount: 12,
      expectedScreenshots: 24,
      screenshotCoveragePercent: 50,
      duplicateScreenshots: 0,
    });
    expect(quality.org).toMatchObject({ entriesWithoutAnyScreenshot: 1, deletedScreenshots: 1 });
  });

  it("grades on the time once, with numbers that are numbers", async () => {
    const { admin, member, projectId } = await setup();
    await captured(member.id, projectId);
    const [score] = (await read(admin, "evidence-quality")).byUser;
    expect(score).toMatchObject({
      entryCount: 1,
      trackedSeconds: 3600,
      screenshotCount: 12,
      expectedScreenshots: 12,
      coverageScore: 40,
      dupRatio: 0,
      avgActivityPct: 10,
      // Half of the 15 points: the average is half of 20 %.
      qualityScore: 22,
      eventsScore: 0,
    });
  });

  it("expects nothing when captures are off", async () => {
    const { admin, member, projectId } = await setup();
    await captured(member.id, projectId);
    await savePolicy(admin, { screenshotsEnabled: false });
    const { summary, byUser } = await read(admin, "coverage");
    expect(summary).toMatchObject({
      totalTrackedSeconds: 3600,
      totalScreenshots: 12,
      expectedScreenshots: 0,
      coveragePercent: null,
      captureEveryMinutes: null,
    });
    expect(byUser[0]).toMatchObject({ expectedScreenshots: 0, coveragePct: null });
    expect((await read(admin, "data-quality")).byUser[0].screenshotCoveragePercent).toBeNull();
  });

  it("expects captures on every Project, whatever list a smaller Plan left behind, in names' order", async () => {
    const { admin, member, projectId } = await setup();
    const other = await createCrmProject(admin.agent, { name: "Aside", status: "won_in_progress" });
    await captured(member.id, projectId);
    await plant(member.id, other.crmProject.id, { startTime: at("2026-03-10T11:00"), endTime: at("2026-03-10T12:00") });
    await plant(admin.id, other.crmProject.id, { duration: 10 * 60 });
    await savePolicy(admin, { screenshotProjectIds: [projectId], captureIntervalMinMin: 3, captureIntervalMaxMin: 6 });

    const { summary, byUser, byProject } = await read(admin, "coverage");
    expect(summary).toMatchObject({ totalTrackedSeconds: 7800, expectedScreenshots: 21, captureEveryMinutes: 6 });
    expect(byUser.map((row: { userName: string }) => row.userName)).toEqual(["Ada Min", "Mel Ber"]);
    expect(byUser[0]).toMatchObject({ expectedScreenshots: 1, coveragePct: 0 });
    expect(byUser[1]).toMatchObject({ trackedSeconds: 7200, expectedScreenshots: 20, coveragePct: 60 });
    expect(byProject.find((row: { projectName: string }) => row.projectName === "Aside")).toMatchObject({
      trackedSeconds: 4200,
      expectedScreenshots: 11,
    });
    const filtered = await read(admin, "coverage", { ...RANGE, crmProjectId: other.crmProject.id });
    expect(filtered.summary).toMatchObject({ totalTrackedSeconds: 4200, totalScreenshots: 0 });
  });

  it("leaves out the captures, events and entries of another Workspace", async () => {
    const { admin, member, projectId } = await setup();
    await plantParallelWorkspace();
    const entry = await plant(member.id, projectId, {});
    const device = await plantDevice(member.id, "seeded");
    const event = { deviceId: device, userId: member.id, batchId: "b", eventType: "idle_start", timestamp: at("2026-03-10T09:30") };
    await ownerDb.insert(agentActivityEvents).values([
      { ...event, workspaceId: PARALLEL_WORKSPACE_ID },
    ]);
    expect((await read(admin, "evidence-quality")).byUser[0].hasEvents).toBe(false);
    await ownerDb.insert(agentActivityEvents).values([{ ...event, timeEntryId: entry, workspaceId: "seeded" }]);
    expect((await read(admin, "evidence-quality")).byUser[0].hasEvents).toBe(true);
    expect((await read(admin, "activity")).byUser[0].idleEventCount).toBe(1);
  });
});

describe("Analytics and Time Tracking agree (F95)", () => {
  beforeEach(resetDb);

  it("counts the part of an entry inside the range, and splits it between its days", async () => {
    const { admin, member, projectId } = await setup();
    const task = await createTask(admin.agent, projectId, "Night work");
    await plant(member.id, projectId, {
      taskId: task.id,
      startTime: at("2026-03-09T23:00"),
      endTime: at("2026-03-10T01:00"),
      duration: HOUR,
      idleTime: HOUR,
    });
    expect(await read(admin, "overview")).toMatchObject({ totalTrackedSeconds: 1800, totalIdleSeconds: 1800, entriesCount: 1, lowActivityEntries: 0 });
    const half = await read(admin, "productivity");
    expect(half).toEqual({
      byUser: [{ userId: member.id, userName: "Mel Ber", totalSeconds: 1800, idleSeconds: 1800, entriesCount: 1 }],
      byProject: [{ crmProjectId: projectId, projectName: "Delivery", clientName: "Société Générale", totalSeconds: 1800, entriesCount: 1 }],
      byTask: [
        { taskId: task.id, taskName: "Night work", crmProjectId: projectId, projectName: "Delivery", clientName: "Société Générale", totalSeconds: 1800 },
      ],
      dailyTrend: [{ date: "2026-03-10", totalSeconds: 1800 }],
    });
    expect((await read(admin, "activity")).byUser).toEqual([
      { userId: member.id, userName: "Mel Ber", totalSeconds: 1800, idleSeconds: 1800, idleRatio: 50, idleEventCount: 0 },
    ]);
    const both = await read(admin, "productivity", { ...RANGE, start: "2026-03-09T00:00:00.000Z" });
    expect(both.dailyTrend).toEqual([
      { date: "2026-03-09", totalSeconds: 1800 },
      { date: "2026-03-10", totalSeconds: 1800 },
    ]);
    // An hour east of UTC the same entry runs from midnight to two.
    const east = await read(admin, "productivity", { ...RANGE, start: "2026-03-09T00:00:00.000Z", tz: "Africa/Porto-Novo" });
    expect(east.dailyTrend).toEqual([{ date: "2026-03-10", totalSeconds: 3600 }]);
    // Absent, it is the Workspace time zone: Toronto by default, the day before.
    const { tz: _tz, ...noZone } = RANGE;
    expect((await read(admin, "productivity", noZone)).dailyTrend).toEqual([{ date: "2026-03-09", totalSeconds: 1800 }]);
  });

  it("reads the same total as Time Tracking, running and paused entries included", async () => {
    const { app, admin, member, projectId } = await setup();
    const third = await registerUser(app);
    const now = Date.now();
    await plant(member.id, projectId, { startTime: new Date(now - 30 * 60 * MIN), endTime: new Date(now - 20 * 60 * MIN), duration: 9 * HOUR, idleTime: HOUR });
    // Silent for over ten minutes, so both reads see the same seconds.
    await plant(admin.id, projectId, { status: "running", startTime: new Date(now - 3 * 60 * MIN), endTime: null, lastActivityAt: new Date(now - 60 * MIN), duration: 2 * HOUR });
    await plant(third.id, projectId, { status: "paused", startTime: new Date(now - 4 * 60 * MIN), endTime: null, lastActivityAt: new Date(now - 3 * 60 * MIN), duration: 1800, idleTime: 1800 });
    const start = new Date(now - 25 * 60 * MIN).toISOString();
    const end = new Date(now).toISOString();

    const overview = await read(admin, "overview", { start, end });
    const stats = await admin.agent.get("/api/time-tracking/stats").query({ startDate: start, endDate: end, includeActive: "1" });
    expect(overview.totalTrackedSeconds).toBe(4.5 * HOUR + 2 * HOUR + 1800);
    expect(overview.totalTrackedSeconds).toBe(stats.body.totalDuration);
    expect(overview.totalIdleSeconds).toBe(stats.body.totalIdleTime);
    expect(overview.entriesCount).toBe(stats.body.entriesCount);
    expect(overview.runningNow).toBe(1);
    expect(overview.lowActivityEntries).toBe(0);

    const { byUser, dailyTrend } = await read(admin, "productivity", { start, end });
    const sum = (rows: Array<{ totalSeconds: number }>) => rows.reduce((total, row) => total + row.totalSeconds, 0);
    expect(sum(byUser)).toBe(overview.totalTrackedSeconds);
    expect(sum(dailyTrend)).toBe(overview.totalTrackedSeconds);
    expect((await read(admin, "coverage", { start, end })).summary.totalTrackedSeconds).toBe(overview.totalTrackedSeconds);
  });

  it("counts a live Timer up to now", async () => {
    const { admin, member, projectId } = await setup();
    const now = Date.now();
    await plant(member.id, projectId, { status: "running", startTime: new Date(now - 60 * MIN), endTime: null, lastActivityAt: new Date(now - MIN), duration: 59 * 60 });
    const query = { start: new Date(now - DAY).toISOString(), end: new Date(now + DAY).toISOString() };
    const { totalTrackedSeconds } = await read(admin, "overview", query);
    expect(Math.abs(totalTrackedSeconds - HOUR)).toBeLessThanOrEqual(15);
  });

  it("counts who is active today from midnight in the zone asked for", async () => {
    const { admin, member, projectId } = await setup();
    const now = new Date();
    const midnight = dayCalendar("Asia/Tokyo").startOfDay(dayCalendar("Asia/Tokyo").dayOf(now));
    await plant(member.id, projectId, { startTime: new Date(midnight.getTime() - 2 * MIN), endTime: new Date(midnight.getTime() - MIN), duration: 60 });
    expect((await read(admin, "overview", { tz: "Asia/Tokyo" })).activeUsersToday).toBe(0);
    await plant(member.id, projectId, { startTime: new Date(midnight.getTime() - MIN), endTime: new Date(midnight.getTime() + 1), duration: 60 });
    expect((await read(admin, "overview", { tz: "Asia/Tokyo" })).activeUsersToday).toBe(1);
  });

  it("gives a 23 hour day its own hours", async () => {
    const { admin, member, projectId } = await setup();
    // 00:30 to 23:30 in Paris, 22 hours on the day the clocks move forward.
    await plant(member.id, projectId, { startTime: at("2026-03-28T23:30"), endTime: at("2026-03-29T21:30"), duration: 22 * HOUR });
    await plant(member.id, projectId, { startTime: at("2026-03-29T21:30"), endTime: at("2026-03-29T22:30"), duration: HOUR });
    const { dailyTrend } = await read(admin, "productivity", {
      start: "2026-03-28T23:00:00.000Z",
      end: "2026-03-30T21:59:59.999Z",
      tz: "Europe/Paris",
    });
    expect(dailyTrend).toEqual([
      { date: "2026-03-29", totalSeconds: 22.5 * HOUR },
      { date: "2026-03-30", totalSeconds: 1800 },
    ]);
  });

  it("counts an entry more idle than tracked, and the Member whose time is", async () => {
    const { admin, member, projectId } = await setup();
    await plant(member.id, projectId, { duration: 1700, idleTime: 1900 });
    await plant(admin.id, projectId, { duration: 2100, idleTime: 1500 });
    expect((await read(admin, "overview")).lowActivityEntries).toBe(1);
    expect((await read(admin, "alerts")).highIdleUsers).toEqual([
      { userId: member.id, userName: "Mel Ber", idleRatio: 53, totalSeconds: 1700 },
    ]);
  });

  it("puts captures in the hours of the zone asked for", async () => {
    const { admin, member, projectId } = await setup();
    const entry = await plant(member.id, projectId, {});
    await shoot(entry, member.id, projectId, { capturedAt: at("2026-03-10T09:40"), contentHash: "same" });
    await shoot(entry, member.id, projectId, { capturedAt: at("2026-03-10T09:50"), contentHash: "same" });
    const hours = async (tz: string) => (await read(admin, "screenshots", { ...RANGE, tz })).hourlyDistribution;
    expect(await hours("UTC")).toEqual([{ hour: 9, count: 2 }]);
    expect(await hours("Africa/Porto-Novo")).toEqual([{ hour: 10, count: 2 }]);
    expect(await hours("Asia/Kolkata")).toEqual([{ hour: 15, count: 2 }]);
    expect(await hours("America/Toronto")).toEqual([{ hour: 5, count: 2 }]);
    expect(await read(admin, "screenshots")).toMatchObject({
      totalCount: 2,
      byUser: [{ userId: member.id, userName: "Mel Ber", count: 2 }],
      duplicates: [{ contentHash: "same", count: 2 }],
      deletedCount: 0,
    });
  });

  it("puts a capture on its day in the zone asked for", async () => {
    const { admin, member, projectId } = await setup();
    const entry = await plant(member.id, projectId, { startTime: at("2026-03-10T22:50"), endTime: at("2026-03-10T23:50") });
    await shoot(entry, member.id, projectId, { capturedAt: at("2026-03-10T23:10") });
    const { byDay } = await read(admin, "coverage", { ...RANGE, tz: "Africa/Porto-Novo" });
    expect(byDay).toMatchObject([
      { date: "2026-03-10", trackedSeconds: 600, screenshotCount: 0, expectedScreenshots: 2, coveragePct: 0 },
      { date: "2026-03-11", trackedSeconds: 3000, screenshotCount: 1, expectedScreenshots: 10, coveragePct: 10 },
    ]);
  });
});

describe("a range that cannot be read (F97)", () => {
  beforeEach(resetDb);

  it.each(ROUTES)("is refused by %s", async (report) => {
    const admin = await registerAdmin(await makeApp());
    const get = (query: string) => admin.agent.get(`/api/admin/analytics/${report}?${query}`);
    for (const query of [
      "start=x",
      "end=x",
      "start=2026-03-11T00:00:00.000Z&end=2026-03-10T00:00:00.000Z",
      "start=%2B275760-09-13T00:00:00.000Z",
      "start=2026-03-10&start=2026-03-11",
      // Only the end, before the years a Postgres timestamp holds.
      "end=0001-01-03T00:00:00.000Z",
    ]) {
      const res = await get(query);
      expect(res.status, query).toBe(400);
      expect(res.body).toEqual({ message: "Invalid date range" });
    }
    for (const query of ["tz=Mars/Olympus", "tz=UTC&tz=UTC"]) {
      const res = await get(query);
      expect(res.status, query).toBe(400);
      expect(res.body).toEqual({ message: "Unknown time zone" });
    }
    expect((await get("start=2026-03-10T00:00:00.000Z&end=2026-03-10T00:00:00.000Z&tz=Europe/Paris")).status).toBe(200);
  });
});

describe("lists are whole (F99)", () => {
  beforeEach(resetDb);

  it("names the Project and the Client of every Task", async () => {
    const { admin, member, projectId } = await setup();
    const bare = await createCrmProject(admin.agent, { name: "Bare", status: "won_in_progress" });
    for (let i = 0; i < 25; i++) {
      const [task] = await ownerDb
        .insert(tasks)
        .values({ crmProjectId: i === 24 ? bare.crmProject.id : projectId, name: `Task ${String(i).padStart(2, "0")}`, workspaceId: "seeded" } as typeof tasks.$inferInsert)
        .returning();
      await plant(member.id, i === 24 ? bare.crmProject.id : projectId, { taskId: task.id, duration: i === 24 ? 60 : HOUR });
    }
    const { byTask, byProject } = await read(admin, "productivity");
    expect(byTask).toHaveLength(25);
    expect(byTask.map((row: { taskName: string }) => row.taskName)).toEqual(
      Array.from({ length: 25 }, (_, i) => `Task ${String(i).padStart(2, "0")}`),
    );
    expect(byTask[0]).toMatchObject({ crmProjectId: projectId, projectName: "Delivery", clientName: "Société Générale" });
    expect(byTask[24]).toMatchObject({ projectName: "Bare", clientName: null, totalSeconds: 60 });
    expect(byProject.map((row: { projectName: string }) => row.projectName)).toEqual(["Delivery", "Bare"]);
  });

  it("warns of every Timer without a capture, and of no new one", async () => {
    const { admin, member, projectId } = await setup();
    const now = Date.now();
    const people = await ownerDb
      .insert(users)
      .values(Array.from({ length: 60 }, (_, i) => ({ email: `timer-${i}@example.com` })))
      .returning({ id: users.id });
    const running = { status: "running", endTime: null, lastActivityAt: new Date(now), duration: 0 };
    for (const { id } of people) await plant(id, projectId, { ...running, startTime: new Date(now - 60 * MIN) });
    await plant(member.id, projectId, { ...running, startTime: new Date(now - 20 * MIN) });
    const shot = await plant(admin.id, projectId, { ...running, startTime: new Date(now - 90 * MIN) });
    await shoot(shot, admin.id, projectId, { capturedAt: new Date(now - 10 * MIN) });

    expect((await read(admin, "alerts")).runningWithoutScreenshots).toHaveLength(60);
    await ownerDb.update(timeEntryScreenshots).set({ deletedAt: new Date() }).where(eq(timeEntryScreenshots.timeEntryId, shot));
    const { runningWithoutScreenshots } = await read(admin, "alerts");
    expect(runningWithoutScreenshots).toHaveLength(61);
    expect(runningWithoutScreenshots[0]).toMatchObject({ entryId: shot, userId: admin.id, userName: "Ada Min" });
  });
});

describe("the export is what the page shows (F98)", () => {
  beforeEach(resetDb);

  it("has one line per entry, with its part of the range and nothing that runs", async () => {
    const { admin, member, projectId } = await setup();
    const task = await createTask(admin.agent, projectId, "=HYPERLINK(1)");
    await plant(member.id, projectId, {
      taskId: task.id,
      startTime: at("2026-03-09T23:00"),
      endTime: at("2026-03-10T01:00"),
      duration: HOUR,
      idleTime: HOUR,
      description: 'Café, "noir"',
    });
    await plant(admin.id, projectId, {
      status: "running",
      startTime: at("2026-03-10T12:00"),
      endTime: null,
      duration: 1800,
      lastActivityAt: at("2026-03-10T12:30"),
    });

    const res = await admin.agent.get("/api/admin/analytics/export").query({ ...RANGE, tz: "Africa/Porto-Novo" });
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toBe("text/csv; charset=utf-8");
    // The range ends at 00:59 on the 11th in this zone.
    expect(res.headers["content-disposition"]).toBe('attachment; filename="docuflow-time-2026-03-10-to-2026-03-11.csv"');
    expect(res.text.charCodeAt(0)).toBe(0xfeff);
    expect(res.text.slice(1).split("\r\n")).toEqual([
      "Date,Start,End,Member,Client,Project,Task,Description,Status,Tracked (h),Idle (h),Worked (h)",
      '2026-03-10,13:00,,"Ada Min","Société Générale","Delivery","","","running",0.50,0.00,0.50',
      `2026-03-10,00:00,02:00,"Mel Ber","Société Générale","Delivery","'=HYPERLINK(1)","Café, ""noir""","stopped",0.50,0.50,0.50`,
    ]);
  });
});
