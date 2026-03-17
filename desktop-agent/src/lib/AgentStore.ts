/**
 * Persistent store for agent session state and runtime timer state.
 *
 * Session data (deviceId, deviceToken, deviceName, userEmail) is persisted
 * to a JSON file in app.getPath("userData"). Survives restarts.
 *
 * The server URL is no longer stored here — it comes from src/lib/config.ts
 * (API_BASE constant, overridable via DOCUFLOW_API_URL env var).
 *
 * Timer runtime state stays in memory — rebuilt from server on startup.
 */

import { app } from "electron";
import fs from "fs";
import path from "path";

interface PersistedData {
  deviceId: string | null;
  deviceToken: string | null;
  deviceName: string | null;
  userEmail: string | null;
  // Timer names persisted so they survive restarts
  activeEntryId: string | null;
  activeProjectName: string | null;
  activeTaskName: string | null;
}

// Runtime state (not persisted — rebuilt from server on startup)
interface RuntimeState {
  activeEntryId: string | null;
  activeProjectName: string | null;
  activeTaskName: string | null;
  activeDescription: string | null;
  timerStatus: "stopped" | "running" | "paused";
  timerDuration: number; // current entry's accumulated seconds (from server)
  timerTaskAccumulated: number; // today's stopped entries for this task (offset)
  timerLastActivityAt: number | null; // timestamp ms for local elapsed calc
  clientVersion: string;
}

const CONFIG_FILENAME = "agent-config.json";

export class AgentStore {
  private data: PersistedData;
  private runtime: RuntimeState;
  private configPath: string;

  constructor() {
    this.configPath = path.join(app.getPath("userData"), CONFIG_FILENAME);
    this.data = this.loadFromDisk();
    this.runtime = {
      activeEntryId: null,
      activeProjectName: null,
      activeTaskName: null,
      activeDescription: null,
      timerStatus: "stopped",
      timerDuration: 0,
      timerTaskAccumulated: 0,
      timerLastActivityAt: null,
      clientVersion: "0.1.0",
    };
  }

  // ─── Disk persistence ───

  private loadFromDisk(): PersistedData {
    const empty: PersistedData = {
      deviceId: null,
      deviceToken: null,
      deviceName: null,
      userEmail: null,
      activeEntryId: null,
      activeProjectName: null,
      activeTaskName: null,
    };
    try {
      if (!fs.existsSync(this.configPath)) return empty;
      const raw = fs.readFileSync(this.configPath, "utf-8");
      const parsed = JSON.parse(raw);
      return { ...empty, ...parsed };
    } catch (err) {
      console.warn("[AgentStore] Failed to load config, using defaults:", (err as Error).message);
      return empty;
    }
  }

  private saveToDisk(): void {
    try {
      fs.writeFileSync(this.configPath, JSON.stringify(this.data, null, 2), "utf-8");
    } catch (err) {
      console.error("[AgentStore] Failed to save config:", (err as Error).message);
    }
  }

  // ─── Pairing ───

  isPaired(): boolean {
    return !!(this.data.deviceId && this.data.deviceToken);
  }

  getDeviceId(): string | null { return this.data.deviceId; }
  getDeviceToken(): string | null { return this.data.deviceToken; }
  getDeviceName(): string | null { return this.data.deviceName; }
  getUserEmail(): string | null { return this.data.userEmail; }
  getClientVersion(): string { return this.runtime.clientVersion; }

  setClientVersion(v: string): void { this.runtime.clientVersion = v; }

  setSession(deviceId: string, deviceToken: string, deviceName: string, userEmail: string): void {
    this.data.deviceId = deviceId;
    this.data.deviceToken = deviceToken;
    this.data.deviceName = deviceName;
    this.data.userEmail = userEmail;
    this.saveToDisk();
  }

  clearSession(): void {
    this.data.deviceId = null;
    this.data.deviceToken = null;
    this.data.deviceName = null;
    this.data.userEmail = null;
    this.saveToDisk();
    this.clearTimer();
  }

  /** @deprecated Use setSession / clearSession */
  setPairing(deviceId: string, deviceToken: string, deviceName: string): void {
    this.setSession(deviceId, deviceToken, deviceName, this.data.userEmail ?? "");
  }

  /** @deprecated Use clearSession */
  clearPairing(): void {
    this.clearSession();
  }

  // ─── Timer runtime state ───

  getActiveEntryId(): string | null { return this.runtime.activeEntryId; }
  getTimerStatus(): string { return this.runtime.timerStatus; }
  getActiveProjectName(): string | null { return this.runtime.activeProjectName; }
  getActiveTaskName(): string | null { return this.runtime.activeTaskName; }
  getActiveDescription(): string | null { return this.runtime.activeDescription; }

  setTimerRunning(
    entryId: string,
    duration: number,
    projectName: string | null,
    taskName?: string | null,
    description?: string | null,
    taskAccumulated?: number,
  ): void {
    this.runtime.activeEntryId = entryId;
    this.runtime.timerStatus = "running";
    this.runtime.timerDuration = duration;
    this.runtime.timerTaskAccumulated = taskAccumulated ?? 0;
    this.runtime.timerLastActivityAt = Date.now();
    this.runtime.activeProjectName = projectName;
    this.runtime.activeTaskName = taskName ?? null;
    this.runtime.activeDescription = description ?? null;
    // Persist names so they survive restart
    this.data.activeEntryId = entryId;
    this.data.activeProjectName = projectName;
    this.data.activeTaskName = taskName ?? null;
    this.saveToDisk();
  }

  setTimerPaused(duration: number): void {
    this.runtime.timerStatus = "paused";
    this.runtime.timerDuration = duration;
    this.runtime.timerLastActivityAt = null;
  }

  clearTimer(): void {
    this.runtime.activeEntryId = null;
    this.runtime.timerStatus = "stopped";
    this.runtime.timerDuration = 0;
    this.runtime.timerTaskAccumulated = 0;
    this.runtime.timerLastActivityAt = null;
    this.runtime.activeProjectName = null;
    this.runtime.activeTaskName = null;
    this.runtime.activeDescription = null;
    // Clear persisted timer names
    this.data.activeEntryId = null;
    this.data.activeProjectName = null;
    this.data.activeTaskName = null;
    this.saveToDisk();
  }

  /**
   * Apply server-authoritative timer state.
   * Called after heartbeat sync or explicit refetch from /api/agent/timer/active.
   * Preserves activeProjectName when the entry ID hasn't changed.
   */
  syncFromServer(entry: { id: string; status: string; duration: number } | null): void {
    if (!entry || entry.status === "stopped") {
      this.clearTimer();
      return;
    }
    const entryChanged = this.runtime.activeEntryId !== entry.id;
    this.runtime.activeEntryId = entry.id;
    this.runtime.timerDuration = entry.duration;
    if (entryChanged) {
      // Restore from persisted data if it's the same entry (e.g. after restart)
      if (this.data.activeEntryId === entry.id) {
        this.runtime.activeProjectName = this.data.activeProjectName;
        this.runtime.activeTaskName = this.data.activeTaskName;
      } else {
        this.runtime.activeProjectName = null;
        this.runtime.activeTaskName = null;
      }
    }
    if (entry.status === "running") {
      this.runtime.timerStatus = "running";
      this.runtime.timerLastActivityAt = Date.now();
    } else {
      // paused
      this.runtime.timerStatus = "paused";
      this.runtime.timerLastActivityAt = null;
    }
  }

  /**
   * Get elapsed seconds (server duration + local delta if running).
   */
  getElapsedSeconds(): number {
    const base = this.runtime.timerTaskAccumulated + this.runtime.timerDuration;
    if (this.runtime.timerStatus === "running" && this.runtime.timerLastActivityAt) {
      const localDelta = Math.floor((Date.now() - this.runtime.timerLastActivityAt) / 1000);
      return base + localDelta;
    }
    return base;
  }

  /**
   * Get full state snapshot for IPC.
   */
  getTimerState(): {
    status: string;
    entryId: string | null;
    elapsed: number;
    projectName: string | null;
    taskName: string | null;
    description: string | null;
  } {
    return {
      status: this.runtime.timerStatus,
      entryId: this.runtime.activeEntryId,
      elapsed: this.getElapsedSeconds(),
      projectName: this.runtime.activeProjectName,
      taskName: this.runtime.activeTaskName,
      description: this.runtime.activeDescription,
    };
  }
}
