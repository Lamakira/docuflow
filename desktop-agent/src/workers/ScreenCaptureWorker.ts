/**
 * Screenshot capture worker.
 *
 * Captures a full-screen PNG at a random moment between the Tracking Policy's
 * min and max interval when the timer is running. Saves to a temp directory
 * and enqueues in SqliteQueue for async upload by SyncWorker.
 *
 * Platform: Windows primary (Phase 4.3 MVP).
 *           macOS/Linux: same code path — desktopCapturer is cross-platform.
 *
 * Feature flag: disabled unless SCREENSHOTS_ENABLED=true or set via AgentStore.
 *
 * Phase 4.3
 */

import { app, desktopCapturer, nativeImage } from "electron";
import fs from "fs";
import path from "path";
import os from "os";
import { execSync } from "child_process";
import { SqliteQueue } from "../lib/SqliteQueue";
import { AgentStore } from "../lib/AgentStore";
import type { ActivityWorker, ActivityMetrics } from "./ActivityWorker";
import { isWaylandSession, shouldSkipWaylandCaptures, getTestCaptureIntervalSeconds } from "../lib/platform";
import { CaptureScheduler, captureIntervalFromPolicy } from "../lib/captureSchedule";
import {
  DEFAULT_TRACKING_POLICY,
  clockMinutes,
  isWithinActiveHours,
  type TrackingPolicy,
} from "../lib/trackingPolicy";

const MAX_PNG_SIZE_BYTES = 5 * 1024 * 1024; // 5 MB hard limit

/** The Tracking Policy a heartbeat carries. */
export type ScreenshotPolicyPayload = TrackingPolicy;

type ActiveHours = Pick<TrackingPolicy, "activeHoursEnabled" | "activeHoursStart" | "activeHoursEnd">;

/** Optional hooks for Wayland portal capture — pause timer during consent dialog. */
export interface CaptureLifecycleHooks {
  /** Called immediately before desktopCapturer opens the XDG portal dialog. */
  onBeforePortalDialog?: () => void;
  /** Called after capture attempt; resume only when granted is true. */
  onAfterPortalDialog?: (granted: boolean) => void;
}

export class ScreenCaptureWorker {
  private queue: SqliteQueue;
  private store: AgentStore;
  private scheduler: CaptureScheduler;
  private enabled: boolean;
  private totalCaptured = 0;
  private screenshotDir: string;
  private activeHours: ActiveHours = {
    activeHoursEnabled: DEFAULT_TRACKING_POLICY.activeHoursEnabled,
    activeHoursStart: DEFAULT_TRACKING_POLICY.activeHoursStart,
    activeHoursEnd: DEFAULT_TRACKING_POLICY.activeHoursEnd,
  };
  private activityWorker: ActivityWorker | null = null;
  private captureHooks: CaptureLifecycleHooks = {};

  constructor(queue: SqliteQueue, store: AgentStore, enabled = false) {
    this.queue = queue;
    this.store = store;
    this.enabled = enabled;
    // Use app userData dir (not os.tmpdir) — survives reboots, app-private, not world-readable
    this.screenshotDir = path.join(app.getPath("userData"), "screenshots");
    const testIntervalSec = getTestCaptureIntervalSeconds();
    this.scheduler = new CaptureScheduler(
      () => void this.captureAndEnqueue(),
      testIntervalSec
        ? { minMs: testIntervalSec * 1000, maxMs: testIntervalSec * 1000 }
        : captureIntervalFromPolicy(DEFAULT_TRACKING_POLICY),
    );
  }

  /** Wire the ActivityWorker so captures include real activity metrics. */
  setActivityWorker(w: ActivityWorker): void {
    this.activityWorker = w;
  }

  /** Pause/resume timer around Wayland XDG portal screen-picker dialogs. */
  setCaptureLifecycleHooks(hooks: CaptureLifecycleHooks): void {
    this.captureHooks = hooks;
  }

  start(): void {
    if (!this.enabled) {
      console.log("[ScreenCaptureWorker] Disabled (screenshotsEnabled=false)");
      return;
    }
    if (this.scheduler.pending) return;

    const testIntervalSec = getTestCaptureIntervalSeconds();
    if (testIntervalSec) {
      console.log(`[ScreenCaptureWorker] TEST capture interval: ${testIntervalSec}s`);
    }

    if (shouldSkipWaylandCaptures()) {
      console.log(
        "[ScreenCaptureWorker] Disabled — Wayland captures opted out " +
        "(unset DOCUFLOW_SKIP_WAYLAND_CAPTURES to enable)."
      );
      return;
    }
    if (isWaylandSession()) {
      console.log("[ScreenCaptureWorker] Wayland — timer pauses during portal consent dialog");
    }
    fs.mkdirSync(this.screenshotDir, { recursive: true });
    this.scheduleNext();
    const { minMs, maxMs } = this.scheduler.current;
    console.log(
      `[ScreenCaptureWorker] Started (interval ${minMs / 60_000}–${maxMs / 60_000} min random, dir: ${this.screenshotDir})`
    );
  }

  stop(): void {
    this.scheduler.cancel();
    console.log(`[ScreenCaptureWorker] Stopped (captured: ${this.totalCaptured})`);
  }

  /**
   * Apply a Tracking Policy (saved at startup, then from every heartbeat).
   * Takes effect immediately: a changed interval re-draws the waiting capture,
   * and turning capture off or on stops or starts it.
   */
  applyPolicy(policy: ScreenshotPolicyPayload): void {
    const wasEnabled = this.enabled;
    this.enabled = policy.screenshotsEnabled;
    this.activeHours = {
      activeHoursEnabled: policy.activeHoursEnabled,
      activeHoursStart: policy.activeHoursStart,
      activeHoursEnd: policy.activeHoursEnd,
    };
    const rescheduled = getTestCaptureIntervalSeconds()
      ? false
      : this.scheduler.setInterval(captureIntervalFromPolicy(policy));
    const hours = policy.activeHoursEnabled ? `${policy.activeHoursStart}–${policy.activeHoursEnd}` : "off";
    console.log(
      `[ScreenCaptureWorker] Policy applied: enabled=${this.enabled}, ` +
      `interval=${policy.captureIntervalMinMin}–${policy.captureIntervalMaxMin}min` +
      `${rescheduled ? " (pending capture rescheduled)" : ""}, activeHours=${hours}`
    );
    if (
      policy.activeHoursEnabled &&
      (clockMinutes(policy.activeHoursStart) === null || clockMinutes(policy.activeHoursEnd) === null)
    ) {
      console.warn(`[ScreenCaptureWorker] Active hours ${hours} are not HH:mm — not restricting captures`);
    }
    // Start if newly enabled; stop if newly disabled.
    // On Wayland, start() is a no-op (logs warning, returns early) so
    // the policy enable flag is preserved but no timer is scheduled.
    if (!wasEnabled && this.enabled) {
      this.start();
    } else if (wasEnabled && !this.enabled) {
      this.stop();
    }
  }

  private scheduleNext(): void {
    if (!this.enabled) return;
    this.scheduler.scheduleNext();
  }

  private async captureAndEnqueue(): Promise<void> {
    try {
      // Only capture when timer is actively running
      if (this.store.getTimerStatus() !== "running") {
        console.log("[ScreenCaptureWorker] Skipping — timer not running");
        this.scheduleNext();
        return;
      }

      // Respect active-hours window
      if (!isWithinActiveHours(this.activeHours, new Date())) {
        console.log(
          `[ScreenCaptureWorker] Skipping — outside active hours (${this.activeHours.activeHoursStart}–${this.activeHours.activeHoursEnd})`
        );
        this.scheduleNext();
        return;
      }

      const entryId = this.store.getActiveEntryId();
      if (!entryId) {
        this.scheduleNext();
        return;
      }

      const capturedAt = new Date().toISOString();
      // Snapshot activity metrics for the last 60 seconds before this screenshot.
      const metrics: ActivityMetrics | null = this.activityWorker?.getActivityMetrics() ?? null;

      const needsPortalPause = isWaylandSession() && !shouldSkipWaylandCaptures();
      if (needsPortalPause) {
        this.captureHooks.onBeforePortalDialog?.();
      }

      let png: Buffer | null = null;
      let portalGranted = false;
      try {
        png = await this.captureScreen();
        portalGranted = !!(png && png.length > 0);
      } finally {
        if (needsPortalPause) {
          this.captureHooks.onAfterPortalDialog?.(portalGranted);
        }
      }

      if (needsPortalPause && !portalGranted) {
        console.warn(
          "[ScreenCaptureWorker] Portal consent not granted — timer stays paused until you accept or resume manually"
        );
        this.scheduleNext();
        return;
      }
      if (!portalGranted) {
        console.warn("[ScreenCaptureWorker] Empty capture, skipping");
        this.scheduleNext();
        return;
      }

      if (!png) {
        this.scheduleNext();
        return;
      }

      if (png.length > MAX_PNG_SIZE_BYTES) {
        console.warn(
          `[ScreenCaptureWorker] Screenshot too large (${(png.length / 1024 / 1024).toFixed(1)}MB > 5MB), skipping`
        );
        this.scheduleNext();
        return;
      }

      console.log("[ScreenCaptureWorker] screenshot.capture");

      // Save to local file (userData dir — app-private, persists across reboots)
      const tsMs = Date.now();
      const filename = `screenshot-${tsMs}.png`;
      const filePath = path.join(this.screenshotDir, filename);
      await fs.promises.writeFile(filePath, png);
      console.log(`[ScreenCapture] Saved to ${filePath} (${(png.length / 1024).toFixed(0)} KB)`);

      // Sidecar JSON: project context so the Screenshots page can show which project was active
      try {
        const sidecarPath = path.join(this.screenshotDir, `screenshot-${tsMs}.json`);
        const sidecar = {
          projectName: this.store.getActiveProjectName() ?? null,
          taskName: this.store.getActiveTaskName() ?? null,
          capturedAt,
          timeEntryId: entryId,
        };
        await fs.promises.writeFile(sidecarPath, JSON.stringify(sidecar), "utf-8");
      } catch { /* non-fatal — screenshot still saved */ }

      // Enqueue for upload — activity metrics attached for Screencasts UI
      this.queue.enqueueScreenshot(filePath, {
        timeEntryId: entryId,
        capturedAt,
        deviceId: this.store.getDeviceId(),
        clientVersion: this.store.getClientVersion(),
        keyboardActivityPercent: metrics?.keyboardActivityPercent ?? null,
        mouseActivityPercent: metrics?.mouseActivityPercent ?? null,
        keyboardCount: metrics?.keyboardCount ?? null,
        mouseCount: metrics?.mouseCount ?? null,
      });
      this.totalCaptured++;
      console.log(`[ScreenCapture] Enqueued upload (total: ${this.totalCaptured})`);
    } catch (error: any) {
      console.error("[ScreenCaptureWorker] Capture failed:", error.message);
    }

    this.scheduleNext();
  }

  /**
   * Capture the primary screen.
   * Tries Electron desktopCapturer first; falls back to PowerShell (Win32 GDI)
   * on Windows when the thumbnail is empty (GPU/driver issue on some machines).
   */
  private async captureScreen(): Promise<Buffer | null> {
    const sources = await desktopCapturer.getSources({
      types: ["screen"],
      thumbnailSize: { width: 1920, height: 1080 },
    });

    if (!sources || sources.length === 0) {
      console.warn("[ScreenCaptureWorker] No screen sources available");
      return null;
    }

    const img = sources[0].thumbnail;

    if (!img.isEmpty()) {
      return img.toPNG();
    }

    // Fallback: Win32 GDI via PowerShell (bypasses Electron GPU sandbox issues)
    if (process.platform === "win32") {
      console.warn("[ScreenCaptureWorker] Thumbnail empty — trying PowerShell fallback");
      return this.captureScreenWindows();
    }

    console.warn("[ScreenCaptureWorker] Thumbnail is empty — check screen capture permissions");
    return null;
  }

  /**
   * Windows fallback: capture primary screen via PowerShell + System.Drawing (Win32 GDI).
   * Works on machines where Electron's desktopCapturer returns an empty thumbnail
   * due to GPU driver or display scaling issues.
   */
  private captureScreenWindows(): Buffer | null {
    const tmpFile = path.join(os.tmpdir(), `docuflow-sc-${Date.now()}.png`);
    const ps = [
      "Add-Type -AssemblyName System.Windows.Forms",
      "Add-Type -AssemblyName System.Drawing",
      "$s = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds",
      "$bmp = New-Object System.Drawing.Bitmap($s.Width, $s.Height)",
      "$g = [System.Drawing.Graphics]::FromImage($bmp)",
      "$g.CopyFromScreen($s.Location, [System.Drawing.Point]::Empty, $s.Size)",
      `$bmp.Save('${tmpFile.replace(/\\/g, "\\\\")}')`,
      "$g.Dispose()",
      "$bmp.Dispose()",
    ].join("; ");

    try {
      execSync(`powershell -NoProfile -NonInteractive -Command "${ps}"`, {
        timeout: 10_000,
        windowsHide: true,
      });
      const buf = fs.readFileSync(tmpFile);
      fs.unlinkSync(tmpFile);
      console.log(`[ScreenCaptureWorker] PowerShell fallback succeeded (${(buf.length / 1024).toFixed(0)} KB)`);
      return buf;
    } catch (err: any) {
      console.error("[ScreenCaptureWorker] PowerShell fallback failed:", err.message);
      try { fs.unlinkSync(tmpFile); } catch {}
      return null;
    }
  }

  /**
   * Delete screenshot files (PNG + sidecar JSON) older than `maxAgeDays` days.
   * Called once at agent startup to keep the screenshots directory bounded.
   */
  async pruneOldScreenshots(maxAgeDays = 30): Promise<void> {
    try {
      if (!fs.existsSync(this.screenshotDir)) return;
      const files = await fs.promises.readdir(this.screenshotDir);
      const cutoffMs = Date.now() - maxAgeDays * 24 * 60 * 60 * 1000;
      let pruned = 0;
      for (const file of files) {
        const filePath = path.join(this.screenshotDir, file);
        try {
          const stat = await fs.promises.stat(filePath);
          if (stat.mtimeMs < cutoffMs) {
            await fs.promises.unlink(filePath);
            pruned++;
          }
        } catch { /* ignore per-file errors */ }
      }
      if (pruned > 0) {
        console.log(`[ScreenCaptureWorker] Pruned ${pruned} screenshot file(s) older than ${maxAgeDays} days`);
      }
    } catch (err: any) {
      console.warn("[ScreenCaptureWorker] pruneOldScreenshots failed:", err.message);
    }
  }
}
