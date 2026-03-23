/**
 * Persistent store for agent session state and runtime timer state.
 *
 * Session data (deviceId, deviceToken, deviceName, userEmail) is persisted
 * to a JSON file in app.getPath("userData"). Survives restarts.
 *
 * Timer state uses session-based tracking: each start/resume creates a
 * TrackingSession with an ISO startTime. Elapsed time is derived from
 * session durations — never maintained as an incrementing counter.
 */

import { app } from "electron";
import fs from "fs";
import path from "path";
import crypto from "crypto";

/** One continuous run of the timer for a given time entry. */
export interface TrackingSession {
  id: string;
  entryId: string;       // backend time_entry id — groups sessions for the same entry
  taskId: string | null; // null for project-only (no task) entries
  startTime: string;     // ISO UTC
  endTime: string | null; // null = currently active
}

interface PersistedData {
  deviceId: string | null;
  deviceToken: string | null;
  deviceName: string | null;
  userEmail: string | null;
  // Active entry context — persisted so names survive restarts
  activeEntryId: string | null;
  activeProjectName: string | null;
  activeTaskName: string | null;
  activeTaskId: string | null;
  // Source of truth for elapsed / worked-today calculations
  sessions: TrackingSession[];
  // Updated on each heartbeat/state change — used to close orphan sessions after crash
  lastActivityAt: string | null;
}

// Runtime-only state (not persisted)
interface RuntimeState {
  activeDescription: string | null;
  timerStatus: "stopped" | "running" | "paused";
  clientVersion: string;
}

const CONFIG_FILENAME = "agent-config.json";
const MAX_SESSION_AGE_MS = 90 * 24 * 60 * 60 * 1000; // 90 days
const MAX_SESSIONS = 1000;

export class AgentStore {
  private data: PersistedData;
  private runtime: RuntimeState;
  private configPath: string;

  constructor() {
    this.configPath = path.join(app.getPath("userData"), CONFIG_FILENAME);
    this.data = this.loadFromDisk();
    this.runtime = {
      activeDescription: null,
      timerStatus: "stopped",
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
      activeTaskId: null,
      sessions: [],
      lastActivityAt: null,
    };
    try {
      if (!fs.existsSync(this.configPath)) return empty;
      const raw = fs.readFileSync(this.configPath, "utf-8");
      const parsed = JSON.parse(raw);
      return {
        ...empty,
        ...parsed,
        sessions: Array.isArray(parsed.sessions) ? parsed.sessions : [],
      };
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

  // ─── Auth / pairing ───

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

  // ─── Timer state ───

  getActiveEntryId(): string | null { return this.data.activeEntryId; }
  getTimerStatus(): string { return this.runtime.timerStatus; }
  getActiveProjectName(): string | null { return this.data.activeProjectName; }
  getActiveTaskName(): string | null { return this.data.activeTaskName; }
  getActiveTaskId(): string | null { return this.data.activeTaskId; }
  getActiveDescription(): string | null { return this.runtime.activeDescription; }

  /**
   * Start (or switch to) a new running timer.
   * Closes any currently active session before opening a new one,
   * so there is always at most one active session.
   */
  setTimerRunning(
    entryId: string,
    projectName: string | null,
    taskId: string | null,
    taskName?: string | null,
    description?: string | null,
  ): void {
    this.closeActiveSessions();
    this.data.sessions.push({
      id: crypto.randomUUID(),
      entryId,
      taskId: taskId ?? null,
      startTime: new Date().toISOString(),
      endTime: null,
    });
    this.pruneSessions();

    this.runtime.timerStatus = "running";
    this.runtime.activeDescription = description ?? null;
    this.data.activeEntryId = entryId;
    this.data.activeProjectName = projectName;
    this.data.activeTaskName = taskName ?? null;
    this.data.activeTaskId = taskId ?? null;
    this.data.lastActivityAt = new Date().toISOString();
    this.saveToDisk();
  }

  /**
   * Pause the running timer.
   * Closes the active session; elapsed is preserved in the closed session.
   */
  setTimerPaused(): void {
    this.closeActiveSessions();
    this.runtime.timerStatus = "paused";
    this.data.lastActivityAt = new Date().toISOString();
    this.saveToDisk();
  }

  /** Stop the timer and clear all active context. */
  clearTimer(): void {
    this.closeActiveSessions();
    this.runtime.timerStatus = "stopped";
    this.runtime.activeDescription = null;
    this.data.activeEntryId = null;
    this.data.activeProjectName = null;
    this.data.activeTaskName = null;
    this.data.activeTaskId = null;
    this.data.lastActivityAt = new Date().toISOString();
    this.saveToDisk();
  }

  /** Record heartbeat timestamp and persist so crash-recovery end-time is accurate. */
  touchActivity(): void {
    this.data.lastActivityAt = new Date().toISOString();
    this.saveToDisk();
  }

  private closeActiveSessions(): void {
    const now = new Date().toISOString();
    for (const s of this.data.sessions) {
      if (s.endTime === null) s.endTime = now;
    }
  }

  private pruneSessions(): void {
    const cutoff = Date.now() - MAX_SESSION_AGE_MS;
    this.data.sessions = this.data.sessions.filter(
      (s) => new Date(s.startTime).getTime() > cutoff
    );
    if (this.data.sessions.length > MAX_SESSIONS) {
      this.data.sessions = this.data.sessions.slice(-MAX_SESSIONS);
    }
  }

  // ─── Startup reconciliation ───

  /**
   * Close any sessions that were left open when the app shut down or crashed.
   * Must be called once on startup, before workers are started.
   *
   * Uses lastActivityAt as the most accurate available end time; falls back to
   * the session's own startTime (zero-duration, better than an infinite leak).
   */
  reconcileOrphanSessions(): void {
    const orphans = this.data.sessions.filter((s) => s.endTime === null);
    if (orphans.length === 0) return;

    const fallback = this.data.lastActivityAt ?? new Date().toISOString();
    for (const s of orphans) {
      const startMs = new Date(s.startTime).getTime();
      const endMs = new Date(fallback).getTime();
      s.endTime = endMs > startMs ? fallback : s.startTime;
    }

    console.log(
      `[AgentStore] Reconciled ${orphans.length} orphan session(s) (lastActivityAt=${fallback})`
    );
    // Status will be overwritten by syncTimerFromServer() shortly after startup
    this.runtime.timerStatus = "stopped";
    this.saveToDisk();
  }

  // ─── Server sync ───

  /**
   * Apply server-authoritative timer state.
   *
   * Only updates status/entryId — does NOT override session-derived elapsed.
   * Reconciles local sessions when server status diverges from local status.
   */
  syncFromServer(entry: { id: string; status: string; duration: number } | null): void {
    if (!entry || entry.status === "stopped") {
      if (this.runtime.timerStatus !== "stopped") {
        this.clearTimer();
      }
      return;
    }

    const serverStatus = entry.status as "running" | "paused";
    const entryChanged = this.data.activeEntryId !== entry.id;

    if (entryChanged) {
      // New entry from server: close sessions for the old entry
      this.closeActiveSessions();
      this.data.activeEntryId = entry.id;
      // activeProjectName / activeTaskName were persisted from last setTimerRunning call;
      // they are still correct if this is the same device after a restart.
    }

    if (serverStatus === "running" && this.runtime.timerStatus !== "running") {
      // Server is running but we are not — open a new session
      this.data.sessions.push({
        id: crypto.randomUUID(),
        entryId: entry.id,
        taskId: this.data.activeTaskId ?? null,
        startTime: new Date().toISOString(),
        endTime: null,
      });
      this.runtime.timerStatus = "running";
    } else if (serverStatus === "paused" && this.runtime.timerStatus === "running") {
      // Server is paused but we are running — close the active session
      this.closeActiveSessions();
      this.runtime.timerStatus = "paused";
    } else {
      this.runtime.timerStatus = serverStatus;
    }

    this.data.lastActivityAt = new Date().toISOString();
    this.saveToDisk();
  }

  // ─── Derived selectors ───

  getActiveSession(): TrackingSession | null {
    return this.data.sessions.find((s) => s.endTime === null) ?? null;
  }

  getSessions(): TrackingSession[] {
    return this.data.sessions;
  }

  /**
   * Elapsed seconds for the current entry (sum of all sessions for activeEntryId).
   * Includes the open session if the timer is running.
   */
  getElapsedSeconds(now = Date.now()): number {
    const entryId = this.data.activeEntryId;
    if (!entryId) return 0;
    return Math.floor(
      this.data.sessions
        .filter((s) => s.entryId === entryId)
        .reduce((acc, s) => {
          const start = new Date(s.startTime).getTime();
          const end = s.endTime ? new Date(s.endTime).getTime() : now;
          return acc + Math.max(0, end - start);
        }, 0) / 1000
    );
  }

  /**
   * Total seconds worked today (all tasks, all entries).
   * Clamps each session to [local midnight, now].
   * Correctly handles sessions that started before midnight.
   */
  getWorkedTodaySeconds(now = Date.now()): number {
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const midnight = todayStart.getTime();

    return Math.floor(
      this.data.sessions.reduce((acc, s) => {
        const start = new Date(s.startTime).getTime();
        const end = s.endTime ? new Date(s.endTime).getTime() : now;
        const cStart = Math.max(start, midnight);
        const cEnd = Math.min(end, now);
        if (cEnd <= cStart) return acc;
        return acc + (cEnd - cStart);
      }, 0) / 1000
    );
  }

  /**
   * Full state snapshot for IPC push to renderer(s).
   */
  getTimerState(): {
    status: string;
    entryId: string | null;
    elapsed: number;
    workedToday: number;
    projectName: string | null;
    taskName: string | null;
    description: string | null;
  } {
    return {
      status: this.runtime.timerStatus,
      entryId: this.data.activeEntryId,
      elapsed: this.getElapsedSeconds(),
      workedToday: this.getWorkedTodaySeconds(),
      projectName: this.data.activeProjectName,
      taskName: this.data.activeTaskName,
      description: this.runtime.activeDescription,
    };
  }
}
