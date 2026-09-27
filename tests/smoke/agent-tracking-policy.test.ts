import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  DEFAULT_TRACKING_POLICY,
  idleBehaviourCopy,
  isWithinActiveHours,
  normalizeTrackingPolicy,
  policyFreshnessCopy,
  startupTrackingPolicy,
  type TrackingPolicy,
} from "../../desktop-agent/src/lib/trackingPolicy";
import {
  TRACKING_POLICY_FILENAME,
  clearSavedTrackingPolicy,
  loadSavedTrackingPolicy,
  saveTrackingPolicy,
} from "../../desktop-agent/src/lib/trackingPolicyFile";
import { CaptureScheduler, captureIntervalFromPolicy } from "../../desktop-agent/src/lib/captureSchedule";
import {
  IdleFlow,
  countdownRemainingSeconds,
  formatCountdown,
  idleTimeoutReached,
  type IdleFlowPorts,
  type IdlePromptPayload,
} from "../../desktop-agent/src/lib/idleFlow";
import { DEFAULT_SCREENSHOT_POLICY } from "../../shared/schema";

/**
 * #293. The Tracking Policy reached the desktop but several settings did not
 * behave as Administration said: the countdown was dead, turning the prompt off
 * turned idle pause off, overnight windows never matched, a new interval waited
 * for the old capture, and a start without the server used hard-coded defaults.
 * These are the Device's decisions; `main/index.ts` and the workers wire them.
 */

const read = (rel: string) =>
  readFileSync(path.resolve(import.meta.dirname, "../../desktop-agent/src", rel), "utf8");

function policy(overrides: Partial<TrackingPolicy> = {}): TrackingPolicy {
  return { ...DEFAULT_TRACKING_POLICY, ...overrides };
}

function at(hhmm: string): Date {
  const [h, m] = hhmm.split(":").map(Number);
  return new Date(2026, 8, 27, h, m, 0);
}

describe("Tracking Policy defaults (#293)", () => {
  it("mirrors the server's defaults so an unreached server changes nothing", () => {
    expect(DEFAULT_TRACKING_POLICY).toEqual(DEFAULT_SCREENSHOT_POLICY);
  });
});

describe("active hours on the Device clock (#293)", () => {
  it("restricts nothing when off", () => {
    expect(isWithinActiveHours(policy(), at("03:00"))).toBe(true);
  });

  it("matches a daytime window, start inclusive and end exclusive", () => {
    const day = policy({ activeHoursEnabled: true, activeHoursStart: "08:00", activeHoursEnd: "18:00" });
    expect(isWithinActiveHours(day, at("07:59"))).toBe(false);
    expect(isWithinActiveHours(day, at("08:00"))).toBe(true);
    expect(isWithinActiveHours(day, at("17:59"))).toBe(true);
    expect(isWithinActiveHours(day, at("18:00"))).toBe(false);
  });

  it("matches an overnight window across midnight", () => {
    const night = policy({ activeHoursEnabled: true, activeHoursStart: "22:00", activeHoursEnd: "06:00" });
    expect(isWithinActiveHours(night, at("21:59"))).toBe(false);
    expect(isWithinActiveHours(night, at("22:00"))).toBe(true);
    expect(isWithinActiveHours(night, at("23:59"))).toBe(true);
    expect(isWithinActiveHours(night, at("00:00"))).toBe(true);
    expect(isWithinActiveHours(night, at("05:59"))).toBe(true);
    expect(isWithinActiveHours(night, at("06:00"))).toBe(false);
    expect(isWithinActiveHours(night, at("12:00"))).toBe(false);
  });

  it("does not block every capture on a window it cannot read, or an empty one", () => {
    for (const [start, end] of [["8:00", "18:00"], ["08:00", "25:00"], ["", "18:00"], ["09:00", "09:00"]]) {
      const odd = policy({ activeHoursEnabled: true, activeHoursStart: start, activeHoursEnd: end });
      expect(isWithinActiveHours(odd, at("03:00")), `${start}–${end}`).toBe(true);
    }
  });

  it("is what ScreenCaptureWorker asks before a capture", () => {
    const worker = read("workers/ScreenCaptureWorker.ts");
    expect(worker).toContain("isWithinActiveHours(this.activeHours, new Date())");
    expect(worker).not.toContain('split(":")');
  });
});

describe("capture interval changes (#293)", () => {
  function fakeTimers() {
    let next = 1;
    const armed = new Map<number, { fn: () => void; ms: number }>();
    return {
      armed,
      timers: {
        setTimeout: (fn: () => void, ms: number) => {
          const id = next++;
          armed.set(id, { fn, ms });
          return id;
        },
        clearTimeout: (id: unknown) => void armed.delete(id as number),
        random: () => 0.5,
      },
    };
  }

  it("bounds the interval the way the server does", () => {
    expect(captureIntervalFromPolicy({ captureIntervalMinMin: 3, captureIntervalMaxMin: 5 })).toEqual({
      minMs: 180_000,
      maxMs: 300_000,
    });
    expect(captureIntervalFromPolicy({ captureIntervalMinMin: 1, captureIntervalMaxMin: 2 })).toEqual({
      minMs: 180_000,
      maxMs: 180_000,
    });
  });

  it("re-draws the waiting capture on the new bounds instead of letting the old one run out", () => {
    const { armed, timers } = fakeTimers();
    let fired = 0;
    const scheduler = new CaptureScheduler(() => fired++, captureIntervalFromPolicy(policy()), timers);

    scheduler.scheduleNext();
    expect([...armed.values()].map((t) => t.ms)).toEqual([240_000]);

    const rescheduled = scheduler.setInterval(
      captureIntervalFromPolicy({ captureIntervalMinMin: 10, captureIntervalMaxMin: 14 }),
    );
    expect(rescheduled).toBe(true);
    // Exactly one capture waits, drawn on 10–14 min.
    expect([...armed.values()].map((t) => t.ms)).toEqual([720_000]);

    [...armed.values()][0].fn();
    expect(fired).toBe(1);
    expect(scheduler.pending).toBe(false);
  });

  it("leaves the waiting capture alone when the bounds did not change, and arms nothing when none waited", () => {
    const { armed, timers } = fakeTimers();
    const scheduler = new CaptureScheduler(() => {}, captureIntervalFromPolicy(policy()), timers);

    expect(scheduler.setInterval(captureIntervalFromPolicy({ captureIntervalMinMin: 4, captureIntervalMaxMin: 6 }))).toBe(false);
    expect(armed.size).toBe(0);

    scheduler.scheduleNext();
    const [first] = armed.keys();
    expect(scheduler.setInterval(captureIntervalFromPolicy({ captureIntervalMinMin: 4, captureIntervalMaxMin: 6 }))).toBe(false);
    expect([...armed.keys()]).toEqual([first]);

    scheduler.cancel();
    expect(armed.size).toBe(0);
  });

  it("is wired so every heartbeat's policy reaches the waiting capture, and capture off/on stops or starts it", () => {
    const worker = read("workers/ScreenCaptureWorker.ts");
    expect(worker).toContain("this.scheduler.setInterval(captureIntervalFromPolicy(policy))");
    expect(worker).toMatch(/if \(!wasEnabled && this\.enabled\) \{\s*this\.start\(\);\s*\} else if \(wasEnabled && !this\.enabled\) \{\s*this\.stop\(\);/);
  });
});

describe("idle pause and the countdown prompt (#293)", () => {
  type Call = [string, ...unknown[]];

  function harness(status = "running") {
    const calls: Call[] = [];
    let now = 1_000_000;
    let timerStatus = status;
    let pending: { fn: () => void; ms: number } | null = null;
    const ports: IdleFlowPorts = {
      now: () => now,
      setTimeout: (fn, ms) => {
        pending = { fn, ms };
        return "t";
      },
      clearTimeout: () => {
        calls.push(["clearTimeout"]);
        pending = null;
      },
      timerStatus: () => timerStatus,
      pauseAt: (at) => {
        calls.push(["pauseAt", at.getTime()]);
        timerStatus = "paused";
      },
      dropIdleSince: (at) => calls.push(["dropIdleSince", at.getTime()]),
      resume: () => {
        calls.push(["resume"]);
        timerStatus = "running";
      },
      stopAt: (at) => {
        calls.push(["stopAt", at.getTime()]);
        timerStatus = "stopped";
      },
      showPrompt: (payload: IdlePromptPayload) => calls.push(["showPrompt", payload]),
      dismissPrompt: () => calls.push(["dismissPrompt"]),
      log: () => {},
    };
    return {
      flow: new IdleFlow(ports),
      calls,
      advance: (ms: number) => {
        now += ms;
      },
      expire: () => {
        const t = pending;
        pending = null;
        t?.fn();
      },
      pendingMs: () => (pending as { ms: number } | null)?.ms ?? null,
      setStatus: (s: string) => {
        timerStatus = s;
      },
      now: () => now,
    };
  }

  const idleStart = 1_000_000 - 600_000;

  it("asks first with a visible countdown while the Timer keeps running", () => {
    const h = harness();
    expect(h.flow.onIdleTimeout(600, policy({ idleCountdownSeconds: 45 }))).toBe("prompted");
    expect(h.calls).toEqual([
      ["showPrompt", { idleSeconds: 600, pausesAt: 1_000_000 + 45_000, countdownSeconds: 45 }],
    ]);
    expect(h.pendingMs()).toBe(45_000);
    expect(h.flow.counting).toBe(true);
  });

  it("pauses where the idle time began when the countdown ends with no answer, and keeps the prompt up", () => {
    const h = harness();
    h.flow.onIdleTimeout(600, policy({ idleCountdownSeconds: 30 }));
    h.advance(30_000);
    h.expire();
    expect(h.calls.slice(1)).toEqual([
      ["pauseAt", idleStart],
      ["showPrompt", { idleSeconds: 630, pausesAt: null, countdownSeconds: null }],
    ]);
    expect(h.flow.active).toBe(true);
    expect(h.flow.counting).toBe(false);

    // Back after the pause: resume, as the immediate pause always did.
    expect(h.flow.memberBack()).toBe(true);
    expect(h.calls.slice(3)).toEqual([["resume"], ["dismissPrompt"]]);
    expect(h.flow.active).toBe(false);
  });

  it("acts on an answer given in time: I'm back drops the idle time and never pauses", () => {
    const h = harness();
    h.flow.onIdleTimeout(600, policy());
    h.advance(10_000);
    expect(h.flow.memberBack()).toBe(true);
    expect(h.calls.slice(1)).toEqual([["clearTimeout"], ["dropIdleSince", idleStart], ["dismissPrompt"]]);
    expect(h.pendingMs()).toBeNull();
  });

  it("acts on an answer given in time: I'm not working stops the Timer where the idle time began", () => {
    const h = harness();
    h.flow.onIdleTimeout(600, policy());
    expect(h.flow.memberNotWorking()).toBe(true);
    expect(h.calls.slice(1)).toEqual([["clearTimeout"], ["stopAt", idleStart], ["dismissPrompt"]]);
  });

  it("with the prompt off still pauses at the Idle timeout, silently", () => {
    const h = harness();
    expect(h.flow.onIdleTimeout(600, policy({ idlePromptEnabled: false }))).toBe("paused");
    expect(h.calls).toEqual([["pauseAt", idleStart]]);
    expect(h.pendingMs()).toBeNull();
    expect(h.flow.active).toBe(false);
  });

  it("does nothing when the Timer is not running, or a prompt is already up", () => {
    expect(harness("paused").flow.onIdleTimeout(600, policy())).toBe("skipped");
    const h = harness();
    h.flow.onIdleTimeout(600, policy());
    expect(h.flow.onIdleTimeout(700, policy())).toBe("skipped");
    expect(h.calls.filter(([name]) => name === "showPrompt")).toHaveLength(1);
  });

  it("lets the countdown lapse quietly when the Timer was paused elsewhere meanwhile", () => {
    const h = harness();
    h.flow.onIdleTimeout(600, policy());
    h.setStatus("paused");
    h.expire();
    expect(h.calls.slice(1)).toEqual([["dismissPrompt"]]);
    expect(h.flow.active).toBe(false);
  });

  it("hands back when the idle time began if sleep or lock cuts the countdown short", () => {
    const h = harness();
    h.flow.onIdleTimeout(600, policy());
    expect(h.flow.cancel()?.getTime()).toBe(idleStart);
    expect(h.flow.active).toBe(false);
    expect(harness().flow.cancel()).toBeNull();
  });

  it("keeps the countdown within the server's 15–120 s", () => {
    const h = harness();
    h.flow.onIdleTimeout(600, policy({ idleCountdownSeconds: 5 }));
    expect(h.pendingMs()).toBe(15_000);
    const long = harness();
    long.flow.onIdleTimeout(600, policy({ idleCountdownSeconds: 900 }));
    expect(long.pendingMs()).toBe(120_000);
  });

  it("counts down in whole seconds for the prompt", () => {
    expect(countdownRemainingSeconds(10_000, 0)).toBe(10);
    expect(countdownRemainingSeconds(10_000, 9_001)).toBe(1);
    expect(countdownRemainingSeconds(10_000, 12_000)).toBe(0);
    expect(formatCountdown(65)).toBe("1:05");
    expect(formatCountdown(9)).toBe("0:09");
  });

  it("fires the Idle timeout whether or not the prompt is on", () => {
    const base = { idleSeconds: 600, thresholdSeconds: 600, alreadyTriggered: false, timerStatus: "running" };
    expect(idleTimeoutReached(base)).toBe(true);
    expect(idleTimeoutReached({ ...base, alreadyTriggered: true })).toBe(false);
    expect(idleTimeoutReached({ ...base, timerStatus: "paused" })).toBe(false);
    expect(idleTimeoutReached({ ...base, idleSeconds: 599 })).toBe(false);

    const worker = read("workers/ActivityWorker.ts");
    expect(worker).not.toContain("idleUxEnabled");
    expect(worker).toContain("idleTimeoutReached({");
    expect(read("main/index.ts")).toContain("idleFlow.onIdleTimeout(idleSeconds, trackingPolicy)");
  });

  it("says what the Device does on idle, instead of 'Pause immediately — no countdown'", () => {
    expect(idleBehaviourCopy(policy())).toBe(
      "After 10 min without input, asks whether you are still working and pauses the Timer if you do not answer within 60 s.",
    );
    expect(idleBehaviourCopy(policy({ idlePromptEnabled: false, idleTimeoutMinutes: 5 }))).toBe(
      "After 5 min without input, pauses the Timer without asking. Resume it when you are back.",
    );
    const v1 = read("renderer/app/pages/SettingsPage.tsx");
    expect(v1).not.toContain("Pause immediately — no countdown");
    expect(v1).not.toContain("the timer stops automatically");
    expect(v1).toContain("idleBehaviourCopy(policy)");
    expect(read("renderer/app-v2/screens/SettingsScreen.tsx")).toContain("idleBehaviourCopy(policy)");
    for (const prompt of ["renderer/app/components/timer/IdlePrompt.tsx", "renderer/app-v2/components/IdlePrompt.tsx"]) {
      expect(read(prompt)).toContain("useIdleCountdown(prompt?.pausesAt ?? null)");
    }
  });
});

describe("the last policy on the Device (#293)", () => {
  let dir: string | null = null;
  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
    dir = null;
  });

  it("keeps the last policy received and applies it at the next start", () => {
    dir = mkdtempSync(path.join(tmpdir(), "docuflow-policy-"));
    expect(loadSavedTrackingPolicy(dir)).toBeNull();

    const received = policy({ screenshotsEnabled: false, captureIntervalMinMin: 7, captureIntervalMaxMin: 9, idleTimeoutMinutes: 20 });
    saveTrackingPolicy(dir, received, new Date("2026-09-27T10:00:00.000Z"));
    const saved = loadSavedTrackingPolicy(dir);
    expect(saved).toEqual({ policy: received, receivedAt: "2026-09-27T10:00:00.000Z" });

    const startup = startupTrackingPolicy(saved, DEFAULT_TRACKING_POLICY);
    expect(startup.policy).toEqual(received);
    expect(startup.status).toEqual({
      source: "saved",
      receivedAt: "2026-09-27T10:00:00.000Z",
      refreshFailedAt: null,
      refreshError: null,
    });

    clearSavedTrackingPolicy(dir);
    expect(loadSavedTrackingPolicy(dir)).toBeNull();
    clearSavedTrackingPolicy(dir);
  });

  it("falls back to the defaults only when none was ever received, or the file is unreadable", () => {
    dir = mkdtempSync(path.join(tmpdir(), "docuflow-policy-"));
    const defaults = policy({ screenshotsEnabled: false });
    expect(startupTrackingPolicy(null, defaults)).toEqual({
      policy: defaults,
      status: { source: "default", receivedAt: null, refreshFailedAt: null, refreshError: null },
    });

    writeFileSync(path.join(dir, TRACKING_POLICY_FILENAME), "{not json");
    expect(loadSavedTrackingPolicy(dir)).toBeNull();
    writeFileSync(path.join(dir, TRACKING_POLICY_FILENAME), JSON.stringify({ policy: "x", receivedAt: "y" }));
    expect(loadSavedTrackingPolicy(dir)).toBeNull();
  });

  it("reads each field the answer gets right and keeps the rest from what it already had", () => {
    const known = policy({ idleTimeoutMinutes: 25 });
    expect(normalizeTrackingPolicy(null, known)).toBeNull();
    expect(normalizeTrackingPolicy([], known)).toBeNull();
    expect(
      normalizeTrackingPolicy({ screenshotsEnabled: false, idleTimeoutMinutes: "5", captureIntervalMaxMin: Number.NaN }, known),
    ).toEqual({ ...known, screenshotsEnabled: false });
  });

  it("applies the saved policy before the first heartbeat, and forgets it on sign-out", () => {
    const main = read("main/index.ts");
    const startWorkers = main.slice(main.indexOf("function startWorkers(): void {"));
    const loaded = startWorkers.indexOf("loadSavedTrackingPolicy(");
    expect(loaded).toBeGreaterThan(-1);
    expect(loaded).toBeLessThan(startWorkers.indexOf("heartbeatWorker.start()"));
    expect(startWorkers.indexOf("screenshotWorker.applyPolicy(trackingPolicy)")).toBeLessThan(
      startWorkers.indexOf("screenshotWorker.start()"),
    );
    expect(main).toContain("saveTrackingPolicy(app.getPath(\"userData\"), policy, receivedAt)");
    expect(main.match(/clearSavedTrackingPolicy\(app\.getPath\("userData"\)\)/g)).toHaveLength(2);
  });

  it("makes a failed refresh visible without nagging", () => {
    const now = new Date(2026, 8, 27, 12, 0);
    const earlier = new Date(2026, 8, 27, 9, 30).toISOString();
    expect(
      policyFreshnessCopy(
        { source: "saved", receivedAt: earlier, refreshFailedAt: now.toISOString(), refreshError: "offline" },
        now,
      ),
    ).toMatch(/^Could not refresh from the server — using the policy received at /);
    expect(
      policyFreshnessCopy({ source: "default", receivedAt: null, refreshFailedAt: now.toISOString(), refreshError: "offline" }, now),
    ).toBe("Could not reach the server yet — using the built-in defaults until it answers.");
    expect(
      policyFreshnessCopy({ source: "server", receivedAt: earlier, refreshFailedAt: null, refreshError: null }, now),
    ).toMatch(/^Updated from the server at /);

    // One log line per failing streak; Settings carries it until a refresh succeeds.
    const main = read("main/index.ts");
    expect(main).toMatch(/if \(!trackingPolicyStatus\.refreshFailedAt\) \{\s*console\.warn\(/);
    expect(read("workers/HeartbeatWorker.ts")).toContain("this.onPolicyRefreshFailed?.(");
  });
});
