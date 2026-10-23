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

describe("Worked today across a stop", () => {
  let store: AgentStore;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 9, 23, 10, 0, 0));
    userData.dir = fs.mkdtempSync(path.join(os.tmpdir(), "agent-store-"));
    store = new AgentStore();
    store.setWorkedTodayServerBase(1000);
    store.setTimerRunning("entry-1", "Project", null);
    vi.advanceTimersByTime(600_000);
  });

  afterEach(() => {
    vi.useRealTimers();
    fs.rmSync(userData.dir, { recursive: true, force: true });
  });

  it("keeps the figure when the timer stops, before the server refresh", () => {
    expect(store.getWorkedTodaySeconds()).toBe(1600);
    store.clearTimer();
    expect(store.getWorkedTodaySeconds()).toBe(1600);
  });

  it("does not double-count once the server base includes the stopped entry", () => {
    store.clearTimer();
    store.setWorkedTodayServerBase(1600);
    expect(store.getWorkedTodaySeconds()).toBe(1600);
  });

  it("resets to 0 on sign-out", () => {
    store.clearSession();
    expect(store.getWorkedTodaySeconds()).toBe(0);
  });
});

describe("Worked today with task history and entry switches", () => {
  let store: AgentStore;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 9, 23, 10, 0, 0));
    userData.dir = fs.mkdtempSync(path.join(os.tmpdir(), "agent-store-"));
    store = new AgentStore();
  });

  afterEach(() => {
    vi.useRealTimers();
    fs.rmSync(userData.dir, { recursive: true, force: true });
  });

  it("does not count the task's earlier entries twice", () => {
    // The server total (1900) already includes the task's 900 s of stopped entries.
    store.setWorkedTodayServerBase(1900);
    store.setTimerRunning("entry-1", "Project", "task-1", "Task", null, 900);
    vi.advanceTimersByTime(600_000);
    expect(store.getWorkedTodaySeconds()).toBe(2500);
    expect(store.getElapsedTodaySeconds()).toBe(1500);
    store.clearTimer();
    expect(store.getWorkedTodaySeconds()).toBe(2500);
    store.setWorkedTodayServerBase(2500);
    expect(store.getWorkedTodaySeconds()).toBe(2500);
  });

  it("does not count the history twice when it arrives with the start response", () => {
    store.setWorkedTodayServerBase(1900);
    store.setTimerRunning("entry-1", "Project", "task-1", "Task");
    store.applyTaskAccumulatedToday(900);
    vi.advanceTimersByTime(600_000);
    expect(store.getWorkedTodaySeconds()).toBe(2500);
  });

  it("folds the previous entry when switching tasks", () => {
    store.setWorkedTodayServerBase(1000);
    store.setTimerRunning("entry-1", "Project", null);
    vi.advanceTimersByTime(600_000);
    store.setTimerRunning("entry-2", "Project", null);
    expect(store.getWorkedTodaySeconds()).toBe(1600);
    vi.advanceTimersByTime(30_000);
    expect(store.getWorkedTodaySeconds()).toBe(1630);
  });

  it("counts a timer started on another device", () => {
    store.setWorkedTodayServerBase(1000);
    store.syncFromServer({
      id: "entry-remote",
      status: "running",
      duration: 300,
      lastActivityAt: new Date().toISOString(),
      startTime: new Date(2026, 9, 23, 9, 50, 0),
    });
    expect(store.getWorkedTodaySeconds()).toBe(1300);
  });
});
