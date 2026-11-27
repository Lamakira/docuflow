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

/**
 * The server switched the Member's Timer to another entry (a Timer started from
 * the web app stops the one running here). The agent adopts the server's entry
 * and its clock keeps counting, whatever state the old entry was in locally.
 */
describe("Timer switched on the server", () => {
  let store: AgentStore;

  function serverEntry(status: "running" | "paused") {
    return {
      id: "entry-b",
      status,
      duration: 120,
      lastActivityAt: new Date().toISOString(),
      startTime: new Date(Date.now() - 120_000),
    };
  }

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 10, 27, 10, 0, 0));
    userData.dir = fs.mkdtempSync(path.join(os.tmpdir(), "agent-timer-switch-"));
    store = new AgentStore();
    store.setWorkedTodayServerBase(1000);
    store.setTimerRunning("entry-a", "Project", "task-a", "Task A");
    vi.advanceTimersByTime(600_000);
  });

  afterEach(() => {
    vi.useRealTimers();
    fs.rmSync(userData.dir, { recursive: true, force: true });
  });

  it("keeps counting the new entry when the old one was running here", () => {
    store.syncFromServer(serverEntry("running"));

    expect(store.getActiveEntryId()).toBe("entry-b");
    expect(store.getTimerStatus()).toBe("running");
    expect(store.getActiveSession()?.entryId).toBe("entry-b");
    expect(store.getElapsedSeconds()).toBe(120);

    vi.advanceTimersByTime(60_000);
    expect(store.getElapsedSeconds()).toBe(180);
    // The old entry's 600 s are folded in, the new one counts on top.
    expect(store.getWorkedTodaySeconds()).toBe(1000 + 600 + 180);
  });

  it("keeps counting the new entry when the old one was paused here", () => {
    store.setTimerPaused();
    store.syncFromServer(serverEntry("running"));

    expect(store.getActiveSession()?.entryId).toBe("entry-b");
    vi.advanceTimersByTime(60_000);
    expect(store.getElapsedSeconds()).toBe(180);
  });

  it("holds a new paused entry still", () => {
    store.syncFromServer(serverEntry("paused"));

    expect(store.getActiveEntryId()).toBe("entry-b");
    expect(store.getTimerStatus()).toBe("paused");
    expect(store.getActiveSession()).toBeNull();
    vi.advanceTimersByTime(60_000);
    expect(store.getElapsedSeconds()).toBe(120);
  });

  it("does not open a second session when the server repeats the same running entry", () => {
    store.syncFromServer(serverEntry("running"));
    vi.advanceTimersByTime(5_000);
    store.syncFromServer(serverEntry("running"));

    expect(store.getSessions().filter((s) => s.entryId === "entry-b" && s.endTime === null)).toHaveLength(1);
  });
});
