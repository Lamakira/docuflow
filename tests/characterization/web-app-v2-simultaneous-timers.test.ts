import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { agentUpdateBanner } from "../../client/src/v2/agentUpdate";
import { simultaneousTimersOption } from "../../client/src/v2/administration";
import { composeTimeTracking, startChoice, switchStopsLine, workedTimeLabel } from "../../client/src/v2/time";

/**
 * Simultaneous Timers on the web (#400, ADR-0031): the add-or-switch question,
 * the Worked Time line, the Tracking Policy option and the outdated-app banner.
 */

const V2_DIR = join(dirname(fileURLToPath(import.meta.url)), "../../client/src/v2");

describe("startChoice", () => {
  it("switches at once with the option off, however many Timers run", () => {
    expect(startChoice({ simultaneousTimers: false, maxTimers: 1, activeCount: 1 })).toEqual({ kind: "switch" });
  });

  it("switches at once when nothing runs", () => {
    expect(startChoice({ simultaneousTimers: true, maxTimers: 3, activeCount: 0 })).toEqual({ kind: "switch" });
  });

  it("asks add or switch with one Timer active", () => {
    expect(startChoice({ simultaneousTimers: true, maxTimers: 3, activeCount: 1 })).toEqual({
      kind: "ask",
      canAdd: true,
      limitLine: null,
    });
  });

  it("offers only Switch at the limit and says why", () => {
    expect(startChoice({ simultaneousTimers: true, maxTimers: 3, activeCount: 3 })).toEqual({
      kind: "ask",
      canAdd: false,
      limitLine: "You run 3 Timers. Stop one to add another.",
    });
  });

  it("names what Switch stops", () => {
    expect(switchStopsLine(["Ledger"])).toBe("Switch stops the Timer on Ledger.");
    expect(switchStopsLine(["Ledger", "Atlas"])).toBe("Switch stops your 2 Timers, paused ones included.");
  });
});

describe("workedTimeLabel", () => {
  it("shows Simultaneous Time beside Worked Time", () => {
    expect(workedTimeLabel(16200, 5400)).toBe("Worked time 4h 30m · 1h 30m simultaneous");
  });

  it("drops the simultaneous part when there is none", () => {
    expect(workedTimeLabel(16200, 0)).toBe("Worked time 4h 30m");
  });

  it("replaces the Time page's day chip only when Timers overlapped", () => {
    const input = {
      now: new Date("2026-12-01T10:00:00Z"),
      currentUserId: "u1",
      isAdmin: false,
      isRunning: false,
      displayDuration: 0,
      activeEntryId: null,
      entries: [],
      workdaySeconds: 16200,
    };
    expect(composeTimeTracking(input).workdayHours).toBe("You today 4.5 h");
    expect(composeTimeTracking({ ...input, simultaneousSeconds: 5400 }).workdayHours).toBe(
      "Worked time 4h 30m · 1h 30m simultaneous",
    );
  });
});

describe("agentUpdateBanner", () => {
  const devices = [
    { id: "d1", name: "Work laptop", clientVersion: "1.2.0" },
    { id: "d2", name: "Studio PC", clientVersion: null },
  ];
  const options = { locale: "en-GB", timeZone: "UTC" };

  it("shows nothing without a Device to update", () => {
    expect(agentUpdateBanner({ launchAt: null, launched: false, devices: [] }, options)).toBeNull();
    expect(agentUpdateBanner(undefined, options)).toBeNull();
  });

  it("warns before the launch with the date", () => {
    const banner = agentUpdateBanner({ launchAt: "2026-12-15T00:00:00Z", launched: false, devices }, options);
    expect(banner).toEqual({
      copy: "Update the desktop app on Work laptop and Studio PC before 15 December 2026. After that it can no longer start a Timer.",
      linkLabel: "Get the new version",
      href: "/devices",
    });
  });

  it("says what no longer works after the launch", () => {
    const banner = agentUpdateBanner({ launchAt: "2026-12-15T00:00:00Z", launched: true, devices: devices.slice(0, 1) }, options);
    expect(banner?.copy).toBe("Update the desktop app on Work laptop. This version can no longer start a Timer.");
  });

  it("has no em dash", () => {
    for (const input of [
      { launchAt: "2026-12-15T00:00:00Z", launched: false, devices },
      { launchAt: null, launched: false, devices },
      { launchAt: null, launched: true, devices },
    ]) {
      expect(agentUpdateBanner(input, options)?.copy).not.toContain("—");
    }
  });
});

describe("simultaneousTimersOption", () => {
  const options = { locale: "en-GB", timeZone: "UTC" };

  it("is hidden on a Plan without Tasks", () => {
    expect(simultaneousTimersOption({ launched: true, launchAt: null, includedInPlan: false }, options).visible).toBe(false);
    expect(simultaneousTimersOption(undefined, options).visible).toBe(false);
  });

  it("is disabled before the launch, with the date when it is known", () => {
    const option = simultaneousTimersOption({ launched: false, launchAt: "2026-12-15T00:00:00Z", includedInPlan: true }, options);
    expect(option).toMatchObject({ visible: true, disabled: true, note: "Available from 15 December 2026" });
    expect(option.hint).toBe("Let Members run up to 3 Timers at once. Each hour counts once in their day.");
  });

  it("says when it is available without a date", () => {
    const option = simultaneousTimersOption({ launched: false, launchAt: null, includedInPlan: true }, options);
    expect(option).toMatchObject({ disabled: true, note: "Available once every desktop app can be updated" });
  });

  it("can be turned on after the launch", () => {
    const option = simultaneousTimersOption({ launched: true, launchAt: "2026-12-15T00:00:00Z", includedInPlan: true }, options);
    expect(option).toMatchObject({ visible: true, disabled: false, note: null });
  });
});

describe("Start goes through the add-or-switch question", () => {
  it("no v2 screen takes handleStart from the Timer context, only the shared hook does", () => {
    const fromContext = /const\s*\{[^}]*\bhandleStart\b[^}]*\}\s*=\s*useTimeTracker\(\)/;
    const offenders = readdirSync(V2_DIR)
      .filter((file) => file.endsWith(".tsx") && file !== "V2StartTimer.tsx")
      .filter((file) => fromContext.test(readFileSync(join(V2_DIR, file), "utf8")));
    expect(offenders).toEqual([]);
  });
});

describe("the Time page offers another Timer beside a running one (#400)", () => {
  const timeSource = readFileSync(join(V2_DIR, "V2Time.tsx"), "utf8");
  const chipSource = readFileSync(join(V2_DIR, "V2TimerChip.tsx"), "utf8");

  it("keeps its own Project and Task, and starts through the add-or-switch question", () => {
    expect(timeSource).toContain("busy && simultaneousTimers");
    expect(timeSource).toContain("onClick={() => start(anotherProjectId, anotherTaskId || undefined)}");
    expect(timeSource).toContain("Start another");
  });

  it("puts the list of Timers after Stop on the chip, never between Pause and Stop", () => {
    expect(chipSource.indexOf('data-testid="v2-timer-stop"')).toBeLessThan(chipSource.indexOf('data-testid="v2-timer-count"'));
  });
});
