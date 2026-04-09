/**
 * Screenshot capture worker.
 *
 * Captures a full-screen PNG at a random interval between 3 and 5 minutes
 * when the timer is running. Saves to a temp directory and enqueues in
 * SqliteQueue for async upload by SyncWorker.
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

const CAPTURE_MIN_MS = 3 * 60 * 1000; // 3 minutes
const CAPTURE_MAX_MS = 5 * 60 * 1000; // 5 minutes

const MAX_PNG_SIZE_BYTES = 5 * 1024 * 1024; // 5 MB hard limit

export interface ScreenshotPolicyPayload {
  screenshotsEnabled: boolean;
  captureIntervalMinMin: number;
  captureIntervalMaxMin: number;
  activeHoursEnabled: boolean;
  activeHoursStart: string; // "HH:mm"
  activeHoursEnd: string;   // "HH:mm"
}

export class ScreenCaptureWorker {
  private queue: SqliteQueue;
  private store: AgentStore;
  private timeout: ReturnType<typeof setTimeout> | null = null;
  private enabled: boolean;
  private totalCaptured = 0;
  private screenshotDir: string;
  private captureMinMs = CAPTURE_MIN_MS;
  private captureMaxMs = CAPTURE_MAX_MS;
  private activeHoursEnabled = false;
  private activeHoursStart = "08:00";
  private activeHoursEnd = "18:00";

  constructor(queue: SqliteQueue, store: AgentStore, enabled = false) {
    this.queue = queue;
    this.store = store;
    this.enabled = enabled;
    // Use app userData dir (not os.tmpdir) — survives reboots, app-private, not world-readable
    this.screenshotDir = path.join(app.getPath("userData"), "screenshots");
  }

  start(): void {
    if (!this.enabled) {
      console.log("[ScreenCaptureWorker] Disabled (screenshotsEnabled=false)");
      return;
    }
    fs.mkdirSync(this.screenshotDir, { recursive: true });
    this.scheduleNext();
    console.log(`[ScreenCaptureWorker] Started (interval 3–5 min random, dir: ${this.screenshotDir})`);
  }

  stop(): void {
    if (this.timeout) {
      clearTimeout(this.timeout);
      this.timeout = null;
    }
    console.log(`[ScreenCaptureWorker] Stopped (captured: ${this.totalCaptured})`);
  }

  /**
   * Apply a screenshot policy received from the server via heartbeat.
   * Takes effect immediately — no restart required.
   */
  applyPolicy(policy: ScreenshotPolicyPayload): void {
    const wasEnabled = this.enabled;
    this.enabled = policy.screenshotsEnabled;
    this.captureMinMs = Math.max(1, policy.captureIntervalMinMin) * 60 * 1000;
    this.captureMaxMs = Math.max(this.captureMinMs, policy.captureIntervalMaxMin * 60 * 1000);
    this.activeHoursEnabled = policy.activeHoursEnabled;
    this.activeHoursStart = policy.activeHoursStart;
    this.activeHoursEnd = policy.activeHoursEnd;
    console.log(
      `[ScreenCaptureWorker] Policy applied: enabled=${this.enabled}, ` +
      `interval=${policy.captureIntervalMinMin}–${policy.captureIntervalMaxMin}min, ` +
      `activeHours=${this.activeHoursEnabled ? `${this.activeHoursStart}–${this.activeHoursEnd}` : "off"}`
    );
    // Start if newly enabled; stop if newly disabled
    if (!wasEnabled && this.enabled) {
      this.start();
    } else if (wasEnabled && !this.enabled) {
      this.stop();
    }
  }

  /** Returns true if the current local time is within the configured active-hours window. */
  private isWithinActiveHours(): boolean {
    if (!this.activeHoursEnabled) return true;
    const now = new Date();
    const current = now.getHours() * 60 + now.getMinutes();
    const [sh, sm] = this.activeHoursStart.split(":").map(Number);
    const [eh, em] = this.activeHoursEnd.split(":").map(Number);
    return current >= sh * 60 + sm && current < eh * 60 + em;
  }

  private scheduleNext(): void {
    const delay = this.captureMinMs + Math.random() * (this.captureMaxMs - this.captureMinMs);
    this.timeout = setTimeout(() => this.captureAndEnqueue(), delay);
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
      if (!this.isWithinActiveHours()) {
        console.log(
          `[ScreenCaptureWorker] Skipping — outside active hours (${this.activeHoursStart}–${this.activeHoursEnd})`
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
      const png = await this.captureScreen();

      if (!png || png.length === 0) {
        console.warn("[ScreenCaptureWorker] Empty capture, skipping");
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
      const filename = `screenshot-${Date.now()}.png`;
      const filePath = path.join(this.screenshotDir, filename);
      await fs.promises.writeFile(filePath, png);
      console.log(`[ScreenCapture] Saved to ${filePath} (${(png.length / 1024).toFixed(0)} KB)`);

      // Enqueue for upload
      this.queue.enqueueScreenshot(filePath, {
        timeEntryId: entryId,
        capturedAt,
        deviceId: this.store.getDeviceId(),
        clientVersion: this.store.getClientVersion(),
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
}
