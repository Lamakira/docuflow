/**
 * Sync worker — drains activity events and screenshot uploads to the server.
 *
 * Two drain loops running in the same cycle:
 *  1. Activity events  → POST /api/agent/events/batch
 *  2. Screenshots      → presign → PUT upload → confirm
 *
 * Exponential backoff: 5s → 10s → 20s → ... → 5 min max.
 * Offline-first: SQLite queue survives restarts (Phase 4.2).
 *
 * Phase 4.2
 */

import { ApiClient, PLAN_UPGRADE_REQUIRED } from "../lib/ApiClient";
import { SqliteQueue, type PendingTimerCommand } from "../lib/SqliteQueue";
import { AgentStore } from "../lib/AgentStore";
import { timerCommandFailure } from "../lib/timerCommandFailure";
import fs from "fs";

const SYNC_INTERVAL_MS = 30_000;
const MAX_BACKOFF_MS = 5 * 60_000;
const BASE_BACKOFF_MS = 5_000;
const BATCH_SIZE = 50;
const MAX_SCREENSHOT_ATTEMPTS = 5;

export class SyncWorker {
  private apiClient: ApiClient;
  private queue: SqliteQueue;
  private store: AgentStore;
  private timeout: ReturnType<typeof setTimeout> | null = null;
  /** One drain at a time: a second one would send the same pending command twice (#333). */
  private syncing = false;
  private syncAgain = false;
  private eventFailures = 0;
  private totalEventsSynced = 0;
  private totalScreenshotsSynced = 0;
  private onTimerCommandSynced: ((type: PendingTimerCommand["type"]) => void) | null = null;

  constructor(apiClient: ApiClient, queue: SqliteQueue, store: AgentStore) {
    this.apiClient = apiClient;
    this.queue = queue;
    this.store = store;
  }

  /** Called after each timer command reaches the server (conflicts count as synced). */
  setOnTimerCommandSynced(cb: (type: PendingTimerCommand["type"]) => void): void {
    this.onTimerCommandSynced = cb;
  }

  private markSynced(cmd: PendingTimerCommand, resolvedEntryId?: string): void {
    this.queue.markTimerCommandSynced(cmd.clientCommandId, resolvedEntryId);
    this.onTimerCommandSynced?.(cmd.type);
  }

  start(): void {
    this.scheduleNext(5_000);
    console.log("[SyncWorker] Started (30s interval, SQLite-backed)");
  }

  stop(): void {
    if (this.timeout) {
      clearTimeout(this.timeout);
      this.timeout = null;
    }
    console.log(
      `[SyncWorker] Stopped (events: ${this.totalEventsSynced}, screenshots: ${this.totalScreenshotsSynced})`
    );
  }

  private scheduleNext(delayMs: number): void {
    this.timeout = setTimeout(() => this.syncOnce(), delayMs);
  }

  /** Trigger an immediate sync cycle (e.g. right after a timer command is enqueued). */
  triggerSync(): void {
    if (this.syncing) {
      this.syncAgain = true;
      return;
    }
    if (this.timeout) {
      clearTimeout(this.timeout);
      this.timeout = null;
    }
    this.scheduleNext(50);
  }

  private async syncOnce(): Promise<void> {
    this.syncing = true;
    try {
      await this.drainTimerCommands();
      await this.drainEvents();
      await this.drainScreenshots();
    } finally {
      this.syncing = false;
    }
    // A command enqueued during this cycle goes out now, not in 30 s.
    const again = this.syncAgain;
    this.syncAgain = false;
    this.scheduleNext(again ? 50 : SYNC_INTERVAL_MS);
  }

  // ─── Timer commands ───

  /**
   * FIFO drain of pending timer commands.
   * Breaks on any failure (FIFO invariant — pause/stop cannot reach server before start).
   * Treats semantic conflicts (already paused, etc.) as success.
   * A command that never reached the server (network down, 502-504) stays queued
   * for the next cycle; a refusal is marked failed (#333).
   */
  private async drainTimerCommands(): Promise<void> {
    // eslint-disable-next-line no-constant-condition
    while (true) {
      const cmd = this.queue.getNextPendingTimerCommand();
      if (!cmd) break;

      // A non-start command with a local placeholder entryId means its preceding
      // start command failed. Cascade the failure and continue to the next command.
      if (cmd.type !== "start" && cmd.entryId?.startsWith("local-")) {
        this.queue.failTimerCommand(cmd.clientCommandId, "Preceding start command failed");
        continue;
      }

      try {
        if (cmd.type === "start") {
          const entry = await this.apiClient.startTimer(
            cmd.crmProjectId!,
            cmd.taskId ?? undefined,
            cmd.description ?? undefined,
            cmd.clientCommandId,
          );
          // Propagate real server ID to store + subsequent pending commands
          if (cmd.entryId && cmd.entryId !== entry.id) {
            this.store.updateActiveEntryId(cmd.entryId, entry.id);
          }
          // Seed elapsed from server's accumulated task history today so the UI
          // shows e.g. 30:00 instead of 0:00 when the user restarts a task mid-day.
          if (entry.taskAccumulatedToday) {
            this.store.applyTaskAccumulatedToday(entry.taskAccumulatedToday);
          }
          this.markSynced(cmd, entry.id);
          console.log(`[SyncWorker] timer.start synced → serverEntryId=${entry.id} taskAccumulatedToday=${entry.taskAccumulatedToday ?? 0}s`);

        } else if (cmd.type === "pause") {
          await this.apiClient.pauseTimer(cmd.entryId!, cmd.effectiveAt);
          this.markSynced(cmd);
          console.log(`[SyncWorker] timer.pause synced — entry=${cmd.entryId}`);

        } else if (cmd.type === "resume") {
          await this.apiClient.resumeTimer(cmd.entryId!);
          this.markSynced(cmd);
          console.log(`[SyncWorker] timer.resume synced — entry=${cmd.entryId}`);

        } else if (cmd.type === "stop") {
          await this.apiClient.stopTimer(cmd.entryId!, cmd.effectiveAt);
          this.markSynced(cmd);
          console.log(`[SyncWorker] timer.stop synced — entry=${cmd.entryId}`);
        }
      } catch (error: any) {
        const msg: string = error.message ?? "";
        const failure = timerCommandFailure(error);
        // Semantic conflicts (entry already in desired state) → treat as success
        if (failure === "conflict") {
          this.markSynced(cmd);
          console.log(`[SyncWorker] timer.${cmd.type} conflict treated as success: ${msg}`);
          continue;
        }
        // Never reached the server — keep it queued and stop draining (FIFO invariant)
        if (failure === "retry") {
          console.log(`[SyncWorker] timer.${cmd.type} not sent, kept for retry: ${msg}`);
          break;
        }
        // Refused — mark failed and stop draining (FIFO invariant)
        this.queue.failTimerCommand(cmd.clientCommandId, msg);
        console.error(`[SyncWorker] timer.${cmd.type} sync failed: ${msg}`);
        break;
      }
    }
    this.queue.pruneTimerCommands();
  }

  // ─── Activity events ───

  private async drainEvents(): Promise<void> {
    const pending = this.queue.pendingCount();
    if (pending === 0) return;

    const { batchId, events } = this.queue.getNextBatch(BATCH_SIZE);
    if (events.length === 0) return;

    const deviceId = this.store.getDeviceId();
    if (!deviceId) {
      this.queue.releaseBatch(batchId);
      return;
    }

    try {
      const result = await this.apiClient.sendEventsBatch({
        deviceId,
        batchId,
        clientType: "electron",
        clientVersion: this.store.getClientVersion(),
        events: events.map((e) => ({
          type: e.eventType,
          timestamp: e.timestamp,
          data: JSON.parse(e.data || "{}"),
        })),
      });

      if (result.ok) {
        this.queue.markBatchSynced(batchId);
        this.eventFailures = 0;
        this.totalEventsSynced += result.accepted || events.length;
        console.log(
          `[SyncWorker] Events: ${events.length} synced (total: ${this.totalEventsSynced})`
        );
      } else {
        this.queue.releaseBatch(batchId);
      }
    } catch (error: any) {
      if (error?.code === PLAN_UPGRADE_REQUIRED) {
        // The Plan leaves activity capture out: the batch can never be accepted.
        this.queue.markBatchSynced(batchId);
        console.warn(`[SyncWorker] Events: ${events.length} dropped — ${error.message}`);
        return;
      }
      this.queue.releaseBatch(batchId);
      this.eventFailures++;
      console.error(`[SyncWorker] Event sync failed: ${error.message}`);
    }
  }

  // ─── Screenshots ───

  private async drainScreenshots(): Promise<void> {
    const pending = this.queue.getNextPendingScreenshot();
    if (!pending) return;

    if (pending.attemptCount >= MAX_SCREENSHOT_ATTEMPTS) {
      console.warn(`[SyncWorker] Screenshot ${pending.id.slice(0, 8)} exceeded max attempts, dropping`);
      this.queue.markScreenshotSent(pending.id); // Remove from queue (keep local file for display)
      return;
    }

    try {
      const meta = JSON.parse(pending.metaJson) as {
        timeEntryId: string;
        capturedAt: string;
        deviceId?: string;
        clientVersion?: string;
        keyboardActivityPercent?: number | null;
        mouseActivityPercent?: number | null;
        keyboardCount?: number | null;
        mouseCount?: number | null;
      };

      // Skip screenshots taken while the timer start command hasn't synced yet.
      // The pending timer commands drain runs before this and will resolve the
      // placeholder ID; the screenshot will succeed on the next sync cycle.
      if (meta.timeEntryId?.startsWith("local-")) {
        return;
      }

      const deviceId = meta.deviceId ?? this.store.getDeviceId();
      if (!deviceId) return;

      // Step 1: Presign — once per capture, not once per attempt (#239).
      // The server now refuses to open a second slot for the same capture, so
      // this is a saved round trip rather than the guard itself; both sides
      // matter, because an older agent talks to a newer server and the reverse.
      const slot = pending.screenshotId && pending.uploadURL
        ? { screenshotId: pending.screenshotId, uploadURL: pending.uploadURL }
        : await this.apiClient.presignScreenshot({
        deviceId,
        timeEntryId: meta.timeEntryId,
        capturedAt: meta.capturedAt,
        clientType: "electron",
        clientVersion: meta.clientVersion ?? this.store.getClientVersion(),
        keyboardActivityPercent: meta.keyboardActivityPercent ?? null,
        mouseActivityPercent: meta.mouseActivityPercent ?? null,
        keyboardCount: meta.keyboardCount ?? null,
        mouseCount: meta.mouseCount ?? null,
      });
      this.queue.recordScreenshotSlot(pending.id, slot.screenshotId, slot.uploadURL);

      // Step 2: Upload binary (async to avoid blocking event loop)
      const imageBuffer = await fs.promises.readFile(pending.filePath);
      await this.apiClient.uploadScreenshot(slot.uploadURL, imageBuffer);

      // Step 3: Confirm
      await this.apiClient.confirmScreenshot({
        screenshotId: slot.screenshotId,
        deviceId,
      });

      this.queue.markScreenshotSent(pending.id);
      // Keep local file so the Screenshots page can display it.
      // Old files (>30 days) are pruned by ScreenCaptureWorker.pruneOldScreenshots().
      this.totalScreenshotsSynced++;
      console.log(
        `[SyncWorker] Screenshot ${pending.id.slice(0, 8)} uploaded (total: ${this.totalScreenshotsSynced})`
      );
    } catch (error: any) {
      if (error?.code === PLAN_UPGRADE_REQUIRED) {
        console.warn(`[SyncWorker] Screenshot ${pending.id.slice(0, 8)} dropped — ${error.message}`);
        this.queue.markScreenshotSent(pending.id);
        return;
      }
      const backoff = Math.min(
        BASE_BACKOFF_MS * Math.pow(2, pending.attemptCount),
        MAX_BACKOFF_MS
      );
      this.queue.failScreenshot(pending.id, backoff);
      console.error(`[SyncWorker] Screenshot upload failed (attempt ${pending.attemptCount + 1}): ${error.message}`);
    }
  }

}
