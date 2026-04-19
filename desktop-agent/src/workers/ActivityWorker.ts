/**
 * Activity detection worker — monitors idle state, active windows, and per-type input events.
 *
 * Input monitoring strategy (two modes):
 *
 * ① uiohook mode (preferred)
 *   Uses uiohook-napi, a native global hook library, to receive system-wide
 *   keydown / mousedown / mousemove / wheel events. This provides genuinely
 *   separate keyboard and mouse signals, matching Time Doctor behaviour.
 *
 * ② powerMonitor fallback
 *   Used when uiohook-napi is unavailable (binary not installed, macOS
 *   Accessibility permission denied, or any runtime error on start).
 *   Both keyboard and mouse metrics share the same unified OS idle signal
 *   from powerMonitor.getSystemIdleTime().
 *
 * Both modes expose the same public API: getActivityMetrics().
 *
 * Metric model (60-second sliding window, per-second granularity):
 *   keyboardActivityPercent = (seconds with ≥1 keydown) / 60 × 100
 *   mouseActivityPercent    = (seconds with ≥1 pointer event) / 60 × 100
 *   keyboardCount           = total keydown events in the window
 *   mouseCount              = total pointer events in the window
 *
 * Idle detection (powerMonitor.getSystemIdleTime) is UNCHANGED — it still
 * drives the 3-min idle_start/idle_end analytics events and the 10-min
 * auto-pause UX flow. Activity bars are intensity metrics, not idle flags.
 *
 * Phase 4.4
 */

import { powerMonitor } from "electron";
import { SqliteQueue } from "../lib/SqliteQueue";
import { AgentStore } from "../lib/AgentStore";

// ─── Timing constants ───
const IDLE_CHECK_INTERVAL_MS = 5_000;
const ACTIVE_WINDOW_INTERVAL_MS = 10_000;
const IDLE_THRESHOLD_SECONDS = 180;    // analytics: idle_start / idle_end events
const IDLE_UX_THRESHOLD_SECONDS = 600; // 10 min → auto-pause + user prompt

const ACTIVITY_WINDOW_SECONDS = 60;   // sliding window for per-screenshot metrics
const ACTIVITY_SAMPLE_MS = 1_000;     // fallback poll interval
const ACTIVITY_IDLE_THRESHOLD = 2;    // fallback: idle < 2s = active sample
const MOUSEMOVE_THROTTLE_MS = 100;    // cap mousemove callbacks to 10 Hz

// ─── uiohook-napi dynamic load ───
// Loaded once at module initialisation. A missing or incompatible binary is
// caught here so the rest of the module always loads successfully.

interface UiohookApi {
  uIOhook: {
    on(event: string, cb: (...args: unknown[]) => void): void;
    off(event: string, cb: (...args: unknown[]) => void): void;
    start(): void;
    stop(): void;
  };
}

let uiohookMod: UiohookApi | null = null;
try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  uiohookMod = require("uiohook-napi") as UiohookApi;
  console.log("[ActivityWorker] uiohook-napi loaded — true keyboard/mouse tracking available");
} catch {
  console.warn(
    "[ActivityWorker] uiohook-napi not available — will use powerMonitor fallback for activity metrics"
  );
}

// ─── Public types ───

export interface ActivityMetrics {
  /** 0–100: fraction of the last 60 s with ≥1 keydown per second (uiohook mode)
   *         or any OS input per second (fallback). */
  keyboardActivityPercent: number;
  /** 0–100: fraction of the last 60 s with ≥1 pointer event per second (uiohook mode)
   *         or any OS input per second (fallback). */
  mouseActivityPercent: number;
  /** Total keydown events in the last 60 s, or null in fallback mode. */
  keyboardCount: number | null;
  /** Total pointer events (mousedown + mousemove + wheel) in the last 60 s,
   *  or null in fallback mode. */
  mouseCount: number | null;
  /** true = uiohook mode (separate signals), false = powerMonitor fallback (unified signal) */
  uiohookActive: boolean;
}

// ─── Worker ───

export class ActivityWorker {
  private queue: SqliteQueue;
  private store: AgentStore;

  // ─── Timers ───
  private idleInterval: ReturnType<typeof setInterval> | null = null;
  private windowInterval: ReturnType<typeof setInterval> | null = null;
  private sampleInterval: ReturnType<typeof setInterval> | null = null;

  // ─── Idle detection state ───
  private wasIdle = false;
  private idleUxTriggered = false;
  private lastWindowInfo: string | null = null;
  private suspendHandler: (() => void) | null = null;
  private resumeHandler: (() => void) | null = null;
  private onIdleUxCb: ((idleSeconds: number) => void) | null = null;

  // ─── Idle UX policy (admin-configurable, updated via applyIdlePolicy()) ───
  private idleUxEnabled = true;
  private idleUxThresholdSeconds = IDLE_UX_THRESHOLD_SECONDS;

  // ─── uiohook mode: per-second circular buffers ───
  /** 60-slot ring buffer. Slot = 1 if ≥1 keydown event occurred in that second, else 0. */
  private kbBuffer = new Uint8Array(ACTIVITY_WINDOW_SECONDS);
  /** 60-slot ring buffer. Slot = 1 if ≥1 pointer event occurred in that second, else 0. */
  private msBuffer = new Uint8Array(ACTIVITY_WINDOW_SECONDS);
  /** The calendar second (Math.floor(Date.now()/1000)) most recently written to the buffers. */
  private lastBufferSecond = Math.floor(Date.now() / 1000);

  /** Rolling timestamp lists for raw event counts (bounded, pruned on read). */
  private kbTimes: number[] = [];
  private msTimes: number[] = [];
  private lastMouseMoveMs = 0;

  // ─── Fallback mode: unified powerMonitor sliding window ───
  private activitySamples = new Array<number>(ACTIVITY_WINDOW_SECONDS).fill(0);
  private activitySamplePtr = 0;

  // ─── Mode flag ───
  private _uiohookActive = false;

  // ─── uiohook handler references (needed for .off()) ───
  private kbDownHandler: ((...args: unknown[]) => void) | null = null;
  private mouseDownHandler: ((...args: unknown[]) => void) | null = null;
  private mouseMoveHandler: ((...args: unknown[]) => void) | null = null;
  private wheelHandler: ((...args: unknown[]) => void) | null = null;

  constructor(queue: SqliteQueue, store: AgentStore) {
    this.queue = queue;
    this.store = store;
  }

  /** Register callback fired when idle crosses the UX threshold. */
  setIdleUxCallback(cb: (idleSeconds: number) => void): void {
    this.onIdleUxCb = cb;
  }

  /**
   * Apply admin-managed idle prompt policy.
   * Called by HeartbeatWorker on every heartbeat response.
   * Takes effect on the next idle-check cycle (≤ 5 s).
   *
   * Test override: set DOCUFLOW_TEST_IDLE_TIMEOUT_MINUTES in the environment to
   * bypass the production floor of 3 minutes (minimum 1 minute accepted).
   * This env var is only honoured in the desktop agent process and has no effect
   * on server-side validation or the admin UI. Never set it in production.
   */
  applyIdlePolicy(enabled: boolean, timeoutMinutes: number): void {
    this.idleUxEnabled = enabled;

    const testOverride = process.env.DOCUFLOW_TEST_IDLE_TIMEOUT_MINUTES;
    const effectiveMinutes = testOverride
      ? Math.max(1, parseInt(testOverride, 10) || 1)
      : Math.max(3, Math.min(60, timeoutMinutes));

    this.idleUxThresholdSeconds = effectiveMinutes * 60;
    console.log(
      `[ActivityWorker] Idle policy updated: enabled=${enabled}, timeout=${effectiveMinutes}min` +
      (testOverride ? ` [TEST OVERRIDE — DOCUFLOW_TEST_IDLE_TIMEOUT_MINUTES=${testOverride}]` : "") +
      ` (${this.idleUxThresholdSeconds}s)`
    );
  }

  start(): void {
    if (this.idleInterval) return;

    // Apply test override immediately — do NOT wait for the first heartbeat response.
    // The heartbeat fires 2 s after start but can fail (server down, auth error).
    // Without this, the override is never applied if the heartbeat never succeeds.
    const testOverride = process.env.DOCUFLOW_TEST_IDLE_TIMEOUT_MINUTES;
    if (testOverride) {
      const mins = Math.max(1, parseInt(testOverride, 10) || 1);
      this.idleUxThresholdSeconds = mins * 60;
      console.log(
        `[ActivityWorker] Started — TEST OVERRIDE: idle=${mins}min (${this.idleUxThresholdSeconds}s)` +
        ` [DOCUFLOW_TEST_IDLE_TIMEOUT_MINUTES=${testOverride}]`
      );
    }

    // Idle detection (drives analytics events + auto-pause — unchanged)
    this.idleInterval = setInterval(() => this.checkIdle(), IDLE_CHECK_INTERVAL_MS);

    // Active window detection
    this.windowInterval = setInterval(() => this.captureActiveWindow(), ACTIVE_WINDOW_INTERVAL_MS);

    // System suspend/resume
    this.suspendHandler = () => {
      console.log("[ActivityWorker] System suspended");
      this.queue.enqueue("idle_start", new Date(), { reason: "system_suspend" });
    };
    this.resumeHandler = () => {
      console.log("[ActivityWorker] System resumed");
      this.queue.enqueue("idle_end", new Date(), { reason: "system_resume" });
    };
    powerMonitor.on("suspend", this.suspendHandler);
    powerMonitor.on("resume", this.resumeHandler);

    // Input tracking
    if (uiohookMod) {
      this.startUiohook();
    }
    if (!this._uiohookActive) {
      // Either uiohookMod is null or start() threw — use powerMonitor sampling
      this.sampleInterval = setInterval(() => this.sampleActivity(), ACTIVITY_SAMPLE_MS);
    }

    const mode = this._uiohookActive ? "uiohook (keyboard+mouse separated)" : "powerMonitor fallback (unified)";
    console.log(`[ActivityWorker] Started — idle: 5s, window: 10s, activity: ${mode}`);
  }

  private startUiohook(): void {
    if (!uiohookMod) return;
    try {
      this.kbDownHandler = () => {
        const now = Date.now();
        this.markKbSecond(now);
        this.kbTimes.push(now);
        if (this.kbTimes.length > 10_000) this.kbTimes.splice(0, 5_000);
      };

      this.mouseDownHandler = () => {
        const now = Date.now();
        this.markMsSecond(now);
        this.msTimes.push(now);
        if (this.msTimes.length > 10_000) this.msTimes.splice(0, 5_000);
      };

      // Throttle mousemove to 10 Hz — the event fires hundreds of times per second
      this.mouseMoveHandler = () => {
        const now = Date.now();
        if (now - this.lastMouseMoveMs < MOUSEMOVE_THROTTLE_MS) return;
        this.lastMouseMoveMs = now;
        this.markMsSecond(now);
        this.msTimes.push(now);
        if (this.msTimes.length > 10_000) this.msTimes.splice(0, 5_000);
      };

      this.wheelHandler = () => {
        const now = Date.now();
        this.markMsSecond(now);
        this.msTimes.push(now);
        if (this.msTimes.length > 10_000) this.msTimes.splice(0, 5_000);
      };

      uiohookMod.uIOhook.on("keydown", this.kbDownHandler);
      uiohookMod.uIOhook.on("mousedown", this.mouseDownHandler);
      uiohookMod.uIOhook.on("mousemove", this.mouseMoveHandler);
      uiohookMod.uIOhook.on("wheel", this.wheelHandler);
      uiohookMod.uIOhook.start();

      this._uiohookActive = true;
      console.log("[ActivityWorker] uiohook running — keyboard and mouse tracked separately");
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(`[ActivityWorker] uiohook.start() failed (${msg}) — falling back to powerMonitor`);
      this._uiohookActive = false;
      // Clean up any handlers that were registered before the error
      this.removeUiohookListeners();
    }
  }

  stop(): void {
    if (this.idleInterval) { clearInterval(this.idleInterval); this.idleInterval = null; }
    if (this.sampleInterval) { clearInterval(this.sampleInterval); this.sampleInterval = null; }
    if (this.windowInterval) { clearInterval(this.windowInterval); this.windowInterval = null; }

    if (this.suspendHandler) { powerMonitor.removeListener("suspend", this.suspendHandler); this.suspendHandler = null; }
    if (this.resumeHandler) { powerMonitor.removeListener("resume", this.resumeHandler); this.resumeHandler = null; }

    if (uiohookMod && this._uiohookActive) {
      try {
        this.removeUiohookListeners();
        uiohookMod.uIOhook.stop();
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        console.warn(`[ActivityWorker] uiohook.stop() error: ${msg}`);
      }
      this._uiohookActive = false;
    }

    console.log("[ActivityWorker] Stopped");
  }

  private removeUiohookListeners(): void {
    if (!uiohookMod) return;
    if (this.kbDownHandler) { uiohookMod.uIOhook.off("keydown", this.kbDownHandler); this.kbDownHandler = null; }
    if (this.mouseDownHandler) { uiohookMod.uIOhook.off("mousedown", this.mouseDownHandler); this.mouseDownHandler = null; }
    if (this.mouseMoveHandler) { uiohookMod.uIOhook.off("mousemove", this.mouseMoveHandler); this.mouseMoveHandler = null; }
    if (this.wheelHandler) { uiohookMod.uIOhook.off("wheel", this.wheelHandler); this.wheelHandler = null; }
  }

  // ─── uiohook mode: circular buffer helpers ───

  private markKbSecond(nowMs: number): void {
    const sec = Math.floor(nowMs / 1000);
    this.advanceBuffers(sec);
    this.kbBuffer[sec % ACTIVITY_WINDOW_SECONDS] = 1;
  }

  private markMsSecond(nowMs: number): void {
    const sec = Math.floor(nowMs / 1000);
    this.advanceBuffers(sec);
    this.msBuffer[sec % ACTIVITY_WINDOW_SECONDS] = 1;
  }

  /** Zero out buffer slots for elapsed seconds and advance the watermark. */
  private advanceBuffers(newSec: number): void {
    const gap = newSec - this.lastBufferSecond;
    if (gap <= 0) return;
    const clearCount = Math.min(gap, ACTIVITY_WINDOW_SECONDS);
    for (let i = 1; i <= clearCount; i++) {
      const slot = (this.lastBufferSecond + i) % ACTIVITY_WINDOW_SECONDS;
      this.kbBuffer[slot] = 0;
      this.msBuffer[slot] = 0;
    }
    this.lastBufferSecond = newSec;
  }

  // ─── Fallback mode: powerMonitor sampling ───

  private sampleActivity(): void {
    const idleSeconds = powerMonitor.getSystemIdleTime();
    this.activitySamples[this.activitySamplePtr] = idleSeconds < ACTIVITY_IDLE_THRESHOLD ? 1 : 0;
    this.activitySamplePtr = (this.activitySamplePtr + 1) % ACTIVITY_WINDOW_SECONDS;
  }

  // ─── Public API ───

  /**
   * Returns per-screenshot activity metrics for the last 60 seconds.
   * Called by ScreenCaptureWorker at the moment a screenshot is taken.
   */
  getActivityMetrics(): ActivityMetrics {
    if (this._uiohookActive) {
      const now = Date.now();
      const sec = Math.floor(now / 1000);
      // Advance the buffer to the current second so idle seconds are zeroed
      this.advanceBuffers(sec);

      const kbPercent = Math.round(
        (this.kbBuffer.reduce((s, v) => s + v, 0) / ACTIVITY_WINDOW_SECONDS) * 100
      );
      const msPercent = Math.round(
        (this.msBuffer.reduce((s, v) => s + v, 0) / ACTIVITY_WINDOW_SECONDS) * 100
      );

      const cutoff = now - ACTIVITY_WINDOW_SECONDS * 1000;
      const kbCount = this.kbTimes.filter(t => t >= cutoff).length;
      const msCount = this.msTimes.filter(t => t >= cutoff).length;

      return {
        keyboardActivityPercent: kbPercent,
        mouseActivityPercent: msPercent,
        keyboardCount: kbCount,
        mouseCount: msCount,
        uiohookActive: true,
      };
    }

    // Fallback: unified powerMonitor signal for both metrics
    const active = this.activitySamples.reduce((s, v) => s + v, 0);
    const pct = Math.round((active / ACTIVITY_WINDOW_SECONDS) * 100);
    return {
      keyboardActivityPercent: pct,
      mouseActivityPercent: pct,
      keyboardCount: null,
      mouseCount: null,
      uiohookActive: false,
    };
  }

  // ─── Idle detection (unchanged — drives auto-pause and analytics) ───

  private checkIdle(): void {
    const idleSeconds = powerMonitor.getSystemIdleTime();
    const timerStatus = this.store.getTimerStatus();

    // Diagnostic log every 5 s — shows all four conditions at once.
    if (process.env.DOCUFLOW_TEST_IDLE_TIMEOUT_MINUTES) {
      console.log(
        `[ActivityWorker][TEST] idle=${idleSeconds}s threshold=${this.idleUxThresholdSeconds}s` +
        ` enabled=${this.idleUxEnabled} triggered=${this.idleUxTriggered} timer=${timerStatus}`
      );
    }

    // Analytics idle events (3-min threshold — unchanged)
    if (idleSeconds >= IDLE_THRESHOLD_SECONDS && !this.wasIdle) {
      this.wasIdle = true;
      this.queue.enqueue("idle_start", new Date(), { idleSeconds });
      console.log(`[ActivityWorker] Idle started (${idleSeconds}s)`);
    } else if (idleSeconds < IDLE_THRESHOLD_SECONDS && this.wasIdle) {
      this.wasIdle = false;
      this.queue.enqueue("idle_end", new Date(), { idleSeconds });
      console.log(`[ActivityWorker] Idle ended (${idleSeconds}s)`);
    }

    // Reset UX trigger flag independently of the analytics wasIdle flag.
    // Previously this was gated on wasIdle (3-min threshold), which meant the UX
    // threshold flag could never reset in test mode (1-min override) because
    // wasIdle never flipped true within the same test window. Now it resets as
    // soon as idle drops back below the UX threshold, regardless of wasIdle state.
    if (idleSeconds < this.idleUxThresholdSeconds && this.idleUxTriggered) {
      this.idleUxTriggered = false;
      console.log(`[ActivityWorker] idleUxTriggered reset (idle=${idleSeconds}s < threshold=${this.idleUxThresholdSeconds}s)`);
    }

    if (
      this.idleUxEnabled &&
      idleSeconds >= this.idleUxThresholdSeconds &&
      !this.idleUxTriggered &&
      timerStatus === "running"
    ) {
      this.idleUxTriggered = true;
      console.log(`[ActivityWorker] Idle UX threshold reached (${idleSeconds}s ≥ ${this.idleUxThresholdSeconds}s) — firing callback`);
      this.onIdleUxCb?.(idleSeconds);
    } else if (
      this.idleUxEnabled &&
      idleSeconds >= this.idleUxThresholdSeconds &&
      !this.idleUxTriggered &&
      timerStatus !== "running" &&
      process.env.DOCUFLOW_TEST_IDLE_TIMEOUT_MINUTES
    ) {
      console.log(`[ActivityWorker][TEST] BLOCKED — threshold met (idle=${idleSeconds}s) but timer="${timerStatus}" (need "running")`);
    }
  }

  private captureActiveWindow(): void {
    if (this.store.getTimerStatus() !== "running") return;

    const windowInfo = `${process.platform}-desktop`;
    if (windowInfo !== this.lastWindowInfo) {
      this.lastWindowInfo = windowInfo;
      this.queue.enqueue("active_window", new Date(), {
        appName: "DocuFlow Agent",
        windowTitle: `Desktop - ${process.platform}`,
        platform: process.platform,
      });
    } else {
      this.queue.enqueue("input_activity", new Date(), {
        source: "periodic",
        platform: process.platform,
      });
    }
  }
}
