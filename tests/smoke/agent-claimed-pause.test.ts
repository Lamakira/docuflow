import { beforeEach, describe, expect, it } from "vitest";
import { desc, eq } from "drizzle-orm";
import { timeEntries, timerCommands } from "../../shared/schema";
import { makeApp } from "../helpers/app";
import { ownerDb, resetDb } from "../helpers/db";
import { registerUser } from "../helpers/auth";
import { createCrmProject, createTask } from "../helpers/fixtures";
import { loginDevice, type AgentDevice } from "../helpers/agent";

/**
 * #333 (server half): an agent pause or stop takes effect when the Member left,
 * not when the server hears of it. The device sends `effectiveAt`; the ingest
 * clamps it to receipt and floors it at the entry's last start or resume.
 *
 * Routes stamp receipt with the real clock, so each test starts a Timer through
 * the agent route and then moves that start into the past on the owner
 * connection, as if the Member had started it earlier.
 */

const MIN = 60_000;

async function tracking() {
  const app = await makeApp();
  const user = await registerUser(app);
  const device = await loginDevice(app, user);
  const { crmProject } = await createCrmProject(user.agent);
  const task = await createTask(user.agent, crmProject.id);
  const started = await device.request
    .post("/api/agent/timer/start")
    .send({ crmProjectId: crmProject.id, taskId: task.id });
  expect(started.status).toBe(200);
  return { device, entryId: started.body.id as string };
}

/** Move the entry's start, and the command behind it, `minutes` into the past. */
async function startedAgo(entryId: string, minutes: number): Promise<Date> {
  const at = new Date(Date.now() - minutes * MIN);
  await ownerDb
    .update(timeEntries)
    .set({ startTime: at, lastActivityAt: at })
    .where(eq(timeEntries.id, entryId));
  await ownerDb
    .update(timerCommands)
    .set({ claimedEffectiveAt: at, receivedAt: at })
    .where(eq(timerCommands.timeEntryId, entryId));
  return at;
}

async function entry(id: string) {
  const [row] = await ownerDb.select().from(timeEntries).where(eq(timeEntries.id, id));
  return row;
}

async function lastCommand(entryId: string) {
  const [row] = await ownerDb
    .select()
    .from(timerCommands)
    .where(eq(timerCommands.timeEntryId, entryId))
    .orderBy(desc(timerCommands.receivedAt))
    .limit(1);
  return row;
}

function heartbeat(device: AgentDevice, timeEntryId: string | null) {
  return device.request.post("/api/agent/heartbeat").send({
    deviceId: device.deviceId,
    timeEntryId,
    timestamp: new Date().toISOString(),
    clientType: "electron",
    clientVersion: "0.1.0",
  });
}

const ago = (minutes: number) => new Date(Date.now() - minutes * MIN);

/** Heartbeats and claims fall on different milliseconds, and each span rounds down to a second. */
function expectSeconds(actual: number | null, expected: number) {
  expect(actual).toBeGreaterThanOrEqual(expected - 1);
  expect(actual).toBeLessThanOrEqual(expected);
}

describe("agent pause and stop with a claimed effectiveAt", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("pauses the entry at the claimed time", async () => {
    const { device, entryId } = await tracking();
    await startedAgo(entryId, 60);
    const leftAt = ago(20);

    const paused = await device.request
      .post(`/api/agent/timer/${entryId}/pause`)
      .send({ effectiveAt: leftAt.toISOString() });
    expect(paused.status).toBe(200);

    const row = await entry(entryId);
    expect(row.status).toBe("paused");
    expect(row.lastActivityAt?.toISOString()).toBe(leftAt.toISOString());
    expect(row.duration).toBe(40 * 60);
    const command = await lastCommand(entryId);
    expect(command.kind).toBe("pause");
    expect(command.claimedEffectiveAt.toISOString()).toBe(leftAt.toISOString());
    expect(command.clamped).toBe(false);
  });

  it("takes back what heartbeats accrued past the claimed time", async () => {
    const { device, entryId } = await tracking();
    await startedAgo(entryId, 60);
    // The screen was locked 20 minutes ago, but heartbeats kept naming the entry.
    expect((await heartbeat(device, entryId)).status).toBe(200);
    expect((await entry(entryId)).duration).toBeGreaterThanOrEqual(60 * 60);

    const leftAt = ago(20);
    await device.request.post(`/api/agent/timer/${entryId}/pause`).send({ effectiveAt: leftAt.toISOString() });

    const row = await entry(entryId);
    expect(row.status).toBe("paused");
    expectSeconds(row.duration, 40 * 60);
  });

  it("adds nothing on a heartbeat for a paused entry", async () => {
    const { device, entryId } = await tracking();
    await startedAgo(entryId, 60);
    await device.request.post(`/api/agent/timer/${entryId}/pause`).send({ effectiveAt: ago(30).toISOString() });
    const before = await entry(entryId);

    expect((await heartbeat(device, entryId)).status).toBe(200);
    const after = await entry(entryId);
    expect(after.duration).toBe(before.duration);
    expect(after.lastActivityAt?.toISOString()).toBe(before.lastActivityAt?.toISOString());
  });

  it("clamps a pause claimed in the future to receipt", async () => {
    const { device, entryId } = await tracking();
    await startedAgo(entryId, 60);
    const sentAt = Date.now();
    await device.request
      .post(`/api/agent/timer/${entryId}/pause`)
      .send({ effectiveAt: new Date(sentAt + 60 * MIN).toISOString() });
    const answeredAt = Date.now();

    const command = await lastCommand(entryId);
    expect(command.clamped).toBe(true);
    expect(command.claimedEffectiveAt.getTime()).toBe(command.receivedAt.getTime());
    const pausedAt = (await entry(entryId)).lastActivityAt!.getTime();
    expect(pausedAt).toBeGreaterThanOrEqual(sentAt - 1000);
    expect(pausedAt).toBeLessThanOrEqual(answeredAt);
  });

  it("floors a pause claimed before the entry's start at the start", async () => {
    const { device, entryId } = await tracking();
    const startedAt = await startedAgo(entryId, 60);
    await device.request.post(`/api/agent/timer/${entryId}/pause`).send({ effectiveAt: ago(120).toISOString() });

    const row = await entry(entryId);
    expect(row.status).toBe("paused");
    expect(row.lastActivityAt?.toISOString()).toBe(startedAt.toISOString());
    expect(row.duration).toBe(0);
    expect((await lastCommand(entryId)).clamped).toBe(true);
  });

  it("floors a pause claimed before the entry's last resume at the resume", async () => {
    const { device, entryId } = await tracking();
    await startedAgo(entryId, 60);
    await device.request.post(`/api/agent/timer/${entryId}/pause`).send({ effectiveAt: ago(50).toISOString() });
    const resumed = await device.request.post(`/api/agent/timer/${entryId}/resume`).send({});
    expect(resumed.status).toBe(200);
    const resumedAt = (await lastCommand(entryId)).claimedEffectiveAt;

    // Claims a time inside the earlier pause: it cannot reach back past the resume.
    await device.request.post(`/api/agent/timer/${entryId}/pause`).send({ effectiveAt: ago(30).toISOString() });

    const row = await entry(entryId);
    expect(row.status).toBe("paused");
    expect(row.lastActivityAt?.toISOString()).toBe(resumedAt.toISOString());
    expect(row.duration).toBe(10 * 60);
    expect((await lastCommand(entryId)).clamped).toBe(true);
  });

  it("ends a stop after a night's sleep at the pause time (#330)", async () => {
    const { device, entryId } = await tracking();
    // Started at 17:00, the laptop slept at 18:00, the Member stops it the next morning.
    await startedAgo(entryId, 16 * 60);
    const sleptAt = ago(15 * 60);
    await device.request.post(`/api/agent/timer/${entryId}/pause`).send({ effectiveAt: sleptAt.toISOString() });
    expect((await heartbeat(device, null)).status).toBe(200);

    const stopped = await device.request.post(`/api/agent/timer/${entryId}/stop`).send({});
    expect(stopped.status).toBe(200);
    const row = await entry(entryId);
    expect(row.status).toBe("stopped");
    expect(row.endTime?.toISOString()).toBe(sleptAt.toISOString());
    expect(row.duration).toBe(60 * 60);
  });

  it("stops a running entry at the claimed time (I'm not working)", async () => {
    const { device, entryId } = await tracking();
    await startedAgo(entryId, 60);
    expect((await heartbeat(device, entryId)).status).toBe(200);
    const idleSince = ago(10);

    await device.request.post(`/api/agent/timer/${entryId}/stop`).send({ effectiveAt: idleSince.toISOString() });
    const row = await entry(entryId);
    expect(row.status).toBe("stopped");
    expect(row.endTime?.toISOString()).toBe(idleSince.toISOString());
    expectSeconds(row.duration, 50 * 60);
  });

  it("records an idle pause up to when the idle time began", async () => {
    const { device, entryId } = await tracking();
    await startedAgo(entryId, 30);
    // Timer ran 09:00–09:30 by the server's clock; input stopped at 09:20.
    expect((await heartbeat(device, entryId)).status).toBe(200);
    const idleSince = ago(10);

    await device.request.post(`/api/agent/timer/${entryId}/pause`).send({ effectiveAt: idleSince.toISOString() });
    await device.request.post(`/api/agent/timer/${entryId}/stop`).send({});
    const row = await entry(entryId);
    expect(row.endTime?.toISOString()).toBe(idleSince.toISOString());
    expectSeconds(row.duration, 20 * 60);
  });

  it("leaves the server total equal to the desktop's when the idle time is dropped", async () => {
    const { device, entryId } = await tracking();
    await startedAgo(entryId, 60);
    expect((await heartbeat(device, entryId)).status).toBe(200);
    // "I'm back" during the countdown: the desktop keeps 50 of the 60 minutes.
    const idleSince = ago(10);
    await device.request.post(`/api/agent/timer/${entryId}/pause`).send({ effectiveAt: idleSince.toISOString() });
    await device.request.post(`/api/agent/timer/${entryId}/resume`).send({});

    const row = await entry(entryId);
    expect(row.status).toBe("running");
    expectSeconds(row.duration, 50 * 60);
  });

  it("refuses an unreadable effectiveAt", async () => {
    const { device, entryId } = await tracking();
    for (const action of ["pause", "stop"]) {
      const res = await device.request.post(`/api/agent/timer/${entryId}/${action}`).send({ effectiveAt: "yesterday" });
      expect(res.status).toBe(400);
      expect(res.body).toEqual({ message: "Invalid effectiveAt" });
    }
    expect((await entry(entryId)).status).toBe("running");
  });

  it("still takes effect at receipt when no effectiveAt is sent", async () => {
    const { device, entryId } = await tracking();
    await startedAgo(entryId, 60);
    const sentAt = Date.now();
    await device.request.post(`/api/agent/timer/${entryId}/pause`).send({});

    const command = await lastCommand(entryId);
    expect(command.clamped).toBe(false);
    expect(command.claimedEffectiveAt.getTime()).toBe(command.receivedAt.getTime());
    expect(command.receivedAt.getTime()).toBeGreaterThanOrEqual(sentAt - 1000);
  });
});
