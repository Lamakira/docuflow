/**
 * Persistent JSON-file queue for activity event batches and screenshot uploads.
 *
 * Replaces the original better-sqlite3 implementation to eliminate native
 * module packaging issues in Electron Forge + webpack + asar builds.
 *
 * Data is stored as JSON in `agent-queue.json` inside the userData directory.
 * Writes use atomic rename (write → temp file, rename → target) to prevent
 * corruption on crash.
 *
 * Phase 4.2 (revised)
 */

import fs from "fs";
import path from "path";
import { randomUUID } from "crypto";

export interface QueuedEvent {
  id: number;
  batchId: string | null;
  eventType: string;
  timestamp: string;
  data: string; // JSON string
  createdAt: string;
  syncedAt: string | null;
}

export interface PendingScreenshot {
  id: string;
  filePath: string;
  metaJson: string; // { timeEntryId, userId, capturedAt, crmProjectId }
  nextRetryAt: number; // epoch ms
  attemptCount: number;
  createdAt: number; // epoch ms
}

export interface PendingTimerCommand {
  clientCommandId: string;  // UUID — idempotency key sent to server
  type: "start" | "pause" | "resume" | "stop";
  /** Local placeholder "local-{uuid}" for starts; real server entry ID for pause/resume/stop.
   *  Updated to the real server ID by markTimerCommandSynced() once start syncs. */
  entryId: string | null;
  crmProjectId?: string;
  taskId?: string | null;
  description?: string | null;
  createdAt: number;        // epoch ms — sort key for FIFO ordering
  syncedAt: number | null;  // epoch ms — null = not yet synced
  failedAt: number | null;  // epoch ms — null = not failed
  errorMessage: string | null;
}

interface QueueData {
  nextEventId: number;
  events: QueuedEvent[];
  screenshots: PendingScreenshot[];
  timerCommands: PendingTimerCommand[];
}

function emptyData(): QueueData {
  return { nextEventId: 1, events: [], screenshots: [], timerCommands: [] };
}

export class SqliteQueue {
  private data: QueueData;
  private filePath: string;
  private saveTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(userDataPath: string) {
    this.filePath = path.join(userDataPath, "agent-queue.json");
    this.data = this.loadFromDisk();
    console.log(`[Queue] Opened at ${this.filePath}`);
  }

  // ─── Disk I/O ───

  private loadFromDisk(): QueueData {
    try {
      if (!fs.existsSync(this.filePath)) return emptyData();
      const raw = fs.readFileSync(this.filePath, "utf-8");
      const parsed = JSON.parse(raw) as Partial<QueueData>;
      return {
        nextEventId: parsed.nextEventId ?? 1,
        events: parsed.events ?? [],
        screenshots: parsed.screenshots ?? [],
        timerCommands: parsed.timerCommands ?? [],
      };
    } catch (err) {
      console.warn("[Queue] Failed to load, starting fresh:", (err as Error).message);
      return emptyData();
    }
  }

  /** Atomic write: write to temp file then rename */
  private saveToDisk(): void {
    try {
      const tmp = this.filePath + ".tmp";
      fs.writeFileSync(tmp, JSON.stringify(this.data), "utf-8");
      fs.renameSync(tmp, this.filePath);
    } catch (err) {
      console.error("[Queue] Save failed:", (err as Error).message);
    }
  }

  /** Debounced save — coalesces rapid writes into a single disk flush */
  private scheduleSave(): void {
    if (this.saveTimer) return;
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null;
      this.saveToDisk();
    }, 100);
  }

  /** Force immediate save (used before close) */
  private flushSave(): void {
    if (this.saveTimer) {
      clearTimeout(this.saveTimer);
      this.saveTimer = null;
    }
    this.saveToDisk();
  }

  // ═══════════════════════════════════════
  // Activity Events
  // ═══════════════════════════════════════

  enqueue(eventType: string, timestamp: Date, data: Record<string, unknown> = {}): void {
    const event: QueuedEvent = {
      id: this.data.nextEventId++,
      batchId: null,
      eventType,
      timestamp: timestamp.toISOString(),
      data: JSON.stringify(data),
      createdAt: new Date().toISOString(),
      syncedAt: null,
    };
    this.data.events.push(event);
    this.scheduleSave();
    console.log(`[Queue] Enqueue: ${eventType} (pending: ${this.pendingCount()})`);
  }

  getNextBatch(limit = 50): { batchId: string; events: QueuedEvent[] } {
    const batchId = randomUUID();
    const pending = this.data.events.filter(
      (e) => e.syncedAt === null && e.batchId === null
    );
    const batch = pending.slice(0, limit);

    for (const event of batch) {
      event.batchId = batchId;
    }

    if (batch.length > 0) {
      this.scheduleSave();
    }

    return { batchId, events: batch };
  }

  markBatchSynced(batchId: string): void {
    const now = new Date().toISOString();
    for (const event of this.data.events) {
      if (event.batchId === batchId) {
        event.syncedAt = now;
      }
    }
    // Prune old synced rows (older than 7 days)
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    this.data.events = this.data.events.filter(
      (e) => e.syncedAt === null || e.syncedAt > sevenDaysAgo
    );
    this.scheduleSave();
    console.log(`[Queue] Batch ${batchId.slice(0, 8)} synced`);
  }

  releaseBatch(batchId: string): void {
    for (const event of this.data.events) {
      if (event.batchId === batchId) {
        event.batchId = null;
      }
    }
    this.scheduleSave();
  }

  pendingCount(): number {
    return this.data.events.filter((e) => e.syncedAt === null).length;
  }

  // ═══════════════════════════════════════
  // Pending Screenshots
  // ═══════════════════════════════════════

  enqueueScreenshot(filePath: string, meta: Record<string, unknown>): string {
    const id = randomUUID();
    const entry: PendingScreenshot = {
      id,
      filePath,
      metaJson: JSON.stringify(meta),
      nextRetryAt: 0,
      attemptCount: 0,
      createdAt: Date.now(),
    };
    this.data.screenshots.push(entry);
    this.scheduleSave();
    console.log(`[Queue] Screenshot enqueued: ${id.slice(0, 8)}`);
    return id;
  }

  getNextPendingScreenshot(nowMs = Date.now()): PendingScreenshot | null {
    const ready = this.data.screenshots
      .filter((s) => s.nextRetryAt <= nowMs)
      .sort((a, b) => a.createdAt - b.createdAt);
    return ready[0] ?? null;
  }

  markScreenshotSent(id: string): void {
    this.data.screenshots = this.data.screenshots.filter((s) => s.id !== id);
    this.scheduleSave();
    console.log(`[Queue] Screenshot ${id.slice(0, 8)} sent`);
  }

  failScreenshot(id: string, backoffMs: number): void {
    const entry = this.data.screenshots.find((s) => s.id === id);
    if (entry) {
      entry.attemptCount += 1;
      entry.nextRetryAt = Date.now() + backoffMs;
      this.scheduleSave();
    }
  }

  pendingScreenshotCount(): number {
    return this.data.screenshots.length;
  }

  cleanup(): void {
    const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
    this.data.screenshots = this.data.screenshots.filter(
      (s) => s.createdAt >= sevenDaysAgo
    );
    this.scheduleSave();
  }

  // ═══════════════════════════════════════
  // Timer Commands (offline-first)
  // ═══════════════════════════════════════

  /** Enqueue a timer command for background server sync. */
  enqueueTimerCommand(
    cmd: Omit<PendingTimerCommand, "createdAt" | "syncedAt" | "failedAt" | "errorMessage">
  ): void {
    const entry: PendingTimerCommand = {
      ...cmd,
      createdAt: Date.now(),
      syncedAt: null,
      failedAt: null,
      errorMessage: null,
    };
    this.data.timerCommands.push(entry);
    this.scheduleSave();
    console.log(`[Queue] TimerCommand enqueue: ${cmd.type} clientCommandId=${cmd.clientCommandId.slice(0, 8)}`);
  }

  /** All pending (not synced, not failed) timer commands in FIFO order. */
  getPendingTimerCommands(): PendingTimerCommand[] {
    return this.data.timerCommands
      .filter((c) => c.syncedAt === null && c.failedAt === null)
      .sort((a, b) => a.createdAt - b.createdAt);
  }

  /** The next timer command to sync (oldest pending). */
  getNextPendingTimerCommand(): PendingTimerCommand | null {
    return this.getPendingTimerCommands()[0] ?? null;
  }

  /**
   * Mark a command as synced.
   * If `resolvedEntryId` is provided (start command resolved a local placeholder),
   * update the entryId on all subsequent pending commands that reference the old placeholder.
   */
  markTimerCommandSynced(clientCommandId: string, resolvedEntryId?: string): void {
    const cmd = this.data.timerCommands.find((c) => c.clientCommandId === clientCommandId);
    if (!cmd) return;

    const oldEntryId = cmd.entryId;
    cmd.syncedAt = Date.now();

    // Propagate real server entry ID to subsequent commands that had the local placeholder
    if (resolvedEntryId && oldEntryId && oldEntryId !== resolvedEntryId) {
      for (const c of this.data.timerCommands) {
        if (c.syncedAt === null && c.failedAt === null && c.entryId === oldEntryId) {
          c.entryId = resolvedEntryId;
        }
      }
    }

    this.scheduleSave();
    console.log(`[Queue] TimerCommand synced: ${clientCommandId.slice(0, 8)}${resolvedEntryId ? ` → ${resolvedEntryId.slice(0, 8)}` : ""}`);
  }

  /** Mark a command as permanently failed. */
  failTimerCommand(clientCommandId: string, errorMessage: string): void {
    const cmd = this.data.timerCommands.find((c) => c.clientCommandId === clientCommandId);
    if (cmd) {
      cmd.failedAt = Date.now();
      cmd.errorMessage = errorMessage;
      this.scheduleSave();
    }
    console.error(`[Queue] TimerCommand failed: ${clientCommandId.slice(0, 8)} — ${errorMessage}`);
  }

  /** Number of pending (not synced, not failed) timer commands. */
  pendingTimerCommandCount(): number {
    return this.data.timerCommands.filter((c) => c.syncedAt === null && c.failedAt === null).length;
  }

  /**
   * Derive the user's intended timer state from the last unsynced command.
   * Used to restore timer state on app restart without counting offline gaps.
   */
  getTimerIntent(): "running" | "paused" | "stopped" {
    const pending = this.getPendingTimerCommands();
    if (pending.length === 0) return "stopped";
    const last = pending[pending.length - 1];
    if (last.type === "start" || last.type === "resume") return "running";
    if (last.type === "pause") return "paused";
    return "stopped"; // stop
  }

  /** Remove synced timer commands older than 7 days and all failed commands older than 1 day. */
  pruneTimerCommands(): void {
    const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
    const oneDayAgo = Date.now() - 24 * 60 * 60 * 1000;
    this.data.timerCommands = this.data.timerCommands.filter((c) => {
      if (c.syncedAt !== null) return c.syncedAt > sevenDaysAgo;
      if (c.failedAt !== null) return c.failedAt > oneDayAgo;
      return true; // pending — always keep
    });
    this.scheduleSave();
  }

  close(): void {
    this.flushSave();
    console.log("[Queue] Closed");
  }
}
