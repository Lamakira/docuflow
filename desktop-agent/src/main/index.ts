/**
 * DocuFlow Desktop Agent — Main process entry point.
 *
 * Phase 3 MVP — Pairing + Timer control + Workers.
 */

import { app, BrowserWindow, Tray, Menu, ipcMain, shell, screen } from "electron";
import path from "path";
import fs from "fs";
import os from "os";
import { randomUUID } from "node:crypto";
import { API_BASE, API_BASE_SOURCE, API_HOST } from "../lib/config";

// ─── Linux / Wayland ───
// Enable PipeWire-based screen capture so desktopCapturer works under Wayland
// (Ubuntu 22.04+ defaults to Wayland). Must be called before app.whenReady().
if (process.platform === "linux") {
  app.commandLine.appendSwitch("enable-features", "WebRTCPipeWireCapturer");
}

// ─── File logger ───
// Writes to the platform userData dir — readable without DevTools.
//   Windows : %APPDATA%\docuflow-desktop-agent\debug.log
//   Linux   : ~/.config/docuflow-desktop-agent/debug.log
//   macOS   : ~/Library/Application Support/docuflow-desktop-agent/debug.log
let logStream: fs.WriteStream | null = null;
function initLogger() {
  try {
    const logPath = path.join(app.getPath("userData"), "debug.log");
    logStream = fs.createWriteStream(logPath, { flags: "a" });
    const orig = console.log.bind(console);
    const origWarn = console.warn.bind(console);
    const origErr = console.error.bind(console);
    const write = (level: string, args: any[]) => {
      const line = `${new Date().toISOString()} [${level}] ${args.map(String).join(" ")}\n`;
      logStream?.write(line);
    };
    console.log = (...args) => { orig(...args); write("INFO", args); };
    console.warn = (...args) => { origWarn(...args); write("WARN", args); };
    console.error = (...args) => { origErr(...args); write("ERROR", args); };
    const sourceLabel = API_BASE_SOURCE === "file" ? "~/.docuflow-url" : API_BASE_SOURCE;
    console.log(`[Main] log started — API_BASE=${API_BASE} (source: ${sourceLabel})`);
  } catch { /* non-fatal */ }
}

declare const MAIN_WINDOW_WEBPACK_ENTRY: string;
declare const MAIN_WINDOW_PRELOAD_WEBPACK_ENTRY: string;
declare const WIDGET_WINDOW_WEBPACK_ENTRY: string;
declare const WIDGET_WINDOW_PRELOAD_WEBPACK_ENTRY: string;

import { AgentStore } from "../lib/AgentStore";
import { SqliteQueue } from "../lib/SqliteQueue";
import { ApiClient } from "../lib/ApiClient";
import { HeartbeatWorker } from "../workers/HeartbeatWorker";
import { ActivityWorker } from "../workers/ActivityWorker";
import { SyncWorker } from "../workers/SyncWorker";
import { ScreenCaptureWorker } from "../workers/ScreenCaptureWorker";

let mainWindow: BrowserWindow | null = null;
let widgetWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
/** Set by the user clicking ×. Cleared when the timer stops so the next session shows the widget again. */
let widgetDismissed = false;

const WIDGET_WIDTH = 340;
const WIDGET_HEIGHT = 64;
const WIDGET_MARGIN = 20;

const SESSION_STARTED_AT = Date.now(); // anchors "This session" elapsed; resets on restart
const store = new AgentStore();
store.setSessionStartedAt(SESSION_STARTED_AT);
// Pass userData path so SQLite DB survives restarts
const queue = new SqliteQueue(app.getPath("userData"));

/**
 * Called by ApiClient when the server signals this device is revoked or
 * permanently invalid (401/403 on token refresh). Cleans up all local state
 * so the renderer returns to the login screen.
 */
function handleDeviceRevoked(): void {
  console.log("[Main] device.revoked — stopping workers and clearing session");
  stopWorkers();
  store.clearSession();
  pushStateToRenderer();
}

const apiClient = new ApiClient(store, handleDeviceRevoked);

// Feature flag: enabled by default in dev; set SCREENSHOTS_ENABLED=false to disable
const SCREENSHOTS_ENABLED = process.env.SCREENSHOTS_ENABLED !== "false";

let heartbeatWorker: HeartbeatWorker | null = null;
let activityWorker: ActivityWorker | null = null;
let syncWorker: SyncWorker | null = null;
let screenshotWorker: ScreenCaptureWorker | null = null;
let resyncInterval: ReturnType<typeof setInterval> | null = null;
let workedTodayInterval: ReturnType<typeof setInterval> | null = null;

// ─── Window ───

function createMainWindow(): BrowserWindow {
  const iconPath = app.isPackaged
    ? path.join(process.resourcesPath, "assets", "icon.png")
    : path.join(__dirname, "../../assets/icon.png");

  const win = new BrowserWindow({
    width: 680,
    height: 780,
    minWidth: 400,
    minHeight: 500,
    resizable: true,
    backgroundColor: '#0f172a',
    show: false,
    icon: iconPath,
    webPreferences: {
      preload: MAIN_WINDOW_PRELOAD_WEBPACK_ENTRY,
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  win.loadURL(MAIN_WINDOW_WEBPACK_ENTRY);
  console.log(`[Main] window.loadURL — ${MAIN_WINDOW_WEBPACK_ENTRY}`);

  win.webContents.on("did-finish-load", () => {
    console.log("[Main] renderer did-finish-load");
  });
  win.webContents.on("did-fail-load", (_e, code, desc) => {
    console.error(`[Main] renderer did-fail-load — code=${code} desc=${desc}`);
  });
  win.webContents.on("console-message", (_e, level, msg, line, src) => {
    const lvl = ["verbose","info","warn","error"][level] ?? "info";
    console.log(`[Renderer:${lvl}] ${msg} (${src}:${line})`);
  });
  win.webContents.on("render-process-gone", (_e, details) => {
    console.error(`[Main] render-process-gone — reason=${details.reason} exitCode=${details.exitCode}`);
  });
  win.webContents.on("unresponsive", () => {
    console.warn("[Main] renderer unresponsive");
  });

  win.once("ready-to-show", () => {
    // setAlwaysOnTop bypasses Windows 11 focus-stealing prevention
    win.setAlwaysOnTop(true);
    win.show();
    win.focus();
    win.setAlwaysOnTop(false);
    console.log("[Main] window shown");
  });

  // Ctrl+Shift+I → open DevTools (useful for debugging login/connection issues)
  win.webContents.on("before-input-event", (_event, input) => {
    if (input.control && input.shift && input.key === "I") {
      win.webContents.openDevTools({ mode: "detach" });
    }
  });

  win.on("close", (e) => {
    e.preventDefault();
    win.hide();
  });

  return win;
}

// ─── Widget window ───

function createWidgetWindow(): BrowserWindow {
  const { workArea } = screen.getPrimaryDisplay();
  const x = workArea.x + workArea.width - WIDGET_WIDTH - WIDGET_MARGIN;
  const y = workArea.y + workArea.height - WIDGET_HEIGHT - WIDGET_MARGIN;

  const win = new BrowserWindow({
    width: WIDGET_WIDTH,
    height: WIDGET_HEIGHT,
    x,
    y,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    resizable: false,
    movable: true,
    skipTaskbar: true,
    show: false,
    hasShadow: false,
    webPreferences: {
      preload: WIDGET_WINDOW_PRELOAD_WEBPACK_ENTRY,
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  win.loadURL(WIDGET_WINDOW_WEBPACK_ENTRY);
  win.setAlwaysOnTop(true, "floating");

  win.webContents.on("did-finish-load", () => {
    console.log("[Widget] renderer ready");
  });

  // Clamp position after drag so the widget can never be moved off-screen
  win.on("moved", () => {
    const { x, y, width, height } = win.getBounds();
    const { workArea } = screen.getPrimaryDisplay();
    const cx = Math.max(workArea.x, Math.min(x, workArea.x + workArea.width - width));
    const cy = Math.max(workArea.y, Math.min(y, workArea.y + workArea.height - height));
    if (cx !== x || cy !== y) win.setPosition(cx, cy);
  });

  // Prevent accidental close
  win.on("close", (e) => {
    e.preventDefault();
    win.hide();
  });

  return win;
}

/** Show or hide the widget based on timer status and dismissed flag. */
function syncWidgetVisibility(status: string): void {
  if (!widgetWindow) return;
  if (status === "stopped") {
    // Reset dismissed so the widget reappears on the next timer session
    widgetDismissed = false;
    if (widgetWindow.isVisible()) widgetWindow.hide();
  } else if (!widgetDismissed) {
    if (!widgetWindow.isVisible()) widgetWindow.show();
  }
}

// ─── Window helpers ───

/**
 * Show the main window. If the user is not yet paired (login screen),
 * reload the page first so the form is always blank on reopen.
 */
function showMainWindow(): void {
  if (!mainWindow) return;
  if (!store.isPaired()) {
    mainWindow.webContents.reload();
  }
  mainWindow.setAlwaysOnTop(true);
  mainWindow.show();
  mainWindow.focus();
  mainWindow.setAlwaysOnTop(false);
}

// ─── Tray ───

function getTrayIconPath(): string {
  // In production (packaged), __dirname points inside .webpack/main
  // which is inside app.asar. Assets need to be resolved relative to the app root.
  if (app.isPackaged) {
    // Packaged: resources/app.asar/.webpack/main → go up to resources/
    return path.join(process.resourcesPath, "assets", "icon.png");
  }
  // Dev: .webpack/main → ../../assets/
  return path.join(__dirname, "../../assets/icon.png");
}

function createTray(): void {
  try {
    tray = new Tray(getTrayIconPath());
  } catch (err) {
    console.warn("[Main] Tray icon not found, skipping tray:", (err as Error).message);
    return;
  }

  const contextMenu = Menu.buildFromTemplate([
    { label: "Show Agent", click: () => showMainWindow() },
    { label: "Status: " + (store.isPaired() ? "Connected" : "Not paired"), enabled: false },
    { type: "separator" },
    { label: "Quit", click: () => { stopWorkers(); app.exit(0); } },
  ]);

  tray.setToolTip("DocuFlow Desktop Agent");
  tray.setContextMenu(contextMenu);
  tray.on("click", () => showMainWindow());
}

// ─── Workers ───

function startWorkers(): void {
  if (!store.isPaired()) return;

  heartbeatWorker = new HeartbeatWorker(apiClient, store, applyServerTimerSync, (policy) => {
    screenshotWorker?.applyPolicy(policy);
  });
  heartbeatWorker.start();

  activityWorker = new ActivityWorker(queue, store);
  activityWorker.setIdleUxCallback((idleSeconds) => handleIdleUx(idleSeconds));
  activityWorker.start();

  syncWorker = new SyncWorker(apiClient, queue, store);
  syncWorker.start();

  screenshotWorker = new ScreenCaptureWorker(queue, store, SCREENSHOTS_ENABLED);
  if (activityWorker) screenshotWorker.setActivityWorker(activityWorker);
  screenshotWorker.start();

  // Create floating widget if it doesn't exist yet
  if (!widgetWindow) {
    widgetWindow = createWidgetWindow();
  }

  startResyncPolling();

  // Refresh worked-today server base every 60s so multi-device entries are reflected.
  workedTodayInterval = setInterval(async () => {
    await refreshWorkedTodayServerBase();
    pushStateToRenderer();
  }, 60_000);

  console.log(`[Main] Workers started (screenshots: ${SCREENSHOTS_ENABLED})`);
}

function stopWorkers(): void {
  heartbeatWorker?.stop();
  activityWorker?.stop();
  syncWorker?.stop();
  screenshotWorker?.stop();
  stopResyncPolling();
  if (workedTodayInterval) {
    clearInterval(workedTodayInterval);
    workedTodayInterval = null;
  }
  heartbeatWorker = null;
  activityWorker = null;
  syncWorker = null;
  screenshotWorker = null;

  // Destroy widget on logout/revoke
  if (widgetWindow) {
    widgetWindow.destroy();
    widgetWindow = null;
  }

  console.log("[Main] Workers stopped");
}

// ─── Timer resync (backend as source of truth) ───

/**
 * Apply server-authoritative timer state to local store.
 *
 * The server is authoritative for status and entryId. Elapsed is derived from
 * local sessions, seeded from server base when no local sessions exist yet.
 * Triggers a renderer push only when status or entryId actually diverged.
 */
function applyServerTimerSync(
  timerSync: {
    entryId: string;
    status: string;
    duration: number;
    taskId?: string | null;
    lastActivityAt?: string | null;
    projectName?: string | null;
    taskName?: string | null;
    startTime?: string | null;
  } | null
): void {
  // Don't override locally-applied state while commands are waiting to sync.
  // The queue is the source of truth until all commands reach the server.
  if (queue.pendingTimerCommandCount() > 0) return;

  const localStatus = store.getTimerStatus();
  const localEntryId = store.getActiveEntryId();
  const serverEntryId = timerSync?.entryId ?? null;
  const serverStatus = timerSync?.status ?? "stopped";

  if (localEntryId === serverEntryId && localStatus === serverStatus) return;

  console.log(
    `[Main] Timer resync: local=${localStatus}/${localEntryId ?? "none"} → server=${serverStatus}/${serverEntryId ?? "none"}`
  );
  store.syncFromServer(
    timerSync
      ? {
          id: timerSync.entryId,
          status: timerSync.status,
          duration: timerSync.duration,
          taskId: timerSync.taskId,
          lastActivityAt: timerSync.lastActivityAt,
          projectName: timerSync.projectName,
          taskName: timerSync.taskName,
          startTime: timerSync.startTime ?? null,
        }
      : null
  );
  pushStateToRenderer();
}

/** Fetch server's stopped-entries total for today and cache in store. Non-fatal on error. */
async function refreshWorkedTodayServerBase(): Promise<void> {
  if (!store.isPaired()) return;
  try {
    const total = await apiClient.getWorkedToday();
    store.setWorkedTodayServerBase(total);
  } catch (err: any) {
    console.warn(`[Main] worked-today refresh failed: ${err.message}`);
  }
}

/** Fetch active entry from server and reconcile local state. */
async function syncTimerFromServer(): Promise<void> {
  if (!store.isPaired()) return;
  try {
    const active = await apiClient.getActiveEntry();
    const timerSync =
      active && active.status !== "stopped"
        ? {
            entryId: active.id,
            status: active.status,
            duration: active.duration ?? 0,
            taskId: active.taskId ?? null,
            lastActivityAt: active.lastActivityAt ?? null,
            projectName: active.projectName ?? null,
            taskName: active.taskName ?? null,
            startTime: active.startTime ?? null,
          }
        : null;
    applyServerTimerSync(timerSync);
  } catch (err: any) {
    console.warn(`[Main] Timer resync failed: ${err.message}`);
  }
}

function startResyncPolling(): void {
  stopResyncPolling();
  resyncInterval = setInterval(() => syncTimerFromServer(), 5_000);
  console.log("[Main] Timer resync polling started (5s)");
}

function stopResyncPolling(): void {
  if (resyncInterval) {
    clearInterval(resyncInterval);
    resyncInterval = null;
  }
}

/** Notify renderer(s) of state changes */
function pushStateToRenderer(): void {
  const timerState = store.getTimerState();

  mainWindow?.webContents.send("agent:state-update", {
    isPaired: store.isPaired(),
    deviceName: store.getDeviceName(),
    userEmail: store.getUserEmail(),
    apiHost: API_HOST,
    apiBase: API_BASE,
    apiBaseSource: API_BASE_SOURCE,
    timer: timerState,
  });

  // Push timer state to widget + sync visibility
  if (widgetWindow) {
    widgetWindow.webContents.send("widget:state-update", { timer: timerState });
    syncWidgetVisibility(timerState.status);
  }
}

// ─── IPC: Pairing ───

ipcMain.handle("agent:get-state", () => {
  return {
    isPaired: store.isPaired(),
    deviceName: store.getDeviceName(),
    userEmail: store.getUserEmail(),
    apiHost: API_HOST,
    apiBase: API_BASE,
    apiBaseSource: API_BASE_SOURCE,
    timer: store.getTimerState(),
  };
});

ipcMain.handle("agent:login", async (event, { email, password }) => {
  const sendProgress = (message: string) => {
    try { event.sender.send("agent:login-progress", { message }); } catch { /* window may be closing */ }
  };

  try {
    store.setClientVersion(app.getVersion());
    const deviceName = os.hostname() || "Desktop";

    console.log(`[Main] auth.login.start — url=${API_BASE} user=${email}`);

    // Step 1: ping backend to confirm agent routes are loaded (handles Replit cold-start)
    sendProgress("Connecting to server…");
    await apiClient.waitForBackend(sendProgress);

    // Step 2: authenticate
    sendProgress("Signing in…");
    const result = await apiClient.loginWithPassword(email, password, {
      deviceName,
      os: process.platform,
      clientVersion: app.getVersion(),
    });

    store.setSession(result.deviceId, result.deviceToken, deviceName, result.user.email);
    // Clear any timer state from a previous user session so workedTodayServerBase
    // and active entry context cannot leak to the new user.
    store.clearTimer();

    console.log(`[Main] auth.login.success — user=${result.user.email} device=${result.deviceId}`);
    startWorkers();
    await syncTimerFromServer().catch(() => { /* non-fatal */ });
    // Populate workedTodayServerBase immediately for the new user instead of
    // waiting for the 60s interval. Runs after syncTimerFromServer so the
    // active entry is known before we fetch the stopped-entries total.
    await refreshWorkedTodayServerBase().catch(() => { /* non-fatal */ });
    pushStateToRenderer();
    return { ok: true };
  } catch (error: any) {
    console.log(`[Main] auth.login.failed — ${error.message}`);
    return { ok: false, error: error.message };
  }
});

ipcMain.handle("agent:unpair", () => {
  stopWorkers();
  store.clearSession();
  pushStateToRenderer();
  return { ok: true };
});

ipcMain.handle("agent:open-external", (_event, url: string) => {
  shell.openExternal(url);
});

// ─── IPC: Projects & Tasks ───

ipcMain.handle("agent:get-projects", async () => {
  try {
    const projects = await apiClient.getProjects();
    return { ok: true, data: projects };
  } catch (error: any) {
    return { ok: false, error: error.message, data: [] };
  }
});

ipcMain.handle("agent:get-tasks", async (_event, { crmProjectId }) => {
  try {
    const taskList = await apiClient.getTasks(crmProjectId);
    return { ok: true, data: taskList };
  } catch (error: any) {
    return { ok: false, error: error.message, data: [] };
  }
});

// ─── IPC: Timer ───

ipcMain.handle("agent:timer-start", async (_event, { crmProjectId, taskId, taskName, projectName, description, taskDurationToday }) => {
  // A task is always required. The UI enforces this, but we guard here too so
  // no path (IPC replay, future renderers) can create a task-less entry.
  if (!taskId) {
    console.warn("[Main] timer.start rejected — taskId is required");
    return { ok: false, error: "A task must be selected to start the timer." };
  }

  // Local-first: apply state immediately, enqueue for background sync.
  const clientCommandId = randomUUID();
  const localEntryId = `local-${randomUUID()}`;

  store.setTimerRunning(
    localEntryId,
    projectName || null,
    taskId || null,
    taskName || null,
    description || null,
    // Seed entryServerBase from the renderer's already-known task total so that
    // elapsedToday displays correctly from the first tick, without waiting for
    // the ~30s server sync response (avoids the 0→jump UX regression).
    typeof taskDurationToday === "number" ? taskDurationToday : 0,
  );
  queue.enqueueTimerCommand({
    clientCommandId,
    type: "start",
    entryId: localEntryId,
    crmProjectId,
    taskId: taskId || null,
    description: description || null,
  });
  widgetDismissed = false;
  console.log(`[Main] timer.start (local) — localEntryId=${localEntryId} project="${projectName || ""}" task="${taskName || ""}"`);
  pushStateToRenderer();
  syncWorker?.triggerSync();
  return { ok: true };
});

ipcMain.handle("agent:timer-pause", async () => {
  const entryId = store.getActiveEntryId();
  if (!entryId) return { ok: false, error: "No active timer" };

  const clientCommandId = randomUUID();
  store.setTimerPaused();
  queue.enqueueTimerCommand({ clientCommandId, type: "pause", entryId });
  pushStateToRenderer();
  syncWorker?.triggerSync();
  return { ok: true };
});

ipcMain.handle("agent:timer-resume", async () => {
  const entryId = store.getActiveEntryId();
  if (!entryId) return { ok: false, error: "No active timer" };

  const clientCommandId = randomUUID();
  store.setTimerRunning(
    entryId,
    store.getActiveProjectName(),
    store.getActiveTaskId(),
    store.getActiveTaskName(),
    store.getActiveDescription(),
  );
  queue.enqueueTimerCommand({ clientCommandId, type: "resume", entryId });
  pushStateToRenderer();
  syncWorker?.triggerSync();
  return { ok: true };
});

ipcMain.handle("agent:timer-stop", async () => {
  const entryId = store.getActiveEntryId();
  if (!entryId) return { ok: false, error: "No active timer" };

  const clientCommandId = randomUUID();
  store.clearTimer();
  queue.enqueueTimerCommand({ clientCommandId, type: "stop", entryId });
  console.log(`[Main] timer.stop (local) — entry=${entryId}`);
  pushStateToRenderer();
  syncWorker?.triggerSync();
  return { ok: true };
});

ipcMain.handle("agent:timer-state", () => {
  return store.getTimerState();
});

// ─── IPC: Widget ───

ipcMain.handle("widget:dismiss", () => {
  widgetDismissed = true;
  widgetWindow?.hide();
  console.log("[Widget] dismissed by user");
});

ipcMain.handle("agent:get-worked-today", () => {
  return { ok: true, total: store.getWorkedTodaySeconds() };
});

ipcMain.handle("agent:today-breakdown", async () => {
  if (!store.isPaired()) return { ok: false, rows: [] };
  try {
    const rows = await apiClient.getTodayBreakdown();
    // Overlay live elapsed for the active entry onto its matching row
    const timerState = store.getTimerState();
    if (timerState.status !== "stopped" && timerState.taskId) {
      const activeRow = rows.find((r) => r.taskId === timerState.taskId);
      if (activeRow) {
        (activeRow as any).activeSeconds = timerState.elapsedToday;
      } else {
        rows.push({
          projectName: timerState.projectName ?? "Unknown Project",
          taskId: timerState.taskId,
          taskName: timerState.taskName,
          stoppedSeconds: 0,
          activeSeconds: timerState.elapsedToday,
        } as any);
      }
    } else if (timerState.status !== "stopped" && !timerState.taskId) {
      // Timer running with no task — show as its own row
      rows.push({
        projectName: timerState.projectName ?? "Unknown Project",
        taskId: null,
        taskName: null,
        stoppedSeconds: 0,
        activeSeconds: timerState.elapsedToday,
      } as any);
    }
    return { ok: true, rows };
  } catch (err: any) {
    return { ok: false, rows: [], error: err.message };
  }
});

// ─── Idle / break UX ───

let idlePromptDismissTimeout: ReturnType<typeof setTimeout> | null = null;

/**
 * Called by ActivityWorker when idle crosses 10 min while timer is running.
 * Auto-pauses the timer (retroactively, excluding idle time) then pushes a
 * prompt to the renderer so the user can choose break or resume.
 */
function handleIdleUx(idleSeconds: number): void {
  if (store.getTimerStatus() !== "running") return; // already paused/stopped

  const entryId = store.getActiveEntryId();
  if (!entryId) return;

  // Retroactively close the session at the moment idle started so that idle
  // time is NOT counted in elapsedToday / Worked Today.
  const idleStartedAt = new Date(Date.now() - idleSeconds * 1000);
  store.setTimerPaused(idleStartedAt);
  queue.enqueueTimerCommand({ clientCommandId: randomUUID(), type: "pause", entryId });
  pushStateToRenderer();
  syncWorker?.triggerSync();

  console.log(`[Main] idle.autoPause — idleSeconds=${idleSeconds}, sessionClosedAt=${idleStartedAt.toISOString()}`);

  // Push prompt to renderer
  mainWindow?.webContents.send("agent:idle-prompt", { idleSeconds });

  // Auto-dismiss after 5 min with no response (timer stays paused — safe)
  if (idlePromptDismissTimeout) clearTimeout(idlePromptDismissTimeout);
  idlePromptDismissTimeout = setTimeout(() => {
    mainWindow?.webContents.send("agent:idle-dismiss");
    idlePromptDismissTimeout = null;
    console.log("[Main] idle.prompt auto-dismissed (no response)");
  }, 5 * 60_000);
}

/** Renderer: user chose "I'm on break" — timer stays paused, dismiss prompt. */
ipcMain.handle("agent:idle-break", () => {
  if (idlePromptDismissTimeout) { clearTimeout(idlePromptDismissTimeout); idlePromptDismissTimeout = null; }
  mainWindow?.webContents.send("agent:idle-dismiss");
  console.log("[Main] idle.break confirmed by user");
  return { ok: true };
});

/** Renderer: user chose "Back to work" — resume timer. */
ipcMain.handle("agent:idle-resume", () => {
  if (idlePromptDismissTimeout) { clearTimeout(idlePromptDismissTimeout); idlePromptDismissTimeout = null; }
  mainWindow?.webContents.send("agent:idle-dismiss");

  const entryId = store.getActiveEntryId();
  if (!entryId) return { ok: false, error: "No active timer" };
  if (store.getTimerStatus() !== "paused") return { ok: true }; // already running

  store.setTimerRunning(
    entryId,
    store.getActiveProjectName(),
    store.getActiveTaskId(),
    store.getActiveTaskName(),
    store.getActiveDescription(),
  );
  queue.enqueueTimerCommand({ clientCommandId: randomUUID(), type: "resume", entryId });
  pushStateToRenderer();
  syncWorker?.triggerSync();
  console.log("[Main] idle.resume confirmed by user");
  return { ok: true };
});

// ─── Auto-resume from offline queue ───

/**
 * Restore timer running/paused state on restart.
 *
 * Called after reconcileOrphanSessions() which already closed open sessions.
 * Uses the pending queue intent when commands are still waiting to sync (offline case),
 * or falls back to the persisted timerStatus when the queue is empty (normal case:
 * commands already synced before shutdown but timer was still active).
 */
function autoResumeFromQueue(): void {
  const entryId = store.getActiveEntryId();
  if (!entryId) {
    // Defensive: if entryId is gone but timerStatus is stale (e.g. external disk
    // corruption), clear it so the store stays consistent.
    if (store.getTimerStatus() !== "stopped") store.clearTimer();
    return;
  }

  // Use pending queue intent when available (offline case — commands not yet synced).
  // Fall back to persisted timerStatus when the queue is empty, which is the common
  // case after a clean PC restart: the start command already synced before shutdown,
  // leaving the queue empty, but the timer was still active.
  const queueIntent = queue.getTimerIntent();
  const intent = queueIntent !== "stopped" ? queueIntent : store.getTimerStatus();

  if (intent === "running") {
    // Create a fresh session starting now — the PC-off gap is excluded because
    // reconcileOrphanSessions() already closed the previous session at lastActivityAt.
    store.setTimerRunning(
      entryId,
      store.getActiveProjectName(),
      store.getActiveTaskId(),
      store.getActiveTaskName(),
      null,
    );
    console.log(`[Main] timer.autoResume (running) — entry=${entryId}`);
  } else if (intent === "paused") {
    // The last command was pause — no open sessions to reconcile. Just restore status.
    store.setTimerPaused();
    console.log(`[Main] timer.autoResume (paused) — entry=${entryId}`);
  }
}

// ─── Single instance ───

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      showMainWindow();
    }
  });
}

// ─── App lifecycle ───

app.whenReady().then(() => {
  initLogger();
  Menu.setApplicationMenu(null);
  store.setClientVersion(app.getVersion());

  // Register for OS autostart (packaged builds only — avoids polluting dev registry).
  if (app.isPackaged) {
    app.setLoginItemSettings({ openAtLogin: true });
  }

  // Close any sessions that were left open by a crash or force-quit.
  // Must run before autoResumeFromQueue() so getElapsedSeconds() starts from a clean state.
  store.reconcileOrphanSessions();

  // Restore timer running/paused state from any pending offline commands.
  // Must run before startWorkers() so the renderer gets the correct status on first push.
  autoResumeFromQueue();

  createTray();
  mainWindow = createMainWindow();

  if (store.isPaired()) {
    const email = store.getUserEmail() ?? "unknown";
    console.log(`[Main] session.restore.start — user=${email}`);
    startWorkers();
    // Sync timer state from server on startup, then always push to renderer.
    // If the device was revoked while offline, ensureAccessToken fires onRevoke
    // (handleDeviceRevoked) which clears session and pushes unpaired state.
    syncTimerFromServer()
      .then(() => refreshWorkedTodayServerBase())
      .then(() => {
        console.log("[Main] session.restore.success");
      })
      .catch((err: any) => {
        console.warn(`[Main] session.restore.failed: ${(err as Error).message}`);
        // onRevoke already called by ApiClient for permanent failures (401/403).
        // Transient network errors are non-fatal — workers will retry.
      })
      .finally(() => pushStateToRenderer());
  }
});

app.on("window-all-closed", () => {
  // Keep app running in tray — window hides on close, not quits
});

app.on("activate", () => {
  showMainWindow();
});

app.on("before-quit", () => {
  stopWorkers();
  queue.close();
});
