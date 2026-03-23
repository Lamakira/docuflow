/**
 * DocuFlow Desktop Agent — Main process entry point.
 *
 * Phase 3 MVP — Pairing + Timer control + Workers.
 */

import { app, BrowserWindow, Tray, Menu, ipcMain, shell, screen } from "electron";
import path from "path";
import fs from "fs";
import os from "os";
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

const WIDGET_WIDTH = 310;
const WIDGET_HEIGHT = 64;
const WIDGET_MARGIN = 20;

const store = new AgentStore();
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

  // Prevent accidental close
  win.on("close", (e) => {
    e.preventDefault();
    win.hide();
  });

  return win;
}

/** Show or hide the widget based on timer status */
function syncWidgetVisibility(status: string): void {
  if (!widgetWindow) return;
  if (status === "running" || status === "paused") {
    if (!widgetWindow.isVisible()) widgetWindow.show();
  } else {
    if (widgetWindow.isVisible()) widgetWindow.hide();
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

  heartbeatWorker = new HeartbeatWorker(apiClient, store, applyServerTimerSync);
  heartbeatWorker.start();

  activityWorker = new ActivityWorker(queue, store);
  activityWorker.start();

  syncWorker = new SyncWorker(apiClient, queue, store);
  syncWorker.start();

  screenshotWorker = new ScreenCaptureWorker(queue, store, SCREENSHOTS_ENABLED);
  screenshotWorker.start();

  // Create floating widget if it doesn't exist yet
  if (!widgetWindow) {
    widgetWindow = createWidgetWindow();
  }

  startResyncPolling();
  console.log(`[Main] Workers started (screenshots: ${SCREENSHOTS_ENABLED})`);
}

function stopWorkers(): void {
  heartbeatWorker?.stop();
  activityWorker?.stop();
  syncWorker?.stop();
  screenshotWorker?.stop();
  stopResyncPolling();
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
 * The server is authoritative for status and entryId only.
 * Elapsed time is derived from local sessions — server duration is ignored.
 * Triggers a renderer push only when status or entryId actually diverged.
 */
function applyServerTimerSync(
  timerSync: { entryId: string; status: string; duration: number } | null
): void {
  const localStatus = store.getTimerStatus();
  const localEntryId = store.getActiveEntryId();
  const serverEntryId = timerSync?.entryId ?? null;
  const serverStatus = timerSync?.status ?? "stopped";

  if (localEntryId === serverEntryId && localStatus === serverStatus) return;

  console.log(
    `[Main] Timer resync: local=${localStatus}/${localEntryId ?? "none"} → server=${serverStatus}/${serverEntryId ?? "none"}`
  );
  store.syncFromServer(
    timerSync ? { id: timerSync.entryId, status: timerSync.status, duration: timerSync.duration } : null
  );
  pushStateToRenderer();
}

/** Fetch active entry from server and reconcile local state. */
async function syncTimerFromServer(): Promise<void> {
  if (!store.isPaired()) return;
  try {
    const active = await apiClient.getActiveEntry();
    const timerSync =
      active && active.status !== "stopped"
        ? { entryId: active.id, status: active.status, duration: active.duration ?? 0 }
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

    console.log(`[Main] auth.login.success — user=${result.user.email} device=${result.deviceId}`);
    startWorkers();
    await syncTimerFromServer().catch(() => { /* non-fatal */ });
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

ipcMain.handle("agent:timer-start", async (_event, { crmProjectId, taskId, taskName, projectName, description }) => {
  try {
    const entry = await apiClient.startTimer(crmProjectId, taskId || undefined, description);
    // Close any active session (handles task switching: A → B) and open a new one
    store.setTimerRunning(
      entry.id,
      projectName || null,
      taskId || null,
      taskName || null,
      description || null,
    );
    console.log(`[Main] timer.start — entry=${entry.id} project="${projectName || ""}" task="${taskName || ""}"`);
    pushStateToRenderer();
    return { ok: true, entry };
  } catch (error: any) {
    await syncTimerFromServer();
    return { ok: false, error: error.message };
  }
});

ipcMain.handle("agent:timer-pause", async () => {
  try {
    const entryId = store.getActiveEntryId();
    if (!entryId) return { ok: false, error: "No active timer" };

    const entry = await apiClient.pauseTimer(entryId);
    store.setTimerPaused(); // closes active session with endTime=now
    pushStateToRenderer();
    return { ok: true, entry };
  } catch (error: any) {
    const msg: string = error.message ?? "";
    await syncTimerFromServer();
    // If the server already paused it (e.g. initiated from web), that's the desired outcome.
    if (store.getTimerStatus() === "paused") return { ok: true };
    return { ok: false, error: msg };
  }
});

ipcMain.handle("agent:timer-resume", async () => {
  try {
    const entryId = store.getActiveEntryId();
    if (!entryId) return { ok: false, error: "No active timer" };

    const entry = await apiClient.resumeTimer(entryId);
    // Resume = new session for the same entry; preserves accumulated elapsed
    store.setTimerRunning(
      entry.id,
      store.getActiveProjectName(),
      store.getActiveTaskId(),
      store.getActiveTaskName(),
      store.getActiveDescription(),
    );
    pushStateToRenderer();
    return { ok: true, entry };
  } catch (error: any) {
    const msg: string = error.message ?? "";
    if (msg.includes("not running") || msg.includes("already stopped") || msg.includes("not paused")) {
      console.log(`[Main] Timer conflict on resume ("${msg}") — resyncing from server`);
      await syncTimerFromServer();
    }
    return { ok: false, error: msg };
  }
});

ipcMain.handle("agent:timer-stop", async () => {
  try {
    const entryId = store.getActiveEntryId();
    if (!entryId) return { ok: false, error: "No active timer" };

    const entry = await apiClient.stopTimer(entryId);
    store.clearTimer();
    console.log(`[Main] timer.stop — entry=${entryId}`);
    pushStateToRenderer();
    return { ok: true, entry };
  } catch (error: any) {
    const msg: string = error.message ?? "";
    await syncTimerFromServer();
    // If the server already stopped it (e.g. initiated from web), that's the desired outcome.
    if (!store.getActiveEntryId()) return { ok: true };
    return { ok: false, error: msg };
  }
});

ipcMain.handle("agent:timer-state", () => {
  return store.getTimerState();
});

ipcMain.handle("agent:get-worked-today", () => {
  // Sessions are the source of truth — no server round-trip needed.
  return { ok: true, total: store.getWorkedTodaySeconds() };
});

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

  // Close any sessions that were left open by a crash or force-quit.
  // Must run before startWorkers() so getElapsedSeconds() / getWorkedTodaySeconds()
  // are correct when the first state push reaches the renderer.
  store.reconcileOrphanSessions();

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
