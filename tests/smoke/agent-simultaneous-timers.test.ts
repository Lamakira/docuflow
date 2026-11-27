import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { userData } = vi.hoisted(() => ({ userData: { dir: "" } }));
// AgentStore imports `electron`: it resolves to desktop-agent's own package when
// installed (local), and stays a bare, unresolved id when not (CI installs the root only).
vi.mock("electron", () => ({ app: { getPath: () => userData.dir } }));
vi.mock("../../desktop-agent/node_modules/electron/index.js", () => ({ app: { getPath: () => userData.dir } }));

import { AgentStore } from "../../desktop-agent/src/lib/AgentStore";
import { IdleFlow, type IdleFlowPorts } from "../../desktop-agent/src/lib/idleFlow";
import {
  droppedIdleCommands,
  heartbeatTimeEntryId,
  pauseCommandAt,
  pauseForSystemAway,
  stopCommandAt,
  type SystemAwayPorts,
  type TimerCommandDraft,
} from "../../desktop-agent/src/lib/systemAway";
import { noTimerReminderDue, NO_TIMER_REMINDER_MIN_ACTIVE_MS, NO_TIMER_REMINDER_MIN_STOPPED_MS } from "../../desktop-agent/src/lib/noTimerReminder";
import {
  aggregateTimerStatus,
  heartbeatTimeEntryIds,
  MAX_SIMULTANEOUS_TIMERS,
  startChoice,
  TIMER_LIMIT_MESSAGE,
  simultaneousLabel,
  workedTimeLabel,
} from "../../desktop-agent/src/lib/simultaneousTimers";
import { DEFAULT_TRACKING_POLICY, normalizeTrackingPolicy } from "../../desktop-agent/src/lib/trackingPolicy";
import { SqliteQueue } from "../../desktop-agent/src/lib/SqliteQueue";
import { SyncWorker } from "../../desktop-agent/src/workers/SyncWorker";

/**
 * #400 (desktop half, ADR-0031): the agent runs up to three Timers at once,
 * pauses every one of them when the Member leaves, and counts Worked Time once.
 */

const MIN = 60_000;
const E1 = "11111111-1111-4111-8111-111111111111";
const E2 = "22222222-2222-4222-8222-222222222222";
const E3 = "33333333-3333-4333-8333-333333333333";

let store: AgentStore;

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(2026, 10, 27, 10, 0, 0));
  userData.dir = fs.mkdtempSync(path.join(os.tmpdir(), "agent-simultaneous-"));
  store = new AgentStore();
});

afterEach(() => {
  vi.useRealTimers();
  fs.rmSync(userData.dir, { recursive: true, force: true });
});

function run(entryId: string, taskId: string, mode: "add" | "switch" = "add") {
  store.startTimer({
    entryId,
    crmProjectId: `project-${taskId}`,
    projectName: `Project ${taskId}`,
    taskId,
    taskName: `Task ${taskId}`,
    mode,
  });
}

describe("several Timers in the store", () => {
  it("adds a Timer beside the running one, and a switch replaces them all", () => {
    run(E1, "a");
    run(E2, "b");
    expect(store.getTimers().map((t) => [t.entryId, t.status])).toEqual([
      [E1, "running"],
      [E2, "running"],
    ]);
    run(E3, "c", "switch");
    expect(store.getTimers().map((t) => t.entryId)).toEqual([E3]);
    expect(store.getSessions().filter((s) => s.endTime === null).map((s) => s.entryId)).toEqual([E3]);
  });

  it("pauses, resumes and stops one Timer without touching the others", () => {
    run(E1, "a");
    run(E2, "b");
    store.pauseTimer(E1);
    expect(store.getTimer(E1)?.status).toBe("paused");
    expect(store.getTimer(E2)?.status).toBe("running");
    expect(store.getTimerStatus()).toBe("running");
    store.resumeTimer(E1);
    expect(store.getTimer(E1)?.status).toBe("running");
    store.stopTimer(E2);
    expect(store.getTimers().map((t) => t.entryId)).toEqual([E1]);
  });

  it("names the latest running Timer as the active one and reads paused only when none runs", () => {
    run(E1, "a");
    run(E2, "b");
    store.pauseTimer(E2);
    expect(store.getActiveEntryId()).toBe(E1);
    store.pauseTimer(E1);
    expect(store.getTimerStatus()).toBe("paused");
    expect(store.getActiveEntryId()).toBe(E2);
    store.clearTimer();
    expect(store.getTimerStatus()).toBe("stopped");
    expect(store.getActiveEntryId()).toBeNull();
  });

  it("keeps each Timer's own clock", () => {
    run(E1, "a");
    vi.advanceTimersByTime(10 * MIN);
    run(E2, "b");
    vi.advanceTimersByTime(5 * MIN);
    expect(store.getElapsedTodaySeconds(Date.now(), E1)).toBe(15 * 60);
    expect(store.getElapsedTodaySeconds(Date.now(), E2)).toBe(5 * 60);
    const state = store.getTimerState();
    expect(state.timers.map((t) => [t.entryId, t.elapsedToday])).toEqual([
      [E1, 15 * 60],
      [E2, 5 * 60],
    ]);
  });

  it("survives a restart", () => {
    run(E1, "a");
    run(E2, "b");
    store.pauseTimer(E1);
    const reopened = new AgentStore();
    expect(reopened.getTimers().map((t) => [t.entryId, t.status, t.taskName])).toEqual([
      [E1, "paused", "Task a"],
      [E2, "running", "Task b"],
    ]);
  });
});

describe("migration from the single-Timer store file", () => {
  it("reads the old active entry as one Timer", () => {
    fs.writeFileSync(
      path.join(userData.dir, "agent-config.json"),
      JSON.stringify({
        deviceId: "device-1",
        deviceToken: "token",
        deviceName: "Laptop",
        userEmail: "m@example.com",
        activeEntryId: E1,
        activeProjectName: "Northwind",
        activeTaskName: "Ledger rebuild",
        activeTaskId: "task-1",
        entryServerBase: 300,
        entryTaskHistoryToday: 120,
        sessions: [{ id: "s1", entryId: E1, taskId: "task-1", startTime: new Date(Date.now() - 10 * MIN).toISOString(), endTime: new Date(Date.now() - 5 * MIN).toISOString() }],
        lastActivityAt: new Date().toISOString(),
        timerStatus: "paused",
        activeEntryStartTime: new Date(Date.now() - 10 * MIN).toISOString(),
      }),
    );
    const migrated = new AgentStore();
    expect(migrated.isPaired()).toBe(true);
    expect(migrated.getTimers()).toHaveLength(1);
    const [timer] = migrated.getTimers();
    expect(timer).toMatchObject({
      entryId: E1,
      status: "paused",
      projectName: "Northwind",
      taskName: "Ledger rebuild",
      taskId: "task-1",
    });
    expect(migrated.getElapsedSeconds(Date.now(), E1)).toBe(300 + 5 * 60);
  });

  it("reads a file from before timerStatus existed as running, and a stopped one as none", () => {
    const file = path.join(userData.dir, "agent-config.json");
    fs.writeFileSync(file, JSON.stringify({ activeEntryId: E1, activeProjectName: "P", sessions: [] }));
    expect(new AgentStore().getTimers().map((t) => t.status)).toEqual(["running"]);
    fs.writeFileSync(file, JSON.stringify({ activeEntryId: null, timerStatus: "stopped", sessions: [] }));
    expect(new AgentStore().getTimers()).toEqual([]);
  });
});

describe("resync from the server's Timer list", () => {
  const serverTimer = (entryId: string, status: "running" | "paused", taskId: string) => ({
    entryId,
    status,
    duration: 120,
    crmProjectId: `project-${taskId}`,
    taskId,
    lastActivityAt: new Date().toISOString(),
    projectName: `Project ${taskId}`,
    taskName: `Task ${taskId}`,
    startTime: new Date(Date.now() - 2 * MIN).toISOString(),
  });

  it("adopts two Timers, newest first on the wire, oldest first in the store", () => {
    store.applyServerTimers([serverTimer(E2, "paused", "b"), serverTimer(E1, "running", "a")]);
    expect(store.getTimers().map((t) => [t.entryId, t.status, t.projectName])).toEqual([
      [E1, "running", "Project a"],
      [E2, "paused", "Project b"],
    ]);
    vi.advanceTimersByTime(MIN);
    expect(store.getElapsedSeconds(Date.now(), E1)).toBe(180);
    expect(store.getElapsedSeconds(Date.now(), E2)).toBe(120);
  });

  it("drops a Timer the server no longer has and keeps the others' sessions", () => {
    run(E1, "a");
    run(E2, "b");
    const before = store.getSessions().find((s) => s.entryId === E2 && s.endTime === null)!.id;
    store.applyServerTimers([serverTimer(E2, "running", "b")]);
    expect(store.getTimers().map((t) => t.entryId)).toEqual([E2]);
    expect(store.getSessions().filter((s) => s.endTime === null).map((s) => s.id)).toEqual([before]);
  });

  it("follows a pause made elsewhere on one Timer", () => {
    run(E1, "a");
    run(E2, "b");
    store.applyServerTimers([serverTimer(E2, "running", "b"), serverTimer(E1, "paused", "a")]);
    expect(store.getTimer(E1)?.status).toBe("paused");
    expect(store.getTimer(E2)?.status).toBe("running");
  });

  it("clears everything on an empty list", () => {
    run(E1, "a");
    store.applyServerTimers([]);
    expect(store.getTimers()).toEqual([]);
  });
});

describe("away and idle pause every running Timer, dated when the Member left", () => {
  const LEFT = () => new Date(Date.now() - 4 * MIN);

  function awayPorts(enqueued: TimerCommandDraft[], idleSince: Date | null = null): SystemAwayPorts {
    return {
      now: () => new Date(),
      timerStatus: () => store.getTimerStatus(),
      activeEntryId: () => store.getActiveEntryId(),
      runningEntryIds: () => store.getRunningEntryIds(),
      cancelIdle: () => idleSince,
      pauseLocally: (at) => store.setTimerPaused(at),
      enqueue: (draft) => enqueued.push(draft),
    };
  }

  it.each(["sleep", "screen lock"])("%s pauses both running Timers with one dated pause each", () => {
    run(E1, "a");
    run(E2, "b");
    run(E3, "c");
    store.pauseTimer(E3); // paused by hand: no command for it
    vi.advanceTimersByTime(10 * MIN);
    const enqueued: TimerCommandDraft[] = [];
    const at = pauseForSystemAway(awayPorts(enqueued));
    expect(at).toEqual(new Date());
    expect(enqueued).toEqual([pauseCommandAt(E1, at!), pauseCommandAt(E2, at!)]);
    expect(store.getTimers().map((t) => t.status)).toEqual(["paused", "paused", "paused"]);
  });

  it("dates the pauses where a running idle countdown began", () => {
    run(E1, "a");
    run(E2, "b");
    vi.advanceTimersByTime(10 * MIN);
    const left = LEFT();
    const enqueued: TimerCommandDraft[] = [];
    pauseForSystemAway(awayPorts(enqueued, left));
    expect(enqueued.map((d) => d.effectiveAt)).toEqual([left.toISOString(), left.toISOString()]);
    expect(store.getElapsedSeconds(Date.now(), E1)).toBe(6 * 60);
    expect(store.getElapsedSeconds(Date.now(), E2)).toBe(6 * 60);
  });

  it("idle pause closes every running Timer where the idle time began", () => {
    run(E1, "a");
    run(E2, "b");
    vi.advanceTimersByTime(10 * MIN);
    const left = LEFT();
    const paused = store.pauseRunningTimers(left);
    expect(paused).toEqual([E1, E2]);
    expect(paused.map((id) => pauseCommandAt(id, left))).toEqual([
      { type: "pause", entryId: E1, effectiveAt: left.toISOString() },
      { type: "pause", entryId: E2, effectiveAt: left.toISOString() },
    ]);
    expect(store.getElapsedSeconds(Date.now(), E1)).toBe(6 * 60);
  });

  it("\"I'm back\" resumes the Timers the idle pause stopped, not one paused by hand", () => {
    run(E1, "a");
    run(E2, "b");
    run(E3, "c");
    store.pauseTimer(E3);
    vi.advanceTimersByTime(10 * MIN);
    const paused = store.pauseRunningTimers(LEFT());
    vi.advanceTimersByTime(MIN);
    expect(store.resumeTimers(paused)).toEqual([E1, E2]);
    expect(store.getTimers().map((t) => [t.entryId, t.status])).toEqual([
      [E1, "running"],
      [E2, "running"],
      [E3, "paused"],
    ]);
  });

  it("\"I'm back\" during the countdown drops the idle time from every running Timer", () => {
    run(E1, "a");
    run(E2, "b");
    vi.advanceTimersByTime(10 * MIN);
    const left = LEFT();
    const dropped = store.pauseRunningTimers(left);
    store.resumeTimers(dropped);
    expect(dropped.flatMap((id) => droppedIdleCommands(id, left))).toEqual([
      { type: "pause", entryId: E1, effectiveAt: left.toISOString() },
      { type: "resume", entryId: E1 },
      { type: "pause", entryId: E2, effectiveAt: left.toISOString() },
      { type: "resume", entryId: E2 },
    ]);
    expect(store.getElapsedSeconds(Date.now(), E1)).toBe(6 * 60);
  });

  it("\"I'm not working\" stops every Timer, each closed where the idle time began", () => {
    run(E1, "a");
    run(E2, "b");
    vi.advanceTimersByTime(10 * MIN);
    const left = LEFT();
    const stopped = store.stopAllTimers(left);
    expect(stopped).toEqual([E1, E2]);
    expect(stopped.map((id) => stopCommandAt(id, left))).toEqual([
      { type: "stop", entryId: E1, effectiveAt: left.toISOString() },
      { type: "stop", entryId: E2, effectiveAt: left.toISOString() },
    ]);
    expect(store.getTimers()).toEqual([]);
    expect(store.getSessions().every((s) => s.endTime !== null && Date.parse(s.endTime) <= left.getTime())).toBe(true);
  });

  it("the idle flow sees a running Timer while any runs and pauses through its port once", () => {
    run(E1, "a");
    run(E2, "b");
    store.pauseTimer(E1);
    const pausedAt: Date[] = [];
    const ports: IdleFlowPorts = {
      now: () => Date.now(),
      setTimeout: () => 1,
      clearTimeout: () => {},
      timerStatus: () => store.getTimerStatus(),
      pauseAt: (at) => { pausedAt.push(at); store.pauseRunningTimers(at); },
      dropIdleSince: () => {},
      resume: () => {},
      stopAt: () => {},
      showPrompt: () => {},
      dismissPrompt: () => {},
      log: () => {},
    };
    const flow = new IdleFlow(ports);
    expect(flow.onIdleTimeout(600, { idlePromptEnabled: false, idleCountdownSeconds: 60 })).toBe("paused");
    expect(pausedAt).toHaveLength(1);
    expect(store.getTimerStatus()).toBe("paused");
  });
});

describe("the no-timer reminder fires only with zero Timers", () => {
  const NOW = 10_000_000_000;
  const due = {
    enabled: true,
    stoppedSinceMs: NOW - NO_TIMER_REMINDER_MIN_STOPPED_MS,
    activeSinceMs: NOW - NO_TIMER_REMINDER_MIN_ACTIVE_MS,
    lastReminderAtMs: 0,
    nowMs: NOW,
    withinActiveHours: true,
    blocked: false,
    idleSourceReliable: true,
  };

  it("is silent while any Timer is running or paused", () => {
    expect(noTimerReminderDue({ ...due, timerStatus: aggregateTimerStatus([{ status: "paused" }, { status: "paused" }]) })).toBe(false);
    expect(noTimerReminderDue({ ...due, timerStatus: aggregateTimerStatus([{ status: "paused" }, { status: "running" }]) })).toBe(false);
    expect(noTimerReminderDue({ ...due, timerStatus: aggregateTimerStatus([]) })).toBe(true);
  });

  it("reads the store's status the same way", () => {
    run(E1, "a");
    run(E2, "b");
    store.pauseTimer(E1);
    store.pauseTimer(E2);
    expect(store.getTimerStatus()).toBe("paused");
    store.stopTimer(E1);
    expect(store.getTimerStatus()).toBe("paused");
    store.stopTimer(E2);
    expect(store.getTimerStatus()).toBe("stopped");
  });
});

describe("Start asks Add or Switch", () => {
  it("switches as before with the option off or nothing active", () => {
    expect(startChoice({ simultaneousTimersEnabled: false, activeCount: 2 })).toEqual({ ask: false, canAdd: false, note: null });
    expect(startChoice({ simultaneousTimersEnabled: true, activeCount: 0 })).toEqual({ ask: false, canAdd: false, note: null });
  });

  it("asks with the option on and one Timer active", () => {
    expect(startChoice({ simultaneousTimersEnabled: true, activeCount: 1 })).toEqual({ ask: true, canAdd: true, note: null });
  });

  it("offers Switch only with three Timers active", () => {
    expect(MAX_SIMULTANEOUS_TIMERS).toBe(3);
    expect(TIMER_LIMIT_MESSAGE).toBe("You run 3 Timers. Stop one to add another.");
    expect(startChoice({ simultaneousTimersEnabled: true, activeCount: 3 })).toEqual({
      ask: true,
      canAdd: false,
      note: TIMER_LIMIT_MESSAGE,
    });
  });

  it("offers Switch only when the task already has a Timer", () => {
    expect(startChoice({ simultaneousTimersEnabled: true, activeCount: 1, taskHasTimer: true })).toMatchObject({
      ask: true,
      canAdd: false,
    });
  });

  it("reads the option from the delivered Tracking Policy, off by default", () => {
    expect(DEFAULT_TRACKING_POLICY.simultaneousTimersEnabled).toBe(false);
    expect(normalizeTrackingPolicy({ simultaneousTimersEnabled: true })?.simultaneousTimersEnabled).toBe(true);
    expect(normalizeTrackingPolicy({})?.simultaneousTimersEnabled).toBe(false);
  });
});

describe("the heartbeat names every running Timer", () => {
  it("lists running Timers, never a paused one or a local placeholder", () => {
    run(E1, "a");
    run(E2, "b");
    run("local-abc", "c");
    expect(heartbeatTimeEntryIds(store.getTimers())).toEqual([E1, E2]);
    store.pauseTimer(E1);
    expect(heartbeatTimeEntryIds(store.getTimers())).toEqual([E2]);
  });

  it("keeps timeEntryId on the latest running Timer", () => {
    run(E1, "a");
    run(E2, "b");
    expect(heartbeatTimeEntryId(store.getTimerStatus(), store.getActiveEntryId())).toBe(E2);
    store.pauseTimer(E2);
    expect(heartbeatTimeEntryId(store.getTimerStatus(), store.getActiveEntryId())).toBe(E1);
    expect(heartbeatTimeEntryId("running", "local-abc")).toBeNull();
  });
});

describe("the day total counts Worked Time once", () => {
  it("two Timers running together for 10 minutes add 10 minutes, not 20", () => {
    store.setWorkedTodayServerBase(3600, 0);
    run(E1, "a");
    run(E2, "b");
    vi.advanceTimersByTime(10 * MIN);
    expect(store.getWorkedTodaySeconds()).toBe(3600 + 10 * 60);
    expect(store.getSimultaneousTodaySeconds()).toBe(10 * 60);
  });

  it("counts only the part where they overlapped as simultaneous", () => {
    store.setWorkedTodayServerBase(0, 0);
    run(E1, "a");
    vi.advanceTimersByTime(10 * MIN);
    run(E2, "b");
    vi.advanceTimersByTime(5 * MIN);
    store.pauseTimer(E1);
    vi.advanceTimersByTime(5 * MIN);
    expect(store.getWorkedTodaySeconds()).toBe(20 * 60);
    expect(store.getSimultaneousTodaySeconds()).toBe(5 * 60);
  });

  it("restarts the live part at each read of the server total", () => {
    run(E1, "a");
    run(E2, "b");
    vi.advanceTimersByTime(10 * MIN);
    // The server's total now includes the running Timers, counted once.
    store.setWorkedTodayServerBase(5400, 600);
    expect(store.getWorkedTodaySeconds()).toBe(5400);
    vi.advanceTimersByTime(MIN);
    expect(store.getWorkedTodaySeconds()).toBe(5460);
    expect(store.getSimultaneousTodaySeconds()).toBe(660);
  });

  it("keeps counting a Timer stopped since the read until the next one", () => {
    store.setWorkedTodayServerBase(1000, 0);
    run(E1, "a");
    vi.advanceTimersByTime(10 * MIN);
    store.stopTimer(E1);
    vi.advanceTimersByTime(5 * MIN);
    expect(store.getWorkedTodaySeconds()).toBe(1600);
  });

  it("puts both counts on the timer state and a label", () => {
    store.setWorkedTodayServerBase(4 * 3600 + 20 * 60, 80 * 60);
    run(E1, "a");
    run(E2, "b");
    vi.advanceTimersByTime(10 * MIN);
    const state = store.getTimerState();
    expect(state.workedToday).toBe(4.5 * 3600);
    expect(state.simultaneousToday).toBe(90 * 60);
    expect(workedTimeLabel(state.workedToday, state.simultaneousToday)).toBe("4h 30m · 1h 30m simultaneous");
    expect(workedTimeLabel(2 * 3600, 0)).toBe("2h 00m");
    expect(simultaneousLabel(59)).toBeNull();
    expect(simultaneousLabel(60)).toBe("0h 01m simultaneous");
  });
});

describe("queued starts carry their mode, and a refused start is dropped", () => {
  let queue: SqliteQueue;
  let queueDir: string;

  beforeEach(() => {
    queueDir = fs.mkdtempSync(path.join(os.tmpdir(), "agent-simultaneous-queue-"));
    queue = new SqliteQueue(queueDir);
  });

  afterEach(() => {
    queue.close();
    fs.rmSync(queueDir, { recursive: true, force: true });
  });

  async function drain(api: Record<string, unknown>) {
    const sync = new SyncWorker(api as never, queue, store);
    const refused: string[] = [];
    sync.setOnTimerStartRefused((message) => refused.push(message));
    sync.triggerSync();
    await vi.advanceTimersByTimeAsync(100);
    sync.stop();
    return refused;
  }

  it("sends mode add and seeds the Timer whose start synced", async () => {
    run(E1, "a");
    run("local-b", "b");
    queue.enqueueTimerCommand({ clientCommandId: "c1", type: "start", entryId: "local-b", crmProjectId: "project-b", taskId: "b", mode: "add" });
    const startTimer = vi.fn(async () => ({ id: E2, taskAccumulatedToday: 900 }));
    await drain({ startTimer });
    expect(startTimer).toHaveBeenCalledWith("project-b", "b", undefined, "c1", "add");
    expect(store.getTimers().map((t) => t.entryId)).toEqual([E1, E2]);
    expect(store.getTimer(E2)?.entryServerBase).toBe(900);
    expect(store.getTimer(E1)?.entryServerBase).toBe(0);
  });

  it("drops a refused start and its Timer, never retries it, and fails what was queued behind it", async () => {
    run(E1, "a");
    run("local-b", "b");
    vi.advanceTimersByTime(MIN);
    queue.enqueueTimerCommand({ clientCommandId: "c1", type: "start", entryId: "local-b", crmProjectId: "project-b", taskId: "b", mode: "add" });
    queue.enqueueTimerCommand({ clientCommandId: "c2", type: "pause", entryId: "local-b" });
    const startTimer = vi.fn(async () => {
      throw Object.assign(new Error("You already run 3 Timers. Stop one before adding another."), { status: 409 });
    });
    const refused = await drain({ startTimer });
    expect(startTimer).toHaveBeenCalledTimes(1);
    expect(refused).toEqual(["You already run 3 Timers. Stop one before adding another."]);
    expect(queue.pendingTimerCommandCount()).toBe(0);
    expect(store.getTimers().map((t) => t.entryId)).toEqual([E1]);
    expect(store.getSessions().some((s) => s.entryId === "local-b")).toBe(false);
  });
});

describe("wiring (source)", () => {
  // main/index.ts cannot be imported outside Electron.
  const read = (rel: string) => fs.readFileSync(path.resolve(__dirname, "../../desktop-agent/src", rel), "utf8");
  const main = read("main/index.ts");
  const body = (marker: string, len = 1500) => {
    const at = main.indexOf(marker);
    expect(at, marker).toBeGreaterThan(-1);
    return main.slice(at, at + len);
  };

  it("the heartbeat names every running Timer and resyncs from the list", () => {
    const heartbeat = read("workers/HeartbeatWorker.ts");
    expect(heartbeat).toContain("timeEntryIds: heartbeatTimeEntryIds(this.store.getTimers())");
    expect(heartbeat).toContain("Array.isArray(result.timers)");
    expect(body("async function syncTimerFromServer")).toContain("apiClient.getTimers()");
    expect(body("function applyServerTimerSync")).toContain("store.applyServerTimers(listed)");
  });

  it("reads Worked Time with the running Timers included", () => {
    expect(read("lib/ApiClient.ts")).toContain("&includeActive=1");
    expect(body("async function refreshWorkedTodayServerBase")).toContain("store.setWorkedTodayServerBase(total, simultaneous)");
  });

  it("sleep and lock pause every running Timer", () => {
    expect(body("function pauseTimerForSystemAway")).toContain("runningEntryIds: () => store.getRunningEntryIds()");
  });

  it("idle pauses, resumes and stops every Timer it concerns", () => {
    expect(body("pauseAt: (at)", 600)).toContain("store.pauseRunningTimers(at)");
    expect(body("function resumeTimerAfterIdle", 700)).toContain("store.resumeTimers(entryIds)");
    expect(body("function stopTimerAfterIdle", 600)).toContain("store.stopAllTimers(at)");
  });

  it("every v2 day total goes through the shared Worked time card", () => {
    const stat = read("renderer/app-v2/components/WorkedTimeStat.tsx");
    expect(stat).toContain("simultaneousLabel(simultaneous)");
    expect(stat).toContain("workedTimeValue(total)");
    expect(read("renderer/app-v2/pages/TimerPage.tsx")).toContain('<WorkedTimeStat label="Worked time"');
    expect(read("renderer/app-v2/screens/ActivityScreen.tsx")).toContain('<WorkedTimeStat label="WORKED TIME"');
  });

  it("tells the renderer as soon as the option changes", () => {
    expect(body("function receiveTrackingPolicy", 1200)).toMatch(/if \(simultaneousChanged\) pushStateToRenderer\(\);/);
  });

  it("takes one capture, presigned with the latest running Timer", () => {
    expect(read("workers/ScreenCaptureWorker.ts")).toContain("this.store.getCaptureEntryId()");
  });

  it("queues each start with its mode and exposes stop-all", () => {
    expect(body('ipcMain.handle("agent:timer-start"', 2500)).toContain('mode: "add" as const');
    expect(main).toContain('ipcMain.handle("agent:timer-stop-all"');
    expect(read("renderer/preload.ts")).toContain('timerStopAll: () => ipcRenderer.invoke("agent:timer-stop-all")');
  });
});
