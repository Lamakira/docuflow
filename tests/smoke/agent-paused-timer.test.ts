import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  PAUSED_REMINDER_ACTIVE_IDLE_SECONDS,
  PAUSED_REMINDER_CHECK_MS,
  PAUSED_REMINDER_MIN_PAUSE_MS,
  PAUSED_REMINDER_REPEAT_MS,
  pausedFromPreviousDay,
  pausedReminderDue,
  pausedSince,
} from "../../desktop-agent/src/lib/pausedTimer";

/**
 * Issue #330 (desktop half): a paused entry never survives into a new local
 * day, and a Member who is working while paused is reminded. Decisions are
 * pure (`lib/pausedTimer.ts`); the Electron wiring is asserted from source
 * because `main/index.ts` cannot be imported outside Electron.
 */

const read = (rel: string) => readFileSync(path.resolve(__dirname, "../..", rel), "utf8");

describe("pausedSince", () => {
  const base = { timerStatus: "paused", activeEntryId: "e1", activeEntryStartTime: "2026-10-20T08:00:00.000Z" };

  it("is null unless the timer is paused on an entry", () => {
    expect(pausedSince({ ...base, timerStatus: "running", sessions: [] })).toBeNull();
    expect(pausedSince({ ...base, timerStatus: "stopped", sessions: [] })).toBeNull();
    expect(pausedSince({ ...base, activeEntryId: null, sessions: [] })).toBeNull();
  });

  it("uses the latest session end of the active entry", () => {
    const d = pausedSince({
      ...base,
      sessions: [
        { entryId: "e1", endTime: "2026-10-20T09:00:00.000Z" },
        { entryId: "e1", endTime: "2026-10-20T11:00:00.000Z" },
        { entryId: "e1", endTime: "2026-10-20T10:00:00.000Z" },
      ],
    });
    expect(d?.toISOString()).toBe("2026-10-20T11:00:00.000Z");
  });

  it("falls back to the entry start", () => {
    expect(pausedSince({ ...base, sessions: [] })?.toISOString()).toBe("2026-10-20T08:00:00.000Z");
    expect(pausedSince({ ...base, activeEntryStartTime: null, sessions: [] })).toBeNull();
  });

  it("ignores other entries' sessions, open sessions and invalid dates", () => {
    const d = pausedSince({
      ...base,
      sessions: [
        { entryId: "other", endTime: "2026-10-21T09:00:00.000Z" },
        { entryId: "e1", endTime: null },
        { entryId: "e1", endTime: "not-a-date" },
      ],
    });
    expect(d?.toISOString()).toBe("2026-10-20T08:00:00.000Z");
    expect(pausedSince({ ...base, activeEntryStartTime: "garbage", sessions: [] })).toBeNull();
  });
});

describe("pausedFromPreviousDay", () => {
  const original = process.env.DOCUFLOW_TEST_DAY_ROLLOVER_SECONDS;
  afterEach(() => {
    if (original === undefined) delete process.env.DOCUFLOW_TEST_DAY_ROLLOVER_SECONDS;
    else process.env.DOCUFLOW_TEST_DAY_ROLLOVER_SECONDS = original;
  });

  it("is true when paused 23:50 yesterday and it is 00:05 today", () => {
    delete process.env.DOCUFLOW_TEST_DAY_ROLLOVER_SECONDS;
    const paused = new Date(2026, 9, 20, 23, 50).getTime();
    const now = new Date(2026, 9, 21, 0, 5).getTime();
    expect(pausedFromPreviousDay(paused, now)).toBe(true);
  });

  it("is false when paused earlier today", () => {
    delete process.env.DOCUFLOW_TEST_DAY_ROLLOVER_SECONDS;
    const paused = new Date(2026, 9, 21, 0, 1).getTime();
    const now = new Date(2026, 9, 21, 15, 0).getTime();
    expect(pausedFromPreviousDay(paused, now)).toBe(false);
  });

  it("follows the synthetic test day windows", () => {
    process.env.DOCUFLOW_TEST_DAY_ROLLOVER_SECONDS = "60";
    expect(pausedFromPreviousDay(10_000, 70_000)).toBe(true);
    expect(pausedFromPreviousDay(70_000, 100_000)).toBe(false);
  });
});

describe("pausedReminderDue", () => {
  const MIN = PAUSED_REMINDER_MIN_PAUSE_MS;
  const now = 10_000_000_000;
  const due = {
    pausedSinceMs: now - MIN,
    nowMs: now,
    lastReminderAtMs: 0,
    idleSeconds: 0,
    idlePromptOpen: false,
  };

  it("exposes the agreed cadence", () => {
    expect(PAUSED_REMINDER_CHECK_MS).toBe(30_000);
    expect(MIN).toBe(300_000);
    expect(PAUSED_REMINDER_REPEAT_MS).toBe(900_000);
    expect(PAUSED_REMINDER_ACTIVE_IDLE_SECONDS).toBe(60);
  });

  it("waits for 5 minutes of pause", () => {
    expect(pausedReminderDue({ ...due, pausedSinceMs: now - MIN + 1 })).toBe(false);
    expect(pausedReminderDue(due)).toBe(true);
    expect(pausedReminderDue({ ...due, pausedSinceMs: null })).toBe(false);
  });

  it("needs recent activity", () => {
    expect(pausedReminderDue({ ...due, idleSeconds: 59 })).toBe(true);
    expect(pausedReminderDue({ ...due, idleSeconds: 60 })).toBe(false);
  });

  it("repeats at most every 15 minutes", () => {
    const R = PAUSED_REMINDER_REPEAT_MS;
    expect(pausedReminderDue({ ...due, lastReminderAtMs: now - R + 1 })).toBe(false);
    expect(pausedReminderDue({ ...due, lastReminderAtMs: now - R })).toBe(true);
  });

  it("stays quiet while an idle prompt is open", () => {
    expect(pausedReminderDue({ ...due, idlePromptOpen: true })).toBe(false);
  });
});

describe("wiring (source)", () => {
  const main = read("desktop-agent/src/main/index.ts");
  const body = (re: RegExp) => {
    const m = re.exec(main);
    expect(m, `${re} not found`).not.toBeNull();
    return main.slice(m!.index, m!.index + 1500);
  };

  it("stops a previous-day paused entry at startup", () => {
    expect(main).toMatch(/autoResumeFromQueue\(\);\s*stopPausedEntryFromPreviousDay\("startup"\)/);
  });

  it("stops it on the worked-today tick", () => {
    expect(body(/function scheduleWorkedTodayTick/)).toContain('stopPausedEntryFromPreviousDay("day-check")');
  });

  it("stops it on resume, IPC and tray alike", () => {
    expect(body(/function resumeActiveTimer/)).toContain('stopPausedEntryFromPreviousDay("resume")');
    expect(main).toContain('ipcMain.handle("agent:timer-resume"');
    expect(body(/label: "Resume timer"/)).toContain('stopPausedEntryFromPreviousDay("tray-resume")');
  });

  it("shares the stop path with agent:timer-stop and runs the reminder interval", () => {
    expect(body(/ipcMain\.handle\("agent:timer-stop"/)).toContain("stopActiveTimer(");
    expect(main).toContain("setInterval(checkPausedReminder, PAUSED_REMINDER_CHECK_MS)");
    expect(main).toContain("clearInterval(pausedReminderInterval)");
  });

  it("exposes Stop in the widget", () => {
    const preload = read("desktop-agent/src/renderer/widget-preload.ts");
    expect(preload).toMatch(/timerStop:\s*\(\)\s*=>\s*ipcRenderer\.invoke\("agent:timer-stop"\)/);
    const widget = read("desktop-agent/src/renderer/widget.tsx");
    expect(widget).toContain("timerStop: () => Promise<any>");
    expect(widget).toContain("window.widgetBridge.timerStop()");
    expect(widget).toMatch(/type="button"[\s\S]{0,200}aria-label="Stop timer"[\s\S]{0,200}title="Stop"/);

    // The bar v2 actually mounts (`widget-index.tsx`); `widget.tsx` is the v1 fallback.
    const v2 = read("desktop-agent/src/renderer/app-v2/Widget.tsx");
    expect(v2).toContain("window.widgetBridge.timerStop()");
    expect(v2).toMatch(/type="button"[\s\S]{0,120}className="w2__stop"[\s\S]{0,300}aria-label="Stop timer"/);
    expect(read("desktop-agent/src/renderer/app-v2/styles/widget.css")).toContain(".w2__stop:focus-visible");
  });
});
