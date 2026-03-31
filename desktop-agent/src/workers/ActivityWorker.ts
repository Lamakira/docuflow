/**
 * Activity detection worker — monitors idle state and active windows.
 *
 * - Idle detection via Electron powerMonitor.getSystemIdleTime()
 * - System suspend/resume events
 * - Active window detection via [PLACEHOLDER] cross-platform lib
 *   For MVP: emits simulated "active_window" events using process info
 * - All events queued in SqliteQueue for async batch sync
 *
 * Phase 3 MVP
 */

import { powerMonitor } from "electron";
import { SqliteQueue } from "../lib/SqliteQueue";
import { AgentStore } from "../lib/AgentStore";

const IDLE_CHECK_INTERVAL_MS = 5_000;
const ACTIVE_WINDOW_INTERVAL_MS = 10_000;
const IDLE_THRESHOLD_SECONDS = 180;    // analytics events (idle_start / idle_end)
const IDLE_UX_THRESHOLD_SECONDS = 600; // 10 min → auto-pause + user prompt

export class ActivityWorker {
  private queue: SqliteQueue;
  private store: AgentStore;
  private idleInterval: ReturnType<typeof setInterval> | null = null;
  private windowInterval: ReturnType<typeof setInterval> | null = null;
  private wasIdle = false;
  private idleUxTriggered = false; // true once UX prompt has fired for this idle stretch
  private lastWindowInfo: string | null = null;
  private suspendHandler: (() => void) | null = null;
  private resumeHandler: (() => void) | null = null;
  private onIdleUxCb: ((idleSeconds: number) => void) | null = null;

  constructor(queue: SqliteQueue, store: AgentStore) {
    this.queue = queue;
    this.store = store;
  }

  /** Register callback fired when idle crosses the UX threshold (10 min). */
  setIdleUxCallback(cb: (idleSeconds: number) => void): void {
    this.onIdleUxCb = cb;
  }

  start(): void {
    if (this.idleInterval) return;

    // Idle detection
    this.idleInterval = setInterval(() => this.checkIdle(), IDLE_CHECK_INTERVAL_MS);

    // Active window detection (every 10s)
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

    console.log("[ActivityWorker] Started (idle: 5s, window: 10s)");
  }

  stop(): void {
    if (this.idleInterval) {
      clearInterval(this.idleInterval);
      this.idleInterval = null;
    }
    if (this.windowInterval) {
      clearInterval(this.windowInterval);
      this.windowInterval = null;
    }
    if (this.suspendHandler) {
      powerMonitor.removeListener("suspend", this.suspendHandler);
      this.suspendHandler = null;
    }
    if (this.resumeHandler) {
      powerMonitor.removeListener("resume", this.resumeHandler);
      this.resumeHandler = null;
    }
    console.log("[ActivityWorker] Stopped");
  }

  private checkIdle(): void {
    const idleSeconds = powerMonitor.getSystemIdleTime();

    // Analytics threshold (3 min)
    if (idleSeconds >= IDLE_THRESHOLD_SECONDS && !this.wasIdle) {
      this.wasIdle = true;
      this.queue.enqueue("idle_start", new Date(), { idleSeconds });
      console.log(`[ActivityWorker] Idle started (${idleSeconds}s)`);
    } else if (idleSeconds < IDLE_THRESHOLD_SECONDS && this.wasIdle) {
      this.wasIdle = false;
      this.idleUxTriggered = false; // reset so next idle stretch can fire again
      this.queue.enqueue("idle_end", new Date(), { idleSeconds });
      console.log(`[ActivityWorker] Idle ended (${idleSeconds}s)`);
    }

    // UX threshold (10 min) — fire once per idle stretch, only when timer is running
    if (
      idleSeconds >= IDLE_UX_THRESHOLD_SECONDS &&
      !this.idleUxTriggered &&
      this.store.getTimerStatus() === "running"
    ) {
      this.idleUxTriggered = true;
      console.log(`[ActivityWorker] Idle UX threshold reached (${idleSeconds}s) — notifying main`);
      this.onIdleUxCb?.(idleSeconds);
    }
  }

  private captureActiveWindow(): void {
    // Only capture when timer is running
    if (this.store.getTimerStatus() !== "running") return;

    // [PLACEHOLDER]: Cross-platform active window detection
    // In production, use a native module like:
    //   - @aspect-build/active-win (macOS/Windows/Linux)
    //   - node-active-window
    //   - Custom native addon
    //
    // For MVP demo, emit a placeholder event with process platform info.
    // This demonstrates the pipeline works end-to-end.

    const windowInfo = `${process.platform}-desktop`;
    if (windowInfo !== this.lastWindowInfo) {
      this.lastWindowInfo = windowInfo;
      this.queue.enqueue("active_window", new Date(), {
        appName: "DocuFlow Agent",
        windowTitle: `Desktop - ${process.platform}`,
        platform: process.platform,
      });
    } else {
      // Still emit periodic activity event even if same window
      this.queue.enqueue("input_activity", new Date(), {
        source: "periodic",
        platform: process.platform,
      });
    }
  }
}
