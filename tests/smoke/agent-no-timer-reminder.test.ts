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
import {
  NO_TIMER_REMINDER_MIN_ACTIVE_MS,
  NO_TIMER_REMINDER_MIN_STOPPED_MS,
  NO_TIMER_REMINDER_REPEAT_MS,
  nextActiveSince,
  noTimerReminderDue,
} from "../../desktop-agent/src/lib/noTimerReminder";

/**
 * Issue #351: nudge a Member who is working with no Timer running. Pure decision,
 * so every rule is checked with plain facts.
 */
const NOW = 10_000_000_000;
const due = {
  enabled: true,
  timerStatus: "stopped",
  stoppedSinceMs: NOW - NO_TIMER_REMINDER_MIN_STOPPED_MS,
  activeSinceMs: NOW - NO_TIMER_REMINDER_MIN_ACTIVE_MS as number | null,
  lastReminderAtMs: 0,
  nowMs: NOW,
  withinActiveHours: true,
  blocked: false,
  idleSourceReliable: true,
};

describe("noTimerReminderDue", () => {
  it("nudges when stopped 5 min, active 2 min, never reminded", () => {
    expect(noTimerReminderDue(due)).toBe(true);
  });

  it("is silent while running or paused", () => {
    expect(noTimerReminderDue({ ...due, timerStatus: "running" })).toBe(false);
    expect(noTimerReminderDue({ ...due, timerStatus: "paused" })).toBe(false);
  });

  it("is silent before 5 min without a timer", () => {
    expect(noTimerReminderDue({ ...due, stoppedSinceMs: NOW - NO_TIMER_REMINDER_MIN_STOPPED_MS + 1 })).toBe(false);
  });

  it("is silent after a single active check", () => {
    expect(noTimerReminderDue({ ...due, activeSinceMs: NOW })).toBe(false);
    expect(noTimerReminderDue({ ...due, activeSinceMs: null })).toBe(false);
  });

  it("does not repeat within 30 min, then repeats", () => {
    expect(noTimerReminderDue({ ...due, lastReminderAtMs: NOW - NO_TIMER_REMINDER_REPEAT_MS + 1 })).toBe(false);
    expect(noTimerReminderDue({ ...due, lastReminderAtMs: NOW - NO_TIMER_REMINDER_REPEAT_MS })).toBe(true);
  });

  it("is silent outside active hours, when blocked, or when disabled", () => {
    expect(noTimerReminderDue({ ...due, withinActiveHours: false })).toBe(false);
    expect(noTimerReminderDue({ ...due, blocked: true })).toBe(false);
    expect(noTimerReminderDue({ ...due, enabled: false })).toBe(false);
  });

  it("is silent when the idle source is unreliable", () => {
    expect(noTimerReminderDue({ ...due, idleSourceReliable: false })).toBe(false);
  });
});

describe("nextActiveSince", () => {
  it("starts a run on the first active check", () => {
    expect(nextActiveSince(null, 5, NOW)).toBe(NOW);
  });

  it("keeps the run start while active", () => {
    expect(nextActiveSince(NOW - 90_000, 10, NOW)).toBe(NOW - 90_000);
  });

  it("resets on idle of 60 s or more", () => {
    expect(nextActiveSince(NOW - 90_000, 60, NOW)).toBeNull();
    expect(nextActiveSince(null, 300, NOW)).toBeNull();
  });
});

describe("No-timer reminder preference", () => {
  beforeEach(() => {
    userData.dir = fs.mkdtempSync(path.join(os.tmpdir(), "agent-store-"));
  });

  afterEach(() => {
    fs.rmSync(userData.dir, { recursive: true, force: true });
  });

  it("is on for a fresh install and persists when turned off", () => {
    const store = new AgentStore();
    expect(store.getNoTimerReminderEnabled()).toBe(true);
    store.setNoTimerReminderEnabled(false);
    expect(new AgentStore().getNoTimerReminderEnabled()).toBe(false);
  });
});

describe("wiring (source)", () => {
  const root = path.resolve(__dirname, "../../desktop-agent/src");
  const main = fs.readFileSync(path.join(root, "main/index.ts"), "utf8");
  const app = fs.readFileSync(path.join(root, "renderer/app-v2/App.tsx"), "utf8");
  const start = main.indexOf("function checkNoTimerReminder()");
  const body = main.slice(start, main.indexOf("\nipcMain.handle(", start));

  it("the notification click shows the window and opens the Timer screen", () => {
    expect(body).toMatch(/notification\.on\("click", \(\) => \{\s*showMainWindow\(\);\s*mainWindow\?\.webContents\.send\("agent:show-timer"\);/);
  });

  it("never enqueues a timer command", () => {
    expect(start).toBeGreaterThan(-1);
    expect(body).not.toContain("enqueueTimerCommand");
    expect(body).not.toContain("queue.");
  });

  it("the v2 app opens the Timer page on show-timer", () => {
    expect(app).toMatch(/onShowTimer\(\(\) => dispatch\(\{ type: 'SET_PAGE', page: 'timer' \}\)\)/);
  });
});
