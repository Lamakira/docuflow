import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  droppedIdleCommands,
  heartbeatTimeEntryId,
  pauseCommandAt,
  pauseForSystemAway,
  stopCommandAt,
  type SystemAwayPorts,
  type TimerCommandDraft,
} from "../../desktop-agent/src/lib/systemAway";
import {
  NETWORK_UNAVAILABLE,
  timerCommandFailure,
} from "../../desktop-agent/src/lib/timerCommandFailure";

/**
 * Issue #333 (desktop half): pauses and stops reach the server dated when the
 * Member left, heartbeats name no entry while the Timer is paused here, and a
 * command that never reached the server stays queued.
 */

const read = (rel: string) => readFileSync(path.resolve(__dirname, "../..", rel), "utf8");

const NOW = new Date("2026-10-23T10:00:00.000Z");
const IDLE_SINCE = new Date("2026-10-23T09:50:00.000Z");

function fakePorts(over: Partial<SystemAwayPorts> = {}) {
  const calls = { cancelIdle: 0, pausedAt: [] as Date[], enqueued: [] as TimerCommandDraft[] };
  const ports: SystemAwayPorts = {
    now: () => NOW,
    timerStatus: () => "running",
    activeEntryId: () => "e1",
    cancelIdle: () => {
      calls.cancelIdle++;
      return null;
    },
    pauseLocally: (at) => calls.pausedAt.push(at),
    enqueue: (command) => calls.enqueued.push(command),
    ...over,
  };
  return { ports, calls };
}

describe("pauseForSystemAway", () => {
  it("pauses locally and queues a pause dated now", () => {
    const { ports, calls } = fakePorts();
    expect(pauseForSystemAway(ports)).toEqual(NOW);
    expect(calls.pausedAt).toEqual([NOW]);
    expect(calls.enqueued).toEqual([
      { type: "pause", entryId: "e1", effectiveAt: NOW.toISOString() },
    ]);
  });

  it("dates the pause where a running idle countdown began", () => {
    const { ports, calls } = fakePorts({ cancelIdle: () => IDLE_SINCE });
    expect(pauseForSystemAway(ports)).toEqual(IDLE_SINCE);
    expect(calls.pausedAt).toEqual([IDLE_SINCE]);
    expect(calls.enqueued[0].effectiveAt).toBe(IDLE_SINCE.toISOString());
  });

  it.each([
    ["paused", { timerStatus: () => "paused" }],
    ["stopped", { timerStatus: () => "stopped" }],
    ["without an entry", { activeEntryId: () => null }],
  ])("does nothing when %s", (_label, over) => {
    const { ports, calls } = fakePorts(over);
    expect(pauseForSystemAway(ports)).toBeNull();
    expect(calls.enqueued).toEqual([]);
    expect(calls.pausedAt).toEqual([]);
    expect(calls.cancelIdle).toBe(0);
  });
});

describe("heartbeatTimeEntryId", () => {
  it("names the entry only while running", () => {
    expect(heartbeatTimeEntryId("running", "e1")).toBe("e1");
    expect(heartbeatTimeEntryId("paused", "e1")).toBeNull();
    expect(heartbeatTimeEntryId("stopped", "e1")).toBeNull();
    expect(heartbeatTimeEntryId("running", null)).toBeNull();
  });
});

describe("command drafts", () => {
  it("dates pause and stop", () => {
    expect(pauseCommandAt("e1", IDLE_SINCE)).toEqual({
      type: "pause",
      entryId: "e1",
      effectiveAt: IDLE_SINCE.toISOString(),
    });
    expect(stopCommandAt("e1", IDLE_SINCE)).toEqual({
      type: "stop",
      entryId: "e1",
      effectiveAt: IDLE_SINCE.toISOString(),
    });
  });

  it("drops idle time with a dated pause then an undated resume", () => {
    const drafts = droppedIdleCommands("e1", IDLE_SINCE);
    expect(drafts).toEqual([
      { type: "pause", entryId: "e1", effectiveAt: IDLE_SINCE.toISOString() },
      { type: "resume", entryId: "e1" },
    ]);
    expect(drafts[1]).not.toHaveProperty("effectiveAt");
  });
});

describe("timerCommandFailure", () => {
  it.each(["Entry is not running", "Entry is not paused", "Entry already stopped", "Entry not found"])(
    "treats %j as a conflict",
    (message) => {
      expect(timerCommandFailure(new Error(message))).toBe("conflict");
    },
  );

  it("retries what never reached the server", () => {
    expect(timerCommandFailure(Object.assign(new Error("fetch failed"), { code: NETWORK_UNAVAILABLE }))).toBe("retry");
    for (const status of [502, 503, 504]) {
      expect(timerCommandFailure(Object.assign(new Error("Server error"), { status }))).toBe("retry");
    }
  });

  it("fails refusals", () => {
    expect(timerCommandFailure(Object.assign(new Error("boom"), { status: 500 }))).toBe("fail");
    expect(timerCommandFailure(Object.assign(new Error("Bad input"), { status: 400 }))).toBe("fail");
    expect(timerCommandFailure(new Error("anything else"))).toBe("fail");
  });

  it("checks conflict first", () => {
    expect(timerCommandFailure(Object.assign(new Error("Entry is not running"), { status: 400 }))).toBe("conflict");
  });
});

describe("wiring", () => {
  const main = read("desktop-agent/src/main/index.ts");
  const body = (re: RegExp, len = 1500) => {
    const m = re.exec(main);
    expect(m, String(re)).not.toBeNull();
    return main.slice(m!.index, m!.index + len);
  };

  it("heartbeats name the entry only while running", () => {
    expect(read("desktop-agent/src/workers/HeartbeatWorker.ts")).toContain(
      "heartbeatTimeEntryId(this.store.getTimerStatus(), this.store.getActiveEntryId())",
    );
  });

  it("the sync worker sends effectiveAt and keeps unsent commands", () => {
    const sync = read("desktop-agent/src/workers/SyncWorker.ts");
    expect(sync).toContain("pauseTimer(cmd.entryId!, cmd.effectiveAt)");
    expect(sync).toContain("stopTimer(cmd.entryId!, cmd.effectiveAt)");
    expect(sync).toContain("timerCommandFailure(");
  });

  it("the sync worker drains one cycle at a time", () => {
    const sync = read("desktop-agent/src/workers/SyncWorker.ts");
    // A second drain would resend a pending pause, which could land after its resume.
    expect(sync).toMatch(/triggerSync\(\): void \{\s*if \(this\.syncing\) \{\s*this\.syncAgain = true;\s*return;/);
    expect(sync).toMatch(/this\.syncing = true;\s*try \{\s*await this\.drainTimerCommands\(\);/);
  });

  it("the API client sends effectiveAt and tags unreachable errors", () => {
    const api = read("desktop-agent/src/lib/ApiClient.ts");
    for (const name of ["pauseTimer", "stopTimer"]) {
      const start = api.indexOf(`async ${name}(`);
      expect(start).toBeGreaterThan(-1);
      expect(api.slice(start, start + 600)).toMatch(/\.\.\.\(effectiveAt \? \{ effectiveAt \} : \{\}\)/);
    }
    expect(api).toContain("code: NETWORK_UNAVAILABLE");
  });

  it("system away pauses reach the server", () => {
    const away = body(/function pauseTimerForSystemAway/);
    expect(away).toContain("pauseForSystemAway(");
    expect(away).toContain("syncWorker?.triggerSync()");
    expect(main).not.toContain("Local pause only");
  });

  it("wake sends the queued pause first", () => {
    expect(body(/const onSystemBack = /, 500)).toContain("syncWorker?.triggerSync()");
  });

  it("idle pauses, drops and stops are dated", () => {
    expect(body(/pauseAt: \(at\)/, 600)).toContain("pauseCommandAt(");
    expect(body(/dropIdleSince: \(at\)/, 800)).toContain("droppedIdleCommands(");
    expect(body(/function stopTimerAfterIdle/, 600)).toContain("stopCommandAt(");
  });
});
