import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { makeApp } from "../helpers/app";
import { resetDb } from "../helpers/db";
import { registerUser, type TestUser } from "../helpers/auth";
import { createCrmProject, createTask, startTimer } from "../helpers/fixtures";
import { loginDevice } from "../helpers/agent";

/**
 * #307: GLOSSARY.md defines the Timer as "a user's single globally active work
 * tracker". Starting it on the web while the desktop agent tracks, or the other
 * way round, must leave one running Timer and no overlapping Time Entries, and
 * the time tracked must be the time that passed — never counted twice.
 *
 * The server stamps Timer Commands with its own clock, so the suite moves that
 * clock (Date only) to measure exact spans.
 */

type Entry = { id: string; status: string; startTime: string; endTime: string | null; duration: number };

const MINUTE = 60_000;

/** Wait until `count` other sessions of this database are queued behind a lock. */
async function waitForLockWaiters(
  client: { query: (text: string) => Promise<{ rows: Array<{ waiting: number }> }> },
  count: number,
) {
  for (let poll = 0; poll < 250; poll++) {
    // A transaction reads pg_stat_activity once and keeps that snapshot; clear it.
    await client.query("SELECT pg_stat_clear_snapshot()");
    const { rows } = await client.query(
      "SELECT count(*)::int AS waiting FROM pg_stat_activity WHERE datname = current_database() AND wait_event_type = 'Lock'",
    );
    if (rows[0].waiting >= count) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error("The two starts did not both reach the lock");
}

async function trackable(user: TestUser) {
  const { crmProject } = await createCrmProject(user.agent);
  const task = await createTask(user.agent, crmProject.id);
  return { crmProjectId: crmProject.id, taskId: task.id };
}

async function entriesOf(user: TestUser): Promise<Entry[]> {
  const res = await user.agent.get("/api/time-tracking/entries");
  expect(res.status).toBe(200);
  return res.body.data;
}

function expectNoOverlap(entries: Entry[]) {
  const spans = entries
    .map((entry) => ({
      start: new Date(entry.startTime).getTime(),
      end: entry.endTime ? new Date(entry.endTime).getTime() : Number.POSITIVE_INFINITY,
    }))
    .sort((a, b) => a.start - b.start);
  for (let i = 1; i < spans.length; i++) {
    expect(spans[i - 1].end).toBeLessThanOrEqual(spans[i].start);
  }
}

describe("the Timer counts once across web and desktop (#307)", () => {
  let t0: number;

  beforeEach(async () => {
    await resetDb();
    // A whole second, so every span below is a whole number of seconds.
    t0 = Math.floor(Date.now() / 1000) * 1000;
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(t0);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("stops the web Timer when the desktop agent starts, and tracks exactly the time that passed", async () => {
    const app = await makeApp();
    const user = await registerUser(app);
    const device = await loginDevice(app, user);
    const { crmProjectId, taskId } = await trackable(user);

    const onWeb = await startTimer(user.agent, crmProjectId, taskId);
    vi.setSystemTime(t0 + 10 * MINUTE);
    const onDesktop = await device.request.post("/api/agent/timer/start").send({ crmProjectId, taskId });
    expect(onDesktop.status).toBe(200);

    const active = await user.agent.get("/api/time-tracking/active");
    expect(active.body.id).toBe(onDesktop.body.id);

    vi.setSystemTime(t0 + 25 * MINUTE);
    expect((await user.agent.post(`/api/time-tracking/${onDesktop.body.id}/stop`)).status).toBe(200);

    const entries = await entriesOf(user);
    expect(entries.map((entry) => entry.status).sort()).toEqual(["stopped", "stopped"]);
    const web = entries.find((entry) => entry.id === onWeb.id)!;
    const desktop = entries.find((entry) => entry.id === onDesktop.body.id)!;
    expect(new Date(web.endTime!).getTime()).toBeLessThanOrEqual(new Date(desktop.startTime).getTime());
    expectNoOverlap(entries);
    expect([web.duration, desktop.duration]).toEqual([10 * 60, 15 * 60]);
    expect(web.duration + desktop.duration).toBe(25 * 60);
  });

  it("stops the desktop Timer when the web starts, and tracks exactly the time that passed", async () => {
    const app = await makeApp();
    const user = await registerUser(app);
    const device = await loginDevice(app, user);
    const { crmProjectId, taskId } = await trackable(user);

    const onDesktop = await device.request.post("/api/agent/timer/start").send({ crmProjectId, taskId });
    expect(onDesktop.status).toBe(200);
    vi.setSystemTime(t0 + 7 * MINUTE);
    const onWeb = await startTimer(user.agent, crmProjectId, taskId);

    const seenByAgent = await device.request.get("/api/agent/timer/active");
    expect(seenByAgent.body.id).toBe(onWeb.id);

    vi.setSystemTime(t0 + 20 * MINUTE);
    expect((await device.request.post(`/api/agent/timer/${onWeb.id}/stop`)).status).toBe(200);

    const entries = await entriesOf(user);
    const desktop = entries.find((entry) => entry.id === onDesktop.body.id)!;
    const web = entries.find((entry) => entry.id === onWeb.id)!;
    expect(new Date(desktop.endTime!).getTime()).toBeLessThanOrEqual(new Date(web.startTime).getTime());
    expectNoOverlap(entries);
    expect([desktop.duration, web.duration]).toEqual([7 * 60, 13 * 60]);
    expect(desktop.duration + web.duration).toBe(20 * 60);
  });
});

describe("the Timer counts once when the web and the desktop agent start together (#307)", () => {
  // The real clock: frozen, it keeps the pool from opening the second
  // request's connection, and the two starts never meet.
  beforeEach(async () => {
    await resetDb();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("keeps one running Timer when the web and the desktop agent start at the same moment", async () => {
    const app = await makeApp();
    const user = await registerUser(app);
    const device = await loginDevice(app, user);
    const { crmProjectId, taskId } = await trackable(user);

    // Hold both starts at their first Time Entry write, then let them go
    // together: each has already read "no running Timer" when they meet.
    const { Client } = await import("pg");
    const gate = new Client({ connectionString: process.env.DATABASE_URL });
    await gate.connect();
    let released = false;
    try {
      await gate.query("BEGIN");
      await gate.query("LOCK TABLE time_entries IN EXCLUSIVE MODE");
      const starts = Promise.all([
        user.agent.post("/api/time-tracking/start").send({ crmProjectId, taskId }).then((res) => res),
        device.request.post("/api/agent/timer/start").send({ crmProjectId, taskId }).then((res) => res),
      ]);
      await waitForLockWaiters(gate, 2);
      await gate.query("COMMIT");
      released = true;
      const [onWeb, onDesktop] = await starts;
      expect([onWeb.status, onDesktop.status]).toEqual([200, 200]);
    } finally {
      if (!released) await gate.query("ROLLBACK");
      await gate.end();
    }

    const entries = await entriesOf(user);
    expect(entries.filter((entry) => entry.status === "running" || entry.status === "paused")).toHaveLength(1);
    expectNoOverlap(entries);

    // Stop five minutes after the first start: the time tracked is the time
    // that passed, give or take the second each entry rounds down.
    const firstStart = Math.min(...entries.map((entry) => new Date(entry.startTime).getTime()));
    const active = await user.agent.get("/api/time-tracking/active");
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(firstStart + 5 * MINUTE);
    expect((await user.agent.post(`/api/time-tracking/${active.body.id}/stop`)).status).toBe(200);
    const total = (await entriesOf(user)).reduce((sum, entry) => sum + entry.duration, 0);
    expect(total).toBeGreaterThanOrEqual(5 * 60 - 1);
    expect(total).toBeLessThanOrEqual(5 * 60);
  });
});
