/**
 * Persistent store for agent session state and runtime timer state.
 *
 * Session data (deviceId, deviceToken, deviceName, userEmail) is persisted
 * to a JSON file in app.getPath("userData"). Survives restarts.
 *
 * Timer state uses session-based tracking: each start/resume creates a
 * TrackingSession with an ISO startTime. Elapsed time is derived from
 * session durations — never maintained as an incrementing counter.
 *
 * Up to three Timers can be active at once (#400, ADR-0031). Each keeps its
 * own entry, status and sessions; the single-Timer getters (getActiveEntryId,
 * getTimerStatus, getActiveProjectName…) describe the latest running Timer,
 * else the latest one, so the widget, the tray and the v1 screens still read
 * one Timer.
 */

import { app } from "electron";
import fs from "fs";
import path from "path";
import crypto from "crypto";
import { getLocalDayKey, getLocalDayWindowMs } from "./dayBoundary";
import { pausedSince } from "./pausedTimer";
import type { SavedUpdateRequired } from "./agentProtocol";
import {
  aggregateTimerStatus,
  coveredSeconds,
  isLocalEntryId,
  type StartMode,
  type TimerRunStatus,
} from "./simultaneousTimers";

/** One continuous run of the timer for a given time entry. */
export interface TrackingSession {
  id: string;
  entryId: string;       // backend time_entry id — groups sessions for the same entry
  taskId: string | null; // null for project-only (no task) entries
  startTime: string;     // ISO UTC
  endTime: string | null; // null = currently active
}

/** One active (running or paused) Timer. A stopped Timer is removed. */
export interface ActiveTimer {
  entryId: string;
  status: TimerRunStatus;
  crmProjectId: string | null;
  projectName: string | null;
  taskName: string | null;
  taskId: string | null;
  description: string | null;
  // Server-side accumulated elapsed (seconds) at the moment we first synced this entry.
  // Non-zero only when the entry was started on another device/client and we have no
  // local sessions yet. Once local sessions exist, they are authoritative.
  entryServerBase: number;
  // The part of entryServerBase that is the task's STOPPED history today.
  entryTaskHistoryToday: number;
  /** Wall-clock start of the entry (ISO). Used to apportion its duration into "today" on cross-midnight entries. */
  startTime: string | null;
}

/** A Timer as the server lists it (heartbeat `timers`, GET /api/agent/timers). */
export interface ServerTimer {
  entryId: string;
  status: string;
  duration: number;
  crmProjectId?: string | null;
  taskId?: string | null;
  lastActivityAt?: string | null;
  projectName?: string | null;
  taskName?: string | null;
  startTime?: string | Date | null;
}

/** What the renderer gets for each active Timer. */
export interface TimerView {
  entryId: string;
  status: TimerRunStatus;
  crmProjectId: string | null;
  projectName: string | null;
  taskName: string | null;
  taskId: string | null;
  description: string | null;
  elapsed: number;
  elapsedToday: number;
}

interface PersistedData {
  deviceId: string | null;
  deviceToken: string | null;
  deviceName: string | null;
  userEmail: string | null;
  /** Active Timers, oldest first. Persisted so names and status survive restarts. */
  timers: ActiveTimer[];
  // Source of truth for elapsed / worked-today calculations
  sessions: TrackingSession[];
  // Updated on each heartbeat/state change — used to close orphan sessions after crash
  lastActivityAt: string | null;
  /** User-selected display timezone for week/month aggregate boundaries. 'local' = OS timezone (default). 'utc' = UTC. */
  displayTimezone: 'local' | 'utc';
  /** Device-local preference: nudge when working with no timer running (issue #351). On unless turned off. */
  noTimerReminderEnabled: boolean;
  openAtLoginDefaulted?: boolean;
  /**
   * Which renderer booted last, so the next launch can create the right window.
   *
   * The UI is chosen in the renderer (localStorage, then DOCUFLOW_UI), but
   * `frame` and `transparent` are fixed at BrowserWindow construction — long
   * before any renderer runs. v2 draws its own title bar and needs a frameless
   * transparent window; v1 needs the OS one. The renderer reports which it is
   * once it has loaded, and the answer is used at the *next* launch.
   */
  uiMode: 'v1' | 'v2' | null;
  /** The server refused this agent's protocol version (#398); survives a restart so capture stays off at launch. */
  updateRequired: SavedUpdateRequired | null;
  /**
   * The Timers a switch not yet taken by the server stopped here (#400). The
   * server stops them only when it takes the switch: if it refuses, they come
   * back as they were rather than showing stopped until the next heartbeat.
   */
  switchedFrom: { entryId: string; timers: ActiveTimer[] } | null;
}

/** Fields of the single-Timer file (before #400), read once by the migration. */
const SINGLE_TIMER_KEYS = [
  "activeEntryId",
  "activeProjectName",
  "activeTaskName",
  "activeTaskId",
  "entryServerBase",
  "entryTaskHistoryToday",
  "timerStatus",
  "activeEntryStartTime",
] as const;

// Runtime-only state (not persisted)
interface RuntimeState {
  clientVersion: string;
  /**
   * Server's Worked Time today (all devices, running Timers included, counted
   * once) at the last read of /api/agent/worked-today?includeActive=1.
   * getWorkedTodaySeconds() = this + the seconds any local Timer ran since the read.
   */
  workedTodayServerBase: number;
  /** Simultaneous Time today at the same read. */
  simultaneousTodayServerBase: number;
  /** Epoch ms of that read. */
  workedTodayReadAt: number;
  /** Unix ms timestamp of when the Electron process started. Set once by main via
   *  setSessionStartedAt(). Used to compute "This session" elapsed. */
  sessionStartedAt: number;
}

const CONFIG_FILENAME = "agent-config.json";
const MAX_SESSION_AGE_MS = 90 * 24 * 60 * 60 * 1000; // 90 days
const MAX_SESSIONS = 1000;

const num = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? v : 0);
const strOrNull = (v: unknown): string | null => (typeof v === "string" ? v : null);

function readTimer(raw: any): ActiveTimer | null {
  if (!raw || typeof raw.entryId !== "string") return null;
  if (raw.status !== "running" && raw.status !== "paused") return null;
  return {
    entryId: raw.entryId,
    status: raw.status,
    crmProjectId: strOrNull(raw.crmProjectId),
    projectName: strOrNull(raw.projectName),
    taskName: strOrNull(raw.taskName),
    taskId: strOrNull(raw.taskId),
    description: strOrNull(raw.description),
    entryServerBase: num(raw.entryServerBase),
    entryTaskHistoryToday: num(raw.entryTaskHistoryToday),
    startTime: strOrNull(raw.startTime),
  };
}

/** The single-Timer file's active entry as one Timer (none when it was stopped). */
function migrateSingleTimer(parsed: any): ActiveTimer[] {
  if (typeof parsed.activeEntryId !== "string" || !parsed.activeEntryId) return [];
  // Pre-March-27 JSON has no timerStatus: an active entry was running at shutdown.
  const status = parsed.timerStatus ?? "running";
  if (status !== "running" && status !== "paused") return [];
  return [{
    entryId: parsed.activeEntryId,
    status,
    crmProjectId: null,
    projectName: strOrNull(parsed.activeProjectName),
    taskName: strOrNull(parsed.activeTaskName),
    taskId: strOrNull(parsed.activeTaskId),
    description: null,
    entryServerBase: num(parsed.entryServerBase),
    entryTaskHistoryToday: num(parsed.entryTaskHistoryToday),
    startTime: strOrNull(parsed.activeEntryStartTime),
  }];
}

export class AgentStore {
  private data: PersistedData;
  private runtime: RuntimeState;
  private configPath: string;

  constructor() {
    this.configPath = path.join(app.getPath("userData"), CONFIG_FILENAME);
    this.data = this.loadFromDisk();
    this.runtime = {
      clientVersion: "0.1.0",
      workedTodayServerBase: 0,
      simultaneousTodayServerBase: 0,
      workedTodayReadAt: Date.now(),
      sessionStartedAt: Date.now(),
    };
  }

  // ─── Disk persistence ───

  private loadFromDisk(): PersistedData {
    const empty: PersistedData = {
      deviceId: null,
      deviceToken: null,
      deviceName: null,
      userEmail: null,
      timers: [],
      sessions: [],
      lastActivityAt: null,
      displayTimezone: 'local',
      noTimerReminderEnabled: true,
      uiMode: null,
      updateRequired: null,
      switchedFrom: null,
    };
    try {
      if (!fs.existsSync(this.configPath)) return empty;
      const raw = fs.readFileSync(this.configPath, "utf-8");
      const parsed = JSON.parse(raw);
      const timers = Array.isArray(parsed.timers)
        ? parsed.timers.map(readTimer).filter((t: ActiveTimer | null): t is ActiveTimer => t !== null)
        // Migration (#400): the single-Timer file becomes a list of one.
        : migrateSingleTimer(parsed);
      const rest = { ...parsed };
      for (const key of SINGLE_TIMER_KEYS) delete rest[key];
      return {
        ...empty,
        ...rest,
        timers,
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
  getUpdateRequired(): SavedUpdateRequired | null { return this.data.updateRequired ?? null; }
  setUpdateRequired(v: SavedUpdateRequired | null): void {
    this.data.updateRequired = v;
    this.saveToDisk();
  }
  setClientVersion(v: string): void { this.runtime.clientVersion = v; }

  getUiMode(): 'v1' | 'v2' | null { return this.data.uiMode ?? null; }
  setUiMode(mode: 'v1' | 'v2'): void {
    if (this.data.uiMode === mode) return;
    this.data.uiMode = mode;
    this.saveToDisk();
  }

  getDisplayTimezone(): 'local' | 'utc' { return this.data.displayTimezone ?? 'local'; }
  setDisplayTimezone(tz: 'local' | 'utc'): void {
    this.data.displayTimezone = tz;
    this.saveToDisk();
  }

  getNoTimerReminderEnabled(): boolean { return this.data.noTimerReminderEnabled ?? true; }
  setNoTimerReminderEnabled(enabled: boolean): void {
    this.data.noTimerReminderEnabled = enabled;
    this.saveToDisk();
  }

  getOpenAtLoginDefaulted(): boolean { return this.data.openAtLoginDefaulted ?? false; }
  setOpenAtLoginDefaulted(done: boolean): void {
    this.data.openAtLoginDefaulted = done;
    this.saveToDisk();
  }

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
    this.data.updateRequired = null;
    this.saveToDisk();
    this.clearTimer();
    this.setWorkedTodayServerBase(0, 0);
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

  /** The Timer the single-Timer getters describe: the latest running, else the latest. */
  private primary(): ActiveTimer | null {
    const timers = this.data.timers;
    for (let i = timers.length - 1; i >= 0; i--) {
      if (timers[i].status === "running") return timers[i];
    }
    return timers[timers.length - 1] ?? null;
  }

  /** A Timer by entry id; the primary one when `entryId` is undefined. */
  private find(entryId?: string | null): ActiveTimer | null {
    if (entryId === undefined) return this.primary();
    return this.data.timers.find((t) => t.entryId === entryId) ?? null;
  }

  /** Active Timers, oldest first (copies). */
  getTimers(): ActiveTimer[] {
    return this.data.timers.map((t) => ({ ...t }));
  }

  getTimer(entryId: string): ActiveTimer | null {
    const t = this.find(entryId);
    return t ? { ...t } : null;
  }

  getRunningEntryIds(): string[] {
    return this.data.timers.filter((t) => t.status === "running").map((t) => t.entryId);
  }

  getActiveEntryId(): string | null { return this.primary()?.entryId ?? null; }
  /** Running if any Timer runs, paused if any exists, else stopped. */
  getTimerStatus(): string { return aggregateTimerStatus(this.data.timers); }
  /**
   * The entry a capture is presigned with: the latest running Timer the server
   * knows. The server attaches the capture to every other Timer running then.
   */
  getCaptureEntryId(): string | null {
    const running = this.data.timers.filter((t) => t.status === "running");
    const known = running.filter((t) => !isLocalEntryId(t.entryId));
    return (known[known.length - 1] ?? running[running.length - 1])?.entryId ?? null;
  }
  /** When a Timer (the primary one by default) has been paused since; null when not paused (see lib/pausedTimer.ts). */
  getPausedSince(entryId?: string): Date | null {
    const t = this.find(entryId);
    if (!t) return null;
    return pausedSince({
      timerStatus: t.status,
      activeEntryId: t.entryId,
      activeEntryStartTime: t.startTime,
      sessions: this.data.sessions,
    });
  }
  getActiveProjectName(): string | null { return this.primary()?.projectName ?? null; }
  getActiveTaskName(): string | null { return this.primary()?.taskName ?? null; }
  getActiveTaskId(): string | null { return this.primary()?.taskId ?? null; }
  getActiveDescription(): string | null { return this.primary()?.description ?? null; }

  /**
   * Start a Timer. `switch` (the default, and the only way with one Timer)
   * closes every other Timer first; `add` keeps them. Starting an entry that is
   * already active resumes it.
   */
  startTimer(opts: {
    entryId: string;
    crmProjectId?: string | null;
    projectName: string | null;
    taskId: string | null;
    taskName?: string | null;
    description?: string | null;
    /**
     * Stopped-entry history for this task today (seconds), as returned by the
     * server's timer/start response (`taskAccumulatedToday`). Seeds entryServerBase
     * so elapsed starts from the accumulated total rather than 0.
     */
    taskAccumulatedToday?: number;
    mode?: StartMode;
  }): void {
    if (this.find(opts.entryId)) {
      this.resumeTimer(opts.entryId);
      return;
    }
    if (opts.mode !== "add") {
      // The server stops the other Timers on a switch; kept until it answers.
      this.data.switchedFrom = this.data.timers.length > 0
        ? { entryId: opts.entryId, timers: this.data.timers.map((t) => ({ ...t })) }
        : null;
      this.closeSessions();
      this.data.timers = [];
    }
    const startTime = new Date().toISOString();
    const history = opts.taskAccumulatedToday ?? 0;
    this.data.timers.push({
      entryId: opts.entryId,
      status: "running",
      crmProjectId: opts.crmProjectId ?? null,
      projectName: opts.projectName ?? null,
      taskName: opts.taskName ?? null,
      taskId: opts.taskId ?? null,
      description: opts.description ?? null,
      entryServerBase: history,
      entryTaskHistoryToday: history,
      startTime,
    });
    this.openSession(opts.entryId, opts.taskId ?? null, startTime);
    this.pruneSessions();
    this.data.lastActivityAt = new Date().toISOString();
    this.saveToDisk();
  }

  /**
   * Start (or switch to) a running timer, as with one Timer: an entry already
   * active resumes, any other entry replaces every active Timer.
   */
  setTimerRunning(
    entryId: string,
    projectName: string | null,
    taskId: string | null,
    taskName?: string | null,
    description?: string | null,
    taskAccumulatedToday = 0,
  ): void {
    if (this.find(entryId)) {
      this.resumeTimer(entryId);
      return;
    }
    this.startTimer({ entryId, projectName, taskId, taskName, description, taskAccumulatedToday, mode: "switch" });
  }

  /** Run a Timer again: opens a session unless one is already open. Returns false when the Timer is unknown. */
  resumeTimer(entryId: string): boolean {
    const t = this.find(entryId);
    if (!t) return false;
    if (!this.data.sessions.some((s) => s.entryId === entryId && s.endTime === null)) {
      this.openSession(entryId, t.taskId, new Date().toISOString());
      this.pruneSessions();
    }
    t.status = "running";
    this.data.lastActivityAt = new Date().toISOString();
    this.saveToDisk();
    return true;
  }

  /** Resume these Timers where they are paused; returns the ones resumed. */
  resumeTimers(entryIds: readonly string[]): string[] {
    const resumed: string[] = [];
    for (const id of entryIds) {
      const t = this.find(id);
      if (t && t.status === "paused" && this.resumeTimer(id)) resumed.push(id);
    }
    return resumed;
  }

  /**
   * Pause one Timer.
   * @param at  Optional: close its session at this timestamp (idle and away
   *            pauses, so the time since the Member left is excluded).
   */
  pauseTimer(entryId: string, at?: Date): boolean {
    const t = this.find(entryId);
    if (!t) return false;
    this.closeSessions(entryId, at);
    t.status = "paused";
    this.data.lastActivityAt = new Date().toISOString();
    this.saveToDisk();
    return true;
  }

  /** Pause every running Timer at `at` (or now); returns the ones paused. */
  pauseRunningTimers(at?: Date): string[] {
    const ids = this.getRunningEntryIds();
    for (const id of ids) this.pauseTimer(id, at);
    return ids;
  }

  /** Pause every running timer (with one Timer: the running timer). */
  setTimerPaused(at?: Date): void {
    this.pauseRunningTimers(at);
  }

  /** Stop one Timer: its running session closes at `at` (or now) and it leaves the list. */
  stopTimer(entryId: string, at?: Date): boolean {
    const t = this.find(entryId);
    if (!t) return false;
    this.closeSessions(entryId, at);
    this.data.timers = this.data.timers.filter((x) => x.entryId !== entryId);
    this.data.lastActivityAt = new Date().toISOString();
    this.saveToDisk();
    return true;
  }

  /**
   * Forget a Timer the server never recorded (a refused start, #400): the Timer
   * and its sessions go, so its seconds count nowhere.
   */
  discardTimer(entryId: string): void {
    this.data.timers = this.data.timers.filter((t) => t.entryId !== entryId);
    this.data.sessions = this.data.sessions.filter((s) => s.entryId !== entryId);
    const switched = this.data.switchedFrom;
    if (switched && switched.entryId === entryId) {
      // A refused switch stopped nothing on the server: its Timers run on from now.
      this.data.timers = [...switched.timers, ...this.data.timers];
      const now = new Date().toISOString();
      for (const t of switched.timers) {
        if (t.status === "running") this.openSession(t.entryId, t.taskId, now);
      }
    }
    this.data.switchedFrom = null;
    this.saveToDisk();
  }

  /** The server took this start: a switch's Timers are stopped for good. */
  startTaken(entryId: string): void {
    if (!this.data.switchedFrom || this.data.switchedFrom.entryId !== entryId) return;
    this.data.switchedFrom = null;
    this.saveToDisk();
  }

  /** Stop every Timer; returns the ones stopped. */
  stopAllTimers(at?: Date): string[] {
    const ids = this.data.timers.map((t) => t.entryId);
    for (const id of ids) this.stopTimer(id, at);
    return ids;
  }

  /** Stop every timer and clear all active context. */
  clearTimer(): void {
    this.closeSessions();
    this.data.timers = [];
    this.data.lastActivityAt = new Date().toISOString();
    this.saveToDisk();
  }

  /** Record heartbeat timestamp and persist so crash-recovery end-time is accurate. */
  touchActivity(): void {
    this.data.lastActivityAt = new Date().toISOString();
    this.saveToDisk();
  }

  private openSession(entryId: string, taskId: string | null, startTime: string): void {
    this.data.sessions.push({ id: crypto.randomUUID(), entryId, taskId, startTime, endTime: null });
  }

  /** Close open sessions (of one entry, or all) at `at`, never before they began. */
  private closeSessions(entryId?: string, at?: Date): void {
    const atMs = (at ?? new Date()).getTime();
    for (const s of this.data.sessions) {
      if (s.endTime !== null || (entryId !== undefined && s.entryId !== entryId)) continue;
      s.endTime = new Date(Math.max(atMs, new Date(s.startTime).getTime())).toISOString();
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
    // Timer status is NOT reset here — it stays at its persisted value ("running" if the
    // timer was active at shutdown). autoResumeFromQueue() reads it to reopen the timer.
    this.saveToDisk();
  }

  /**
   * Update a local placeholder entry ID to the real server-assigned ID.
   * Called by SyncWorker after a start command syncs successfully.
   * Updates that Timer and all sessions that reference the old placeholder.
   */
  updateActiveEntryId(oldId: string, newId: string): void {
    for (const t of this.data.timers) {
      if (t.entryId === oldId) t.entryId = newId;
    }
    for (const session of this.data.sessions) {
      if (session.entryId === oldId) {
        session.entryId = newId;
      }
    }
    this.saveToDisk();
  }

  /**
   * Called by SyncWorker after a start command syncs successfully.
   * Seeds entryServerBase from the server's taskAccumulatedToday so the UI
   * shows accumulated task time (e.g. 30:00) instead of 0:00 when restarting a task.
   * `entryId` is the Timer whose start synced (the primary one when absent).
   */
  applyTaskAccumulatedToday(seconds: number, entryId?: string): void {
    const t = this.find(entryId);
    if (!t) return;
    t.entryServerBase = seconds;
    t.entryTaskHistoryToday = seconds;
    this.saveToDisk();
  }

  // ─── Server sync ───

  /**
   * Apply server-authoritative state for one Timer, as with one Timer: the
   * entry becomes the only active Timer, and a stopped or absent entry clears them.
   */
  syncFromServer(entry: {
    id: string;
    status: string;
    duration: number;
    taskId?: string | null;
    lastActivityAt?: string | null;
    projectName?: string | null;
    taskName?: string | null;
    /** Wall-clock start of the entry — required for correct elapsed-today when entry spans calendar days */
    startTime?: string | Date | null;
  } | null): void {
    const { id, ...rest } = entry ?? { id: "" };
    this.applyServerTimers(entry && entry.status !== "stopped" ? [{ entryId: id, ...(rest as Omit<ServerTimer, "entryId">) }] : []);
  }

  /**
   * Apply the server's list of active Timers (newest first, as the server sends it).
   *
   * A local Timer the server no longer lists is stopped here. Each listed Timer
   * gets the server's status; names fill in when not already known locally. A
   * Timer with no local sessions yet (started on another device) is seeded from
   * the server's accumulated duration so its clock shows the full elapsed.
   */
  applyServerTimers(list: readonly ServerTimer[]): void {
    const listed = list.filter((s) => s.status === "running" || s.status === "paused");
    const ids = new Set(listed.map((s) => s.entryId));
    for (const t of this.data.timers) {
      if (!ids.has(t.entryId)) this.closeSessions(t.entryId);
    }

    const now = Date.now();
    const next: ActiveTimer[] = [];
    for (const s of [...listed].reverse()) {
      const t: ActiveTimer = this.data.timers.find((x) => x.entryId === s.entryId) ?? {
        entryId: s.entryId,
        status: "paused",
        crmProjectId: null,
        projectName: null,
        taskName: null,
        taskId: null,
        description: null,
        entryServerBase: 0,
        entryTaskHistoryToday: 0,
        startTime: null,
      };
      if (s.startTime) {
        t.startTime = typeof s.startTime === "string" ? s.startTime : s.startTime.toISOString();
      }
      if (!t.crmProjectId && s.crmProjectId) t.crmProjectId = s.crmProjectId;
      if (!t.projectName && s.projectName) t.projectName = s.projectName;
      if (!t.taskName && s.taskName) t.taskName = s.taskName;
      if (!t.taskId && s.taskId) t.taskId = s.taskId;

      // Seed entryServerBase when we have no local sessions for this entry yet.
      // This handles timer started on another device: desktop would otherwise
      // show only the ~0s since sync instead of the full accumulated elapsed.
      if (!this.data.sessions.some((x) => x.entryId === s.entryId)) {
        const lastActivity = s.lastActivityAt ? new Date(s.lastActivityAt).getTime() : now;
        const gapSeconds = Math.max(0, Math.floor((now - lastActivity) / 1000));
        const computed = (s.duration ?? 0) + gapSeconds;
        // Always take the larger estimate (improves on every sync until local sessions exist)
        if (computed > t.entryServerBase) t.entryServerBase = computed;
      }

      const open = this.data.sessions.some((x) => x.entryId === s.entryId && x.endTime === null);
      if (s.status === "running" && !open) {
        this.openSession(s.entryId, t.taskId, new Date(now).toISOString());
      } else if (s.status === "paused" && open) {
        this.closeSessions(s.entryId);
      }
      t.status = s.status as TimerRunStatus;
      next.push(t);
    }
    this.data.timers = next;
    if (next.length > 0) this.data.lastActivityAt = new Date(now).toISOString();
    this.saveToDisk();
  }

  // ─── Derived selectors ───

  /** The primary Timer's open session. */
  getActiveSession(): TrackingSession | null {
    const entryId = this.primary()?.entryId;
    if (!entryId) return null;
    return this.data.sessions.find((s) => s.entryId === entryId && s.endTime === null) ?? null;
  }

  getSessions(): TrackingSession[] {
    return this.data.sessions;
  }

  /**
   * Elapsed seconds for a Timer's entry (the primary Timer by default), total, unclamped.
   *
   * = entryServerBase (server-accumulated before first desktop session)
   * + sum of ALL local sessions for the entry
   *
   * NOT clamped to the current day. Use getElapsedTodaySeconds() for display.
   */
  getElapsedSeconds(now = Date.now(), entryId?: string): number {
    const t = this.find(entryId);
    if (!t) return 0;
    const sessionMs = this.data.sessions
      .filter((s) => s.entryId === t.entryId)
      .reduce((acc, s) => {
        const start = new Date(s.startTime).getTime();
        const end = s.endTime ? new Date(s.endTime).getTime() : now;
        return acc + Math.max(0, end - start);
      }, 0);
    return (t.entryServerBase ?? 0) + Math.floor(sessionMs / 1000);
  }

  /**
   * Wall end (ms) of a Timer's tracked span: last session end, or now if running,
   * or lastActivityAt if paused with no sessions yet. Used so "today" apportioning does not
   * shrink as wall clock advances during idle after a pause.
   */
  private getSpanWallEndMs(t: ActiveTimer, now: number): number {
    const se = this.data.sessions.filter((s) => s.entryId === t.entryId);
    if (se.length === 0) {
      if (t.status === "paused" && this.data.lastActivityAt) {
        return new Date(this.data.lastActivityAt).getTime();
      }
      return now;
    }
    return Math.max(...se.map((s) => new Date(s.endTime || now).getTime()));
  }

  /**
   * Elapsed seconds for a Timer's entry (the primary Timer by default), clamped
   * to the current local day. A task counts its time in full, Simultaneous Time
   * included (ADR-0031).
   *
   * When the entry's start time is known: apportions **total** active seconds (getElapsedSeconds)
   * into "today" using the overlap of [entry wall start, span end] with [local midnight, end of day],
   * matching server-side stopped-entry clamping for cross-midnight entries.
   *
   * Legacy fallback (no start time in persisted JSON): previous base+session-day-clamp.
   */
  getElapsedTodaySeconds(now = Date.now(), entryId?: string): number {
    const t = this.find(entryId);
    if (!t) return 0;

    const { startMs: midnight, endMs } = getLocalDayWindowMs(now);
    const endMsClamped = Math.min(endMs, now);

    if (t.startTime) {
      const startMs = new Date(t.startTime).getTime();
      const totalActive = this.getElapsedSeconds(now, t.entryId);
      const spanEnd = this.getSpanWallEndMs(t, now);
      const totalWallMs = Math.max(1, spanEnd - startMs);
      const overlapStart = Math.max(startMs, midnight);
      const overlapEnd = Math.min(spanEnd, endMsClamped, now);
      const inWindowMs = Math.max(0, overlapEnd - overlapStart);
      if (inWindowMs <= 0) return 0;
      return Math.round(totalActive * (inWindowMs / totalWallMs));
    }

    const entrySessions = this.data.sessions.filter((s) => s.entryId === t.entryId);

    const entryStartedToday =
      entrySessions.length === 0 ||
      new Date(entrySessions[0].startTime).getTime() >= midnight;
    const base = entryStartedToday ? (t.entryServerBase ?? 0) : 0;

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

  /** Seconds since the last server read (and since local midnight) during which any local Timer ran, and two or more did. */
  private liveSinceRead(now: number): { any: number; simultaneous: number } {
    const from = Math.max(this.runtime.workedTodayReadAt, getLocalDayWindowMs(now).startMs);
    return coveredSeconds(
      this.data.sessions.map((s) => ({
        start: new Date(s.startTime).getTime(),
        end: s.endTime ? new Date(s.endTime).getTime() : now,
      })),
      from,
      now,
    );
  }

  /**
   * Worked Time today (all tasks, all devices), counted once however many Timers ran.
   * = the server's total at the last read (running Timers included)
   * + the seconds since that read during which at least one local Timer ran.
   *
   * The server total is refreshed on startup, after each synced timer command, and every 60s.
   */
  getWorkedTodaySeconds(now = Date.now()): number {
    return this.runtime.workedTodayServerBase + this.liveSinceRead(now).any;
  }

  /** Simultaneous Time today: the part of Worked Time during which two or more Timers ran. */
  getSimultaneousTodaySeconds(now = Date.now()): number {
    return this.runtime.simultaneousTodayServerBase + this.liveSinceRead(now).simultaneous;
  }

  /** Called by main process after fetching /api/agent/worked-today?includeActive=1 from server. */
  setWorkedTodayServerBase(seconds: number, simultaneous = 0): void {
    this.runtime.workedTodayServerBase = seconds;
    this.runtime.simultaneousTodayServerBase = simultaneous;
    this.runtime.workedTodayReadAt = Date.now();
  }

  /** Called once by main process at startup to anchor the session boundary. */
  setSessionStartedAt(ts: number): void {
    this.runtime.sessionStartedAt = ts;
  }

  /**
   * Seconds any timer was running since this app launch (all entries, counted once).
   * = local sessions with startTime >= sessionStartedAt.
   * Not day-scoped. Resets to 0 on app/PC restart.
   */
  getThisSessionSeconds(now = Date.now()): number {
    const anchor = this.runtime.sessionStartedAt;
    return coveredSeconds(
      this.data.sessions
        .filter((s) => new Date(s.startTime).getTime() >= anchor)
        .map((s) => ({
          start: new Date(s.startTime).getTime(),
          end: s.endTime ? new Date(s.endTime).getTime() : now,
        })),
      anchor,
      now,
    ).any;
  }

  /**
   * Full state snapshot for IPC push to renderer(s). The top-level fields
   * describe the primary Timer; `timers` lists every active one.
   */
  getTimerState(): {
    status: string;
    entryId: string | null;
    taskId: string | null;
    elapsed: number;
    elapsedToday: number;
    workedToday: number;
    simultaneousToday: number;
    thisSession: number;
    dayKey: string;
    projectName: string | null;
    taskName: string | null;
    description: string | null;
    timers: TimerView[];
  } {
    const now = Date.now();
    const primary = this.primary();
    return {
      status: this.getTimerStatus(),
      entryId: primary?.entryId ?? null,
      taskId: primary?.taskId ?? null,
      elapsed: this.getElapsedSeconds(now),
      elapsedToday: this.getElapsedTodaySeconds(now),
      workedToday: this.getWorkedTodaySeconds(now),
      simultaneousToday: this.getSimultaneousTodaySeconds(now),
      thisSession: this.getThisSessionSeconds(now),
      dayKey: getLocalDayKey(),
      projectName: primary?.projectName ?? null,
      taskName: primary?.taskName ?? null,
      description: primary?.description ?? null,
      timers: this.data.timers.map((t) => ({
        entryId: t.entryId,
        status: t.status,
        crmProjectId: t.crmProjectId,
        projectName: t.projectName,
        taskName: t.taskName,
        taskId: t.taskId,
        description: t.description,
        elapsed: this.getElapsedSeconds(now, t.entryId),
        elapsedToday: this.getElapsedTodaySeconds(now, t.entryId),
      })),
    };
  }
}
