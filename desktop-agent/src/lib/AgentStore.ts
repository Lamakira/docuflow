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
  // Server-side accumulated elapsed (seconds) at the moment we first synced this entry.
  // Non-zero only when the entry was started on another device/client and we have no
  // local sessions yet. Once local sessions exist, they are authoritative.
  entryServerBase: number;
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
  /** Server's totalDuration for all STOPPED entries today (all devices). Runtime-only.
   *  getWorkedTodaySeconds() = workedTodayServerBase + getElapsedTodaySeconds() */
  workedTodayServerBase: number;
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
      workedTodayServerBase: 0,
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
      entryServerBase: 0,
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
    /**
     * Stopped-entry history for this task today (seconds), as returned by the
     * server's timer/start response (`taskAccumulatedToday`). Seeds entryServerBase
     * so elapsed starts from the accumulated total rather than 0. Only applied
     * when switching to a new entry — ignored on resume of the same entry.
     */
    taskAccumulatedToday = 0,
  ): void {
    this.closeActiveSessions();
    // On a new entry: initialise server base from the task's stopped history today
    // (restores the "accumulated time, not 0" UX from the pre-session-based model).
    // On resume of the same entry: preserve whatever base is already set.
    if (entryId !== this.data.activeEntryId) {
      this.data.entryServerBase = taskAccumulatedToday;
    }
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
    // Reset the server base so stale yesterday-data doesn't inflate the new day's
    // "Worked Today" display. The heartbeat will repopulate this within 30 s.
    this.runtime.workedTodayServerBase = 0;
    this.data.activeEntryId = null;
    this.data.activeProjectName = null;
    this.data.activeTaskName = null;
    this.data.activeTaskId = null;
    this.data.entryServerBase = 0;
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
   * Updates status/entryId and populates project/task names when not already known.
   * When the entry has no local sessions (e.g. started from another device),
   * seeds elapsed from the server's accumulated duration so the display is correct.
   */
  syncFromServer(entry: {
    id: string;
    status: string;
    duration: number;
    taskId?: string | null;
    lastActivityAt?: string | null;
    projectName?: string | null;
    taskName?: string | null;
  } | null): void {
    if (!entry || entry.status === "stopped") {
      if (this.runtime.timerStatus !== "stopped") {
        this.clearTimer();
      }
      return;
    }

    const serverStatus = entry.status as "running" | "paused";
    const entryChanged = this.data.activeEntryId !== entry.id;

    if (entryChanged) {
      // New entry from server: close sessions for the old entry, reset server base,
      // and clear stale names so the hydration block below can apply server values.
      this.closeActiveSessions();
      this.data.activeEntryId = entry.id;
      this.data.entryServerBase = 0;
      this.data.activeProjectName = null;
      this.data.activeTaskName = null;
      this.data.activeTaskId = null;
    }

    // Populate task/project names from server when not already known locally
    if (!this.data.activeProjectName && entry.projectName) {
      this.data.activeProjectName = entry.projectName;
    }
    if (!this.data.activeTaskName && entry.taskName) {
      this.data.activeTaskName = entry.taskName;
    }
    if (!this.data.activeTaskId && entry.taskId) {
      this.data.activeTaskId = entry.taskId;
    }

    // Seed entryServerBase when we have no local sessions for this entry yet.
    // This handles timer started on another device: desktop would otherwise
    // show only the ~0s since sync instead of the full accumulated elapsed.
    const localSessionsForEntry = this.data.sessions.filter((s) => s.entryId === entry.id);
    if (localSessionsForEntry.length === 0) {
      const now = Date.now();
      const lastActivity = entry.lastActivityAt
        ? new Date(entry.lastActivityAt).getTime()
        : now;
      const gapSeconds = Math.max(0, Math.floor((now - lastActivity) / 1000));
      const computed = (entry.duration ?? 0) + gapSeconds;
      if (computed > this.data.entryServerBase) {
        // Always take the larger estimate (improves on every sync until local sessions exist)
        this.data.entryServerBase = computed;
      }
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
   * Elapsed seconds for the current entry (total, unclamped).
   *
   * = entryServerBase (server-accumulated before first desktop session)
   * + sum of ALL local sessions for activeEntryId
   *
   * NOT clamped to the current day. Useful for server reconciliation
   * and historical context, but should NOT be used for day-boundary UI.
   * Use getElapsedTodaySeconds() for the header and task row display.
   */
  getElapsedSeconds(now = Date.now()): number {
    const entryId = this.data.activeEntryId;
    if (!entryId) return 0;
    const sessionMs = this.data.sessions
      .filter((s) => s.entryId === entryId)
      .reduce((acc, s) => {
        const start = new Date(s.startTime).getTime();
        const end = s.endTime ? new Date(s.endTime).getTime() : now;
        return acc + Math.max(0, end - start);
      }, 0);
    return (this.data.entryServerBase ?? 0) + Math.floor(sessionMs / 1000);
  }

  /**
   * Elapsed seconds for the current entry, clamped to the current local day.
   *
   * = entryServerBase (only if the entry started today — first local session ≥ midnight)
   * + sum of local sessions for activeEntryId, clamped to [local midnight, now]
   *
   * After midnight, a cross-day entry will show only the time accumulated
   * since midnight. entryServerBase is excluded for cross-day entries because
   * it was seeded from yesterday's accumulated task history.
   *
   * This is the authoritative value for the header and active task row.
   */
  getElapsedTodaySeconds(now = Date.now()): number {
    const entryId = this.data.activeEntryId;
    if (!entryId) return 0;

    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const midnight = todayStart.getTime();

    const entrySessions = this.data.sessions.filter((s) => s.entryId === entryId);

    // entryServerBase is today-scoped when:
    //   (a) the entry's first local session started today, OR
    //   (b) there are no local sessions at all — meaning the entry was synced from
    //       the server on startup (syncFromServer seeds entryServerBase from the
    //       server's elapsedToday, which is already day-scoped). Without this branch
    //       the "Worked Today" header would show 0 after an app restart even when
    //       hours have already been accumulated.
    // For entries whose first local session predates midnight (cross-midnight case),
    // the base was seeded for yesterday and must not pollute the new day's display.
    const entryStartedToday =
      entrySessions.length === 0 ||
      new Date(entrySessions[0].startTime).getTime() >= midnight;
    const base = entryStartedToday ? (this.data.entryServerBase ?? 0) : 0;

    const sessionMs = entrySessions.reduce((acc, s) => {
      const start = new Date(s.startTime).getTime();
      const end = s.endTime ? new Date(s.endTime).getTime() : now;
      const cStart = Math.max(start, midnight);
      const cEnd = Math.min(end, now);
      if (cEnd <= cStart) return acc;
      return acc + (cEnd - cStart);
    }, 0);

    return base + Math.floor(sessionMs / 1000);
  }

  /**
   * Total seconds worked today (all tasks, all devices).
   * = server's stopped-entries total (set via setWorkedTodayServerBase)
   * + active entry's today-elapsed (getElapsedTodaySeconds, 0 when stopped).
   *
   * The server base is refreshed on startup, after timer start/stop, and every 60s.
   */
  getWorkedTodaySeconds(): number {
    return this.runtime.workedTodayServerBase + this.getElapsedTodaySeconds();
  }

  /** Called by main process after fetching /api/agent/worked-today from server. */
  setWorkedTodayServerBase(seconds: number): void {
    this.runtime.workedTodayServerBase = seconds;
  }

  /**
   * Full state snapshot for IPC push to renderer(s).
   */
  getTimerState(): {
    status: string;
    entryId: string | null;
    taskId: string | null;
    elapsed: number;
    elapsedToday: number;
    workedToday: number;
    projectName: string | null;
    taskName: string | null;
    description: string | null;
  } {
    return {
      status: this.runtime.timerStatus,
      entryId: this.data.activeEntryId,
      taskId: this.data.activeTaskId,
      elapsed: this.getElapsedSeconds(),
      elapsedToday: this.getElapsedTodaySeconds(),
      workedToday: this.getWorkedTodaySeconds(),
      projectName: this.data.activeProjectName,
      taskName: this.data.activeTaskName,
      description: this.runtime.activeDescription,
    };
  }
}
