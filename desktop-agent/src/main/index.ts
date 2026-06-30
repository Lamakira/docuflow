/**
 * DocuFlow Desktop Agent — Main process entry point.
 *
 * Phase 3 MVP — Pairing + Timer control + Workers.
 */

import { app, BrowserWindow, Tray, Menu, ipcMain, shell, screen, clipboard, nativeImage, powerMonitor } from "electron";
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
import { ActivityWorker, type IdleGlobalInputPayload } from "../workers/ActivityWorker";
import { SyncWorker } from "../workers/SyncWorker";
import { ScreenCaptureWorker } from "../workers/ScreenCaptureWorker";
import { LinuxScreenLockWatcher } from "../lib/LinuxScreenLockWatcher";
import { getLocalDayKey, getTestDayRolloverSeconds } from "../lib/dayBoundary";
import { isWaylandSession, shouldSkipWaylandCaptures } from "../lib/platform";

let mainWindow: BrowserWindow | null = null;
let widgetWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
/** Set by the user clicking ×. Cleared when the timer stops so the next session shows the widget again. */
let widgetDismissed = false;
/** Last org policy received from heartbeat — exposed to renderer via settings:get-org-policy. */
let lastKnownPolicy: import("../workers/ScreenCaptureWorker").ScreenshotPolicyPayload | null = null;

const WIDGET_WIDTH = 380;
const WIDGET_HEIGHT = 44;
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
  agentTimerRequiresTask = false;
  pushStateToRenderer();
}

const apiClient = new ApiClient(store, handleDeviceRevoked);

/** Mirrored from server `GET /api/agent/capabilities` — when true, IPC must reject timer start without taskId. */
let agentTimerRequiresTask = false;

async function refreshAgentTimerPolicy(): Promise<void> {
  if (!store.isPaired()) {
    agentTimerRequiresTask = false;
    return;
  }
  try {
    const cap = await apiClient.getAgentCapabilities();
    agentTimerRequiresTask = !!cap.requiresTask;
    console.log(`[Main] timer.policy — requiresTask=${agentTimerRequiresTask}`);
  } catch (err: any) {
    console.warn(`[Main] timer.policy refresh failed: ${err.message}`);
  }
}

// Feature flag: enabled by default in dev; set SCREENSHOTS_ENABLED=false to disable
const SCREENSHOTS_ENABLED = process.env.SCREENSHOTS_ENABLED !== "false";

let heartbeatWorker: HeartbeatWorker | null = null;
let activityWorker: ActivityWorker | null = null;
let syncWorker: SyncWorker | null = null;
let screenshotWorker: ScreenCaptureWorker | null = null;
let resyncInterval: ReturnType<typeof setInterval> | null = null;
let workedTodayInterval: ReturnType<typeof setInterval> | null = null;

// ─── Suspend / Resume handlers (registered in startWorkers, removed in stopWorkers) ───
let suspendMainHandler: (() => void) | null = null;
let resumeMainHandler: (() => void) | null = null;
let lockScreenMainHandler: (() => void) | null = null;
let unlockScreenMainHandler: (() => void) | null = null;
let linuxScreenLockWatcher: LinuxScreenLockWatcher | null = null;
/** True when timer was paused locally for a Wayland screenshot portal dialog. */
let pausedForScreenshotPortal = false;

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

  win.setMinimumSize(WIDGET_WIDTH, WIDGET_HEIGHT);
  win.setMaximumSize(WIDGET_WIDTH, WIDGET_HEIGHT);
  win.loadURL(WIDGET_WINDOW_WEBPACK_ENTRY);
  win.setAlwaysOnTop(true, "floating");

  win.webContents.on("did-finish-load", () => {
    console.log("[Widget] renderer ready");
  });

  // Clamp position after drag; re-assert exact size every time (belt-and-suspenders against OS resize)
  win.on("moved", () => {
    const { x, y } = win.getBounds();
    const { workArea } = screen.getPrimaryDisplay();
    const cx = Math.max(workArea.x, Math.min(x, workArea.x + workArea.width - WIDGET_WIDTH));
    const cy = Math.max(workArea.y, Math.min(y, workArea.y + workArea.height - WIDGET_HEIGHT));
    win.setBounds({ x: cx, y: cy, width: WIDGET_WIDTH, height: WIDGET_HEIGHT });
  });

  // Snap back to exact dimensions if anything causes a resize (DPI change, compositor glitch, etc.)
  win.on("resize", () => {
    const { x, y, width, height } = win.getBounds();
    if (width !== WIDGET_WIDTH || height !== WIDGET_HEIGHT) {
      win.setBounds({ x, y, width: WIDGET_WIDTH, height: WIDGET_HEIGHT });
    }
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
    return path.join(process.resourcesPath, "assets", "tray-icon.png");
  }
  // Dev: .webpack/main → ../../assets/
  return path.join(__dirname, "../../assets/tray-icon.png");
}

function rebuildTrayMenu(): void {
  if (!tray) return;

  const timerStatus = store.getTimerStatus();
  const isPaired = store.isPaired();

  const timerItems: Electron.MenuItemConstructorOptions[] = [];

  if (isPaired) {
    if (timerStatus === "running") {
      timerItems.push({
        label: "Pause timer",
        click: async () => {
          const entryId = store.getActiveEntryId();
          if (!entryId) return;
          store.setTimerPaused();
          queue.enqueueTimerCommand({ clientCommandId: randomUUID(), type: "pause", entryId });
          pushStateToRenderer();
          syncWorker?.triggerSync();
        },
      });
    } else if (timerStatus === "paused") {
      timerItems.push({
        label: "Resume timer",
        click: async () => {
          const entryId = store.getActiveEntryId();
          if (!entryId) return;
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
        },
      });
    } else {
      timerItems.push({
        label: "Start timer…",
        click: () => showMainWindow(),
      });
    }
    timerItems.push({ type: "separator" });
  }

  const contextMenu = Menu.buildFromTemplate([
    { label: "Show Agent", click: () => showMainWindow() },
    { label: "Status: " + (isPaired ? "Connected" : "Not paired"), enabled: false },
    { type: "separator" },
    ...timerItems,
    { label: "Quit", click: () => { stopWorkers(); app.exit(0); } },
  ]);

  tray.setContextMenu(contextMenu);
}

function createTray(): void {
  try {
    // tray-icon.png is a 32×32 transparent PNG (logo glyph visible — not a flat
    // blue square). On macOS the menu bar is ~22pt tall, so resize down to 16×16
    // to avoid the oversized icon that prompted the earlier fix; Linux (top bar
    // indicator) and Windows downscale the 32×32 cleanly on their own.
    let image = nativeImage.createFromPath(getTrayIconPath());
    if (process.platform === "darwin" && !image.isEmpty()) {
      image = image.resize({ width: 16, height: 16 });
    }
    tray = new Tray(image.isEmpty() ? getTrayIconPath() : image);
  } catch (err) {
    console.warn("[Main] Tray icon not found, skipping tray:", (err as Error).message);
    return;
  }

  tray.setToolTip("DocuFlow Desktop Agent");
  rebuildTrayMenu();
  tray.on("click", () => showMainWindow());
}

// ─── Workers ───

function startWorkers(): void {
  if (!store.isPaired()) return;

  heartbeatWorker = new HeartbeatWorker(apiClient, store, applyServerTimerSync, (policy) => {
    lastKnownPolicy = policy;
    screenshotWorker?.applyPolicy(policy);

    activityWorker?.applyIdlePolicy(
      policy.idlePromptEnabled ?? true,
      policy.idleTimeoutMinutes ?? 10
    );
  });
  heartbeatWorker.start();

  activityWorker = new ActivityWorker(queue, store);
  activityWorker.setIdleUxCallback((idleSeconds) => handleIdleUx(idleSeconds));
  activityWorker.start();

  syncWorker = new SyncWorker(apiClient, queue, store);
  syncWorker.start();

  screenshotWorker = new ScreenCaptureWorker(queue, store, SCREENSHOTS_ENABLED);
  if (activityWorker) screenshotWorker.setActivityWorker(activityWorker);
  screenshotWorker.setCaptureLifecycleHooks({
    onBeforePortalDialog: () => {
      if (store.getTimerStatus() !== "running" || idleStartedAt !== null) return;
      const entryId = store.getActiveEntryId();
      if (!entryId) return;

      store.setTimerPaused();
      queue.enqueueTimerCommand({ clientCommandId: randomUUID(), type: "pause", entryId });
      syncWorker?.triggerSync();
      pausedForScreenshotPortal = true;
      pushStateToRenderer();
      console.log("[Main] Wayland screenshot portal — timer paused (waiting for screen-share consent)");
    },
    onAfterPortalDialog: (granted) => {
      if (!pausedForScreenshotPortal) return;
      pausedForScreenshotPortal = false;

      if (!granted) {
        console.log("[Main] Wayland screenshot portal — consent denied or dismissed; timer stays paused");
        pushStateToRenderer();
        return;
      }

      const entryId = store.getActiveEntryId();
      if (entryId && store.getTimerStatus() === "paused" && idleStartedAt === null) {
        store.setTimerRunning(
          entryId,
          store.getActiveProjectName(),
          store.getActiveTaskId(),
          store.getActiveTaskName(),
          store.getActiveDescription(),
        );
        queue.enqueueTimerCommand({ clientCommandId: randomUUID(), type: "resume", entryId });
        syncWorker?.triggerSync();
        pushStateToRenderer();
        console.log("[Main] Wayland screenshot portal — consent granted, timer resumed");
      }
    },
  });
  screenshotWorker.start();
  // Prune screenshots older than 30 days at startup (non-blocking)
  screenshotWorker.pruneOldScreenshots(30).catch(() => {});

  // Create floating widget if it doesn't exist yet
  if (!widgetWindow) {
    widgetWindow = createWidgetWindow();
  }

  startResyncPolling();

  // Refresh worked-today server base and detect day-boundary crossings.
  // Normal cadence: 60 s. Near calendar midnight (23:55–00:05) or in test rollover mode: 15 s.
  let _lastWorkedTodayDate = getLocalDayKey();

  function scheduleWorkedTodayTick(): void {
    const now = new Date();
    const minuteOfDay = now.getHours() * 60 + now.getMinutes();
    const testRollover = getTestDayRolloverSeconds();
    const nearMidnight = !testRollover && (minuteOfDay >= 23 * 60 + 55 || minuteOfDay <= 5);
    const interval = testRollover ? 5_000 : nearMidnight ? 15_000 : 60_000;

    workedTodayInterval = setTimeout(async () => {
      const today = getLocalDayKey();
      if (_lastWorkedTodayDate !== today) {
        console.log(`[Main] Day changed (${_lastWorkedTodayDate} → ${today}) — resetting workedTodayServerBase`);
        store.setWorkedTodayServerBase(0);
        pushStateToRenderer();
        _lastWorkedTodayDate = today;
      }
      await refreshWorkedTodayServerBase();
      pushStateToRenderer();
      scheduleWorkedTodayTick();
    }, interval) as unknown as ReturnType<typeof setInterval>;
  }

  scheduleWorkedTodayTick();

  // System suspend / screen lock — pause timer locally (no server command), manual resume required.
  const onSystemAway = (reason: string) => pauseTimerForSystemAway(reason);
  const onSystemBack = (reason: string) => {
    console.log(`[Main] ${reason} — timer stays paused, refreshing renderer`);
    pushStateToRenderer();
  };

  suspendMainHandler = () => onSystemAway("system.suspend");
  resumeMainHandler = () => onSystemBack("system.resume");
  lockScreenMainHandler = () => onSystemAway("lock-screen");
  unlockScreenMainHandler = () => onSystemBack("unlock-screen");

  powerMonitor.on("suspend", suspendMainHandler);
  powerMonitor.on("resume", resumeMainHandler);
  powerMonitor.on("lock-screen", lockScreenMainHandler);
  powerMonitor.on("unlock-screen", unlockScreenMainHandler);

  // Linux: Super+L locks the screen but does not suspend; Electron lock-screen is macOS/Windows only.
  linuxScreenLockWatcher = new LinuxScreenLockWatcher(
    () => onSystemAway("linux.screen-lock"),
    () => onSystemBack("linux.screen-unlock"),
  );
  linuxScreenLockWatcher.start();

  if (isWaylandSession()) {
    const captureNote = shouldSkipWaylandCaptures()
      ? "screenshots OFF (DOCUFLOW_SKIP_WAYLAND_CAPTURES)"
      : "screenshots ON (timer pauses during portal consent)";
    console.log(`[Main] Wayland session — ${captureNote}`);
  }

  console.log(`[Main] Workers started (screenshots: ${SCREENSHOTS_ENABLED})`);
}

function stopWorkers(): void {
  if (suspendMainHandler) { powerMonitor.removeListener("suspend", suspendMainHandler); suspendMainHandler = null; }
  if (resumeMainHandler) { powerMonitor.removeListener("resume", resumeMainHandler); resumeMainHandler = null; }
  if (lockScreenMainHandler) { powerMonitor.removeListener("lock-screen", lockScreenMainHandler); lockScreenMainHandler = null; }
  if (unlockScreenMainHandler) { powerMonitor.removeListener("unlock-screen", unlockScreenMainHandler); unlockScreenMainHandler = null; }
  linuxScreenLockWatcher?.stop();
  linuxScreenLockWatcher = null;

  heartbeatWorker?.stop();
  activityWorker?.stop();
  syncWorker?.stop();
  screenshotWorker?.stop();
  stopResyncPolling();
  if (workedTodayInterval) {
    clearTimeout(workedTodayInterval);
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

  rebuildTrayMenu();

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
    await refreshAgentTimerPolicy().catch(() => { /* non-fatal */ });
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
  agentTimerRequiresTask = false;
  pushStateToRenderer();
  return { ok: true };
});

ipcMain.handle("agent:open-external", (_event, url: string) => {
  shell.openExternal(url);
});

// ─── IPC: In-app update check ───
// Queries the public release endpoint for the latest installer for this OS and
// compares it to the running version. Download is a one-click open of the
// installer in the browser (.deb/.dmg/.exe can't self-apply without elevation).

function updatePlatform(): "windows" | "macos" | "linux" | null {
  switch (process.platform) {
    case "win32": return "windows";
    case "darwin": return "macos";
    case "linux": return "linux";
    default: return null;
  }
}

/** Returns true if `latest` is a strictly higher semver than `current`. */
function isNewerVersion(latest: string, current: string): boolean {
  const parse = (v: string) => v.replace(/^v/, "").split(".").map((n) => parseInt(n, 10) || 0);
  const a = parse(latest);
  const b = parse(current);
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const x = a[i] ?? 0;
    const y = b[i] ?? 0;
    if (x > y) return true;
    if (x < y) return false;
  }
  return false;
}

ipcMain.handle("agent:check-update", async () => {
  const currentVersion = app.getVersion();
  const platform = updatePlatform();
  if (!platform) {
    return { ok: false, error: "Unsupported platform", currentVersion };
  }
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 8_000);
    const res = await fetch(
      `${API_BASE}/api/downloads/desktop/latest?platform=${platform}&format=json`,
      { headers: { Accept: "application/json" }, signal: controller.signal }
    ).finally(() => clearTimeout(timeoutId));

    if (!res.ok) {
      return { ok: false, error: `Update check failed (HTTP ${res.status})`, currentVersion };
    }
    const data = await res.json();
    const latestVersion: string = data.version;
    const updateAvailable = isNewerVersion(latestVersion, currentVersion);
    return {
      ok: true,
      updateAvailable,
      currentVersion,
      latestVersion,
      // Use the redirect endpoint so the server resolves the signed URL itself.
      downloadUrl: `${API_BASE}/downloads/${platform}`,
    };
  } catch (error: any) {
    console.warn("[Main] check-update failed:", error.message);
    return { ok: false, error: error.message, currentVersion };
  }
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

ipcMain.handle("agent:create-project", async (_event, { name }) => {
  try {
    const project = await apiClient.createProject(name);
    return { ok: true, data: project };
  } catch (error: any) {
    return { ok: false, error: error.message };
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

ipcMain.handle("agent:create-task", async (_event, { crmProjectId, name }) => {
  try {
    const task = await apiClient.createTask(crmProjectId, name);
    return { ok: true, data: task };
  } catch (error: any) {
    return { ok: false, error: error.message };
  }
});

// ─── IPC: Timer ───

ipcMain.handle("agent:timer-start", async (_event, { crmProjectId, taskId, taskName, projectName, description, taskDurationToday }) => {
  // When the server has the tasks migration, task-less starts are invalid (matches POST /api/agent/timer/start).
  if (agentTimerRequiresTask && !taskId) {
    console.warn("[Main] timer.start rejected — taskId is required for this workspace");
    return { ok: false, error: "Select a task to start tracking." };
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

ipcMain.handle("widget:open-main", () => {
  console.log("[Widget] open-main requested");
  showMainWindow();
});

ipcMain.on("widget:move-window", (_event, x: number, y: number) => {
  widgetWindow?.setBounds({ x: Math.round(x), y: Math.round(y), width: WIDGET_WIDTH, height: WIDGET_HEIGHT });
});

ipcMain.handle("widget:get-window-pos", () => {
  return widgetWindow?.getPosition() ?? [0, 0];
});

ipcMain.handle("widget:reset-position", () => {
  if (!widgetWindow) return { ok: false };
  const { workArea } = screen.getPrimaryDisplay();
  const x = workArea.x + workArea.width - WIDGET_WIDTH - WIDGET_MARGIN;
  const y = workArea.y + workArea.height - WIDGET_HEIGHT - WIDGET_MARGIN;
  widgetWindow.setPosition(x, y);
  console.log("[Widget] position reset to default corner");
  return { ok: true };
});

// ─── IPC: Settings ───

ipcMain.handle("settings:get-local-prefs", () => {
  const loginSettings = app.getLoginItemSettings();
  return {
    openAtLogin: loginSettings.openAtLogin,
    isPackaged: app.isPackaged,
    appVersion: app.getVersion(),
  };
});

ipcMain.handle("settings:set-open-at-login", (_event, value: boolean) => {
  app.setLoginItemSettings({ openAtLogin: value });
  console.log(`[Settings] openAtLogin → ${value}`);
  return { ok: true };
});

ipcMain.handle("settings:copy-to-clipboard", (_event, text: string) => {
  clipboard.writeText(String(text));
  return { ok: true };
});

ipcMain.handle("settings:get-display-timezone", () => store.getDisplayTimezone());

ipcMain.handle("settings:set-display-timezone", (_event, tz: string) => {
  const value = tz === 'utc' ? 'utc' : 'local';
  store.setDisplayTimezone(value);
  return { ok: true };
});

// ─── IPC: Screenshots ───

ipcMain.handle("agent:list-screenshots", async () => {
  try {
    const screenshotDir = path.join(app.getPath("userData"), "screenshots");
    if (!fs.existsSync(screenshotDir)) {
      return { ok: true, data: [] };
    }
    const files = await fs.promises.readdir(screenshotDir);
    const pngFiles = files.filter((f) => f.endsWith(".png"));
    const entries = await Promise.all(
      pngFiles.map(async (filename) => {
        const filePath = path.join(screenshotDir, filename);
        const stat = await fs.promises.stat(filePath);
        // Extract timestamp from filename "screenshot-<ms>.png"
        const match = filename.match(/screenshot-(\d+)\.png/);
        const timestampMs = match ? parseInt(match[1], 10) : stat.mtimeMs;
        // Read sidecar JSON for project context (non-fatal if missing)
        let projectName: string | null = null;
        let taskName: string | null = null;
        try {
          const sidecarPath = path.join(screenshotDir, filename.replace(/\.png$/, ".json"));
          if (fs.existsSync(sidecarPath)) {
            const raw = JSON.parse(await fs.promises.readFile(sidecarPath, "utf-8"));
            projectName = raw.projectName ?? null;
            taskName = raw.taskName ?? null;
          }
        } catch { /* ignore */ }
        return { filename, timestampMs, sizeKb: Math.round(stat.size / 1024), projectName, taskName };
      })
    );
    // Sort newest first
    entries.sort((a, b) => b.timestampMs - a.timestampMs);
    return { ok: true, data: entries };
  } catch (err: any) {
    console.error("[Main] list-screenshots failed:", err.message);
    return { ok: false, data: [] };
  }
});

ipcMain.handle("agent:read-screenshot", async (_event, filename: string) => {
  try {
    const screenshotDir = path.join(app.getPath("userData"), "screenshots");
    // Sanitise: only allow plain filenames (no path traversal)
    const safe = path.basename(filename);
    if (!safe.endsWith(".png")) return { ok: false };
    const filePath = path.join(screenshotDir, safe);
    if (!fs.existsSync(filePath)) return { ok: false };
    const data = await fs.promises.readFile(filePath);
    return { ok: true, dataUrl: `data:image/png;base64,${data.toString("base64")}` };
  } catch (err: any) {
    console.error("[Main] read-screenshot failed:", err.message);
    return { ok: false };
  }
});

ipcMain.handle("agent:worked-period", async (_event, startIso: string, endIso: string) => {
  try {
    const total = await apiClient.getWorkedPeriod(new Date(startIso), new Date(endIso));
    return { ok: true, total };
  } catch {
    return { ok: false, total: 0 };
  }
});

ipcMain.handle("settings:get-org-policy", () => {
  if (!lastKnownPolicy) return null;
  return {
    screenshotsEnabled: lastKnownPolicy.screenshotsEnabled,
    idlePromptEnabled: lastKnownPolicy.idlePromptEnabled,
    idleTimeoutMinutes: lastKnownPolicy.idleTimeoutMinutes,
    idleCountdownSeconds: lastKnownPolicy.idleCountdownSeconds,
  };
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

/** Tracks whether a global-input callback is registered on activityWorker (for cleanup). */
let idleActivityCheckActive = false;
/** Wall-clock time when the user went idle — set by handleIdleUx, cleared on any resolution. */
let idleStartedAt: Date | null = null;

function clearIdleActivityCheck(): void {
  if (idleActivityCheckActive) {
    activityWorker?.setIdleInputCallback(null);
    idleActivityCheckActive = false;
  }
}

/** Clear the global-input listener only (no countdown to clear in the new flow). */
function clearIdleTimeout(): void {
  clearIdleActivityCheck();
}

/**
 * Pause the timer when the system sleeps or the screen is locked.
 * Local pause only — no server command (matches TD2 / plan P2).
 */
function pauseTimerForSystemAway(reason: string): void {
  if (store.getTimerStatus() !== "running") return;
  const entryId = store.getActiveEntryId();
  if (!entryId) return;

  store.setTimerPaused(new Date());
  clearIdleTimeout();
  releaseIdleOnTop();
  idleStartedAt = null;
  mainWindow?.webContents.send("agent:idle-dismiss");
  pushStateToRenderer();
  console.log(`[Main] ${reason} — timer paused locally (entry=${entryId})`);
}

/** Bring mainWindow above all other windows for the duration of the idle prompt. */
function raiseForIdlePrompt(): void {
  if (!mainWindow) return;
  mainWindow.setAlwaysOnTop(true, "screen-saver"); // highest level on Windows/macOS
  mainWindow.showInactive();                        // make visible without stealing keyboard focus
  mainWindow.moveTop();                             // ensure z-order
  console.log("[Main] idle — window raised to top");
}

/** Restore normal z-order after the idle prompt is resolved. */
function releaseIdleOnTop(): void {
  if (!mainWindow) return;
  mainWindow.setAlwaysOnTop(false);
  console.log("[Main] idle — alwaysOnTop released");
}

/**
 * Resume the timer after an idle prompt — used by both the IPC handler and the
 * global-input (uiohook) callback so the logic is in one place.
 */
function resumeFromIdlePrompt(entryId: string): void {
  clearIdleActivityCheck();
  releaseIdleOnTop();
  idleStartedAt = null;

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
  mainWindow?.webContents.send("agent:idle-dismiss");
  console.log(`[Main] idle.resume — timer resumed (entry=${entryId})`);
}

/**
 * Called by ActivityWorker when idle crosses the configured threshold while timer is running.
 *
 * Time-Doctor style flow:
 *   1. Pause the timer immediately (at idleStartedAt — retroactive).
 *   2. Enqueue a pause command to the server.
 *   3. Show the idle prompt (no countdown — session is already safe).
 *   4. Global input outside the window → auto-resume.
 *   5. "I'm back" button → resume.
 *   6. "I'm not working" button → stop (session was already paused at idleStartedAt).
 */
function handleIdleUx(idleSeconds: number): void {
  const timerStatus = store.getTimerStatus();
  const entryId = store.getActiveEntryId();
  console.log(`[Main] handleIdleUx — idleSeconds=${idleSeconds} timerStatus=${timerStatus} entryId=${entryId ?? "none"} mainWindow=${!!mainWindow}`);

  if (timerStatus !== "running") {
    console.log(`[Main] handleIdleUx — skipped: timer is "${timerStatus}" (must be "running")`);
    return;
  }
  if (!entryId) {
    console.log("[Main] handleIdleUx — skipped: no active entry");
    return;
  }
  // Guard: prompt already active (e.g. ActivityWorker fired again before user responded).
  if (idleStartedAt !== null) {
    console.log(`[Main] handleIdleUx — skipped: prompt already active (idleStartedAt=${idleStartedAt.toISOString()})`);
    return;
  }

  // Backdate the pause to when the user actually went idle.
  idleStartedAt = new Date(Date.now() - idleSeconds * 1000);
  console.log(`[Main] idle.pause — pausing timer immediately at idleStartedAt=${idleStartedAt.toISOString()} (idleSeconds=${idleSeconds})`);

  // Pause the timer locally at idleStartedAt so idle time is excluded from Worked Today.
  store.setTimerPaused(idleStartedAt);
  queue.enqueueTimerCommand({ clientCommandId: randomUUID(), type: "pause", entryId });
  syncWorker?.triggerSync();
  pushStateToRenderer();

  // Raise window so the prompt is visible regardless of focus.
  raiseForIdlePrompt();

  mainWindow?.webContents.send("agent:idle-prompt", { idleSeconds });

  // Register a one-shot global-input callback: any keydown/mousedown outside the agent window
  // counts as "I'm back" and auto-resumes, matching Time Doctor behaviour.
  clearIdleActivityCheck();
  if (activityWorker) {
    idleActivityCheckActive = true;
    activityWorker.setIdleInputCallback((payload: IdleGlobalInputPayload) => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        if (payload.kind === "mousedown") {
          const b = mainWindow.getBounds();
          const { x, y } = payload;
          if (x >= b.x && x < b.x + b.width && y >= b.y && y < b.y + b.height) {
            return false; // click inside agent window — handled by modal buttons
          }
        }
        if (payload.kind === "keydown" && mainWindow.isFocused()) {
          return false; // key while window is focused — handled by modal
        }
      }
      // Activity detected outside the agent window → auto-resume
      const currentEntryId = store.getActiveEntryId();
      if (currentEntryId && store.getTimerStatus() === "paused") {
        console.log("[Main] idle.globalActivity — auto-resume (outside agent window / key while unfocused)");
        resumeFromIdlePrompt(currentEntryId);
      } else {
        idleActivityCheckActive = false;
        clearIdleActivityCheck();
        releaseIdleOnTop();
        idleStartedAt = null;
        mainWindow?.webContents.send("agent:idle-dismiss");
      }
    });
  }
}

/** Renderer: user clicked "I'm back" — resume the paused timer. */
ipcMain.handle("agent:idle-resume", () => {
  clearIdleActivityCheck();
  releaseIdleOnTop();
  const entryId = store.getActiveEntryId();
  const capturedIdleStartedAt = idleStartedAt;
  idleStartedAt = null;

  if (entryId && (store.getTimerStatus() === "paused" || store.getTimerStatus() === "running")) {
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
    const idleDuration = capturedIdleStartedAt
      ? Math.round((Date.now() - capturedIdleStartedAt.getTime()) / 1000)
      : 0;
    console.log(`[Main] idle.resume confirmed — timer resumed (entry=${entryId} idleDuration=${idleDuration}s)`);
  }
  mainWindow?.webContents.send("agent:idle-dismiss");
  return { ok: true };
});

/** Renderer: user chose "I'm not working" — timer is already paused at idleStartedAt; just stop it. */
ipcMain.handle("agent:idle-break", () => {
  clearIdleActivityCheck();
  releaseIdleOnTop();
  const entryId = store.getActiveEntryId();
  const capturedIdleStartedAt = idleStartedAt;
  idleStartedAt = null;

  if (entryId && (store.getTimerStatus() === "paused" || store.getTimerStatus() === "running")) {
    // Timer was already paused at idleStartedAt — just convert the pause to a full stop.
    store.clearTimer();
    queue.enqueueTimerCommand({ clientCommandId: randomUUID(), type: "stop", entryId });
    pushStateToRenderer();
    syncWorker?.triggerSync();
    const ts = capturedIdleStartedAt ?? new Date();
    const actualIdleSeconds = Math.round((Date.now() - ts.getTime()) / 1000);
    console.log(`[Main] idle.break confirmed — timer stopped (entry=${entryId} idleSince=${ts.toISOString()} idleDuration=${actualIdleSeconds}s)`);
  }
  mainWindow?.webContents.send("agent:idle-dismiss");
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

  // Print test overrides in the very first log output so env propagation is
  // confirmed before any worker starts. If these lines are absent the vars
  // are not visible to the Electron process (shell scope issue, not a code bug).
  const _testIdleMin = process.env.DOCUFLOW_TEST_IDLE_TIMEOUT_MINUTES;
  const _testCapture = process.env.DOCUFLOW_TEST_CAPTURE_INTERVAL_SECONDS;
  const _testDayRollover = process.env.DOCUFLOW_TEST_DAY_ROLLOVER_SECONDS;
  if (_testIdleMin || _testCapture || _testDayRollover) {
    console.log(
      "[Main] TEST OVERRIDES:" +
      (_testIdleMin ? ` IDLE_TIMEOUT_MINUTES=${_testIdleMin}` : "") +
      (_testCapture ? ` CAPTURE_INTERVAL_SECONDS=${_testCapture}` : "") +
      (_testDayRollover ? ` DAY_ROLLOVER_SECONDS=${_testDayRollover}` : "")
    );
  } else {
    console.log("[Main] No test overrides detected (DOCUFLOW_TEST_* vars not set)");
  }

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
    refreshAgentTimerPolicy()
      .then(() => syncTimerFromServer())
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
