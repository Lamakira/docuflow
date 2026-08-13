/**
 * ScreenCaptureWebService — Isolated screen capture service for the web client.
 *
 * Handles: getDisplayMedia stream lifecycle, periodic capture, upload to GCS
 * via signed URLs, and cleanup of media tracks/timers.
 *
 * Replaces inline capture logic previously in TimeTrackerContext.tsx.
 *
 * Phase 1 Sprint B.2
 */

import { apiRequest } from "@/lib/queryClient";

export interface ScreenCaptureCallbacks {
  /** Called when capture state changes */
  onStateChange: (state: ScreenCaptureState) => void;
  /** Called when an error occurs (displayed to user) */
  onError: (message: string) => void;
  /** Called when error clears (e.g. after successful capture) */
  onErrorClear: () => void;
}

export interface ScreenCaptureState {
  isCapturing: boolean;
}

// Backoff schedule: 30s, 60s, 120s, 240s, 480s (then stays at 480s)
const BACKOFF_BASE_MS = 30_000;
const BACKOFF_MAX_MS = 480_000;
const MAX_CONSECUTIVE_FAILURES = 8; // More generous than the old hard-stop at 5

export class ScreenCaptureWebService {
  private stream: MediaStream | null = null;
  private video: HTMLVideoElement | null = null;
  private captureTimer: ReturnType<typeof setTimeout> | null = null;
  private consecutiveFailures = 0;
  private isCapturing = false;
  private destroyed = false;
  private callbacks: ScreenCaptureCallbacks;

  constructor(callbacks: ScreenCaptureCallbacks) {
    this.callbacks = callbacks;
  }

  get capturing(): boolean {
    return this.isCapturing;
  }

  // ─── Start / Stop ───

  async start(): Promise<void> {
    if (this.stream || this.destroyed) return;
    this.consecutiveFailures = 0;
    this.callbacks.onErrorClear();

    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: { width: { ideal: 1280 }, height: { ideal: 720 } },
        audio: false,
      });

      this.stream = stream;
      this.isCapturing = true;
      this.callbacks.onStateChange({ isCapturing: true });

      // If user stops sharing via the browser's native "Stop sharing" button
      stream.getVideoTracks()[0]?.addEventListener("ended", () => {
        this.stop();
      });

      // Capture immediately, then schedule next
      await this.captureFrame(null, null);
      this.scheduleNextCapture(null, null);
    } catch (err: any) {
      console.error("[ScreenCapture] Permission denied:", err);
      this.callbacks.onError("Screen sharing was denied or cancelled");
      this.isCapturing = false;
      this.callbacks.onStateChange({ isCapturing: false });
    }
  }

  stop(): void {
    this.clearTimer();

    if (this.stream) {
      this.stream.getTracks().forEach((track) => track.stop());
      this.stream = null;
    }

    if (this.video) {
      this.video.srcObject = null;
      this.video = null;
    }

    this.isCapturing = false;
    this.consecutiveFailures = 0;
    this.callbacks.onStateChange({ isCapturing: false });
  }

  /** Manual retry after failures — resets backoff and resumes scheduling */
  retryAfterFailure(entryId: string, crmProjectId: string): void {
    this.consecutiveFailures = 0;
    this.callbacks.onErrorClear();
    if (this.stream) {
      this.scheduleNextCapture(entryId, crmProjectId);
    }
  }

  destroy(): void {
    this.destroyed = true;
    this.stop();
  }

  // ─── Capture logic ───

  async captureFrame(entryId: string | null, crmProjectId: string | null): Promise<void> {
    if (!entryId || !crmProjectId) {
      console.warn("[ScreenCapture] No active entry, skipping capture");
      return;
    }

    if (!this.stream) {
      console.warn("[ScreenCapture] No stream available");
      return;
    }

    const track = this.stream.getVideoTracks()[0];
    if (!track || track.readyState !== "live") {
      console.warn("[ScreenCapture] Video track not live, stopping capture");
      this.stop();
      return;
    }

    try {
      // Create or reuse video element
      if (!this.video) {
        this.video = document.createElement("video");
        this.video.srcObject = this.stream;
        this.video.muted = true;
        await this.video.play();
      }

      const video = this.video;

      // Wait for video to be ready (up to 3s)
      if (video.readyState < 2) {
        await new Promise<void>((resolve) => {
          const checkReady = () => {
            if (video.readyState >= 2) {
              resolve();
            } else {
              requestAnimationFrame(checkReady);
            }
          };
          checkReady();
          setTimeout(resolve, 3000);
        });
      }

      if (video.videoWidth === 0 || video.videoHeight === 0) {
        console.warn("[ScreenCapture] Video dimensions are 0, skipping frame");
        return;
      }

      // Draw frame to canvas
      const canvas = document.createElement("canvas");
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        console.error("[ScreenCapture] Failed to get canvas context");
        return;
      }
      ctx.drawImage(video, 0, 0);

      // Convert to JPEG blob
      const blob = await new Promise<Blob | null>((resolve) =>
        canvas.toBlob(resolve, "image/jpeg", 0.7)
      );
      if (!blob || blob.size < 1000) {
        console.warn("[ScreenCapture] Blob too small, skipping");
        return;
      }

      // Get signed upload URL
      const uploadRes = await apiRequest("POST", "/api/time-tracking/screenshots/upload-url", {
        timeEntryId: entryId,
      });
      if (!uploadRes.ok) {
        throw new Error(`Upload URL request failed: ${uploadRes.status}`);
      }
      const { uploadURL, objectPath } = await uploadRes.json();

      // Upload to GCS
      const putRes = await fetch(uploadURL, {
        method: "PUT",
        body: blob,
        headers: { "Content-Type": "image/jpeg" },
      });
      if (!putRes.ok) {
        throw new Error(`Screenshot upload failed: ${putRes.status}`);
      }

      // Save metadata
      const storageKey = objectPath;
      const saveRes = await apiRequest("POST", "/api/time-tracking/screenshots", {
        timeEntryId: entryId,
        crmProjectId,
        storageKey,
        capturedAt: new Date().toISOString(),
      });
      if (!saveRes.ok) {
        throw new Error(`Screenshot metadata save failed: ${saveRes.status}`);
      }

      // Success — reset failure count
      this.consecutiveFailures = 0;
      this.callbacks.onErrorClear();
      console.log("[ScreenCapture] Screenshot captured and saved successfully");
    } catch (err: any) {
      this.consecutiveFailures += 1;
      const msg = err?.message || String(err);
      console.error(`[ScreenCapture] Capture failed (${this.consecutiveFailures}/${MAX_CONSECUTIVE_FAILURES}):`, msg);

      if (this.consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
        // Don't hard-stop — pause scheduling and let user retry
        this.clearTimer();
        this.callbacks.onError(
          `Screenshot capture paused after ${MAX_CONSECUTIVE_FAILURES} failures. Click "Retry" to resume.`
        );
        return;
      }

      this.callbacks.onError(
        `Capture failed (${this.consecutiveFailures}/${MAX_CONSECUTIVE_FAILURES}). Next retry with backoff.`
      );
    }
  }

  // ─── Scheduling ───

  scheduleNextCapture(entryId: string | null, crmProjectId: string | null): void {
    this.clearTimer();

    const interval = this.getNextInterval();
    this.captureTimer = setTimeout(async () => {
      if (this.stream && !this.destroyed) {
        await this.captureFrame(entryId, crmProjectId);
        // Only reschedule if we haven't hit the failure ceiling
        if (this.consecutiveFailures < MAX_CONSECUTIVE_FAILURES) {
          this.scheduleNextCapture(entryId, crmProjectId);
        }
      }
    }, interval);
  }

  pauseScheduling(): void {
    this.clearTimer();
  }

  resumeScheduling(entryId: string | null, crmProjectId: string | null): void {
    if (this.stream && !this.captureTimer) {
      this.scheduleNextCapture(entryId, crmProjectId);
    }
  }

  private getNextInterval(): number {
    if (this.consecutiveFailures === 0) {
      // Normal interval: random 3-5 minutes
      return (180 + Math.random() * 120) * 1000;
    }
    // Backoff: exponential with cap
    const backoff = Math.min(
      BACKOFF_BASE_MS * Math.pow(2, this.consecutiveFailures - 1),
      BACKOFF_MAX_MS
    );
    console.log(`[ScreenCapture] Backoff: next capture in ${Math.round(backoff / 1000)}s`);
    return backoff;
  }

  private clearTimer(): void {
    if (this.captureTimer) {
      clearTimeout(this.captureTimer);
      this.captureTimer = null;
    }
  }
}
