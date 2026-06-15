/**
 * DocuFlow Desktop Agent — Main process entry point.
 *
 * Phase 3 MVP — Pairing + Timer control + Workers.
 */

import { app, BrowserWindow, Tray, Menu, ipcMain, shell, screen, clipboard } from "electron";
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
    return path.join(process.resourcesPath, "assets", "icon.png");
  }
  // Dev: .webpack/main → ../../assets/
  return path.join(__dirname, "../../assets/icon.png");
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
    tray = new Tray(getTrayIconPath());
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

  // Apply countdown override immediately — do NOT wait for first heartbeat.
  // If heartbeat fails (server down, auth error) the override would never take
  // effect otherwise. The heartbeat callback below keeps it applied on every
  // subsequent sync so the server policy cannot silently override it back.
  const _testCountdown = process.env.DOCUFLOW_TEST_IDLE_COUNTDOWN_SECONDS;
  if (_testCountdown) {
    idleCountdownSeconds = Math.max(5, parseInt(_testCountdown, 10) || 30);
    console.log(`[Main] Idle countdown override at startup: ${idleCountdownSeconds}s [DOCUFLOW_TEST_IDLE_COUNTDOWN_SECONDS=${_testCountdown}]`);
  }

  heartbeatWorker = new HeartbeatWorker(apiClient, store, applyServerTimerSync, (policy) => {
    lastKnownPolicy = policy;
    screenshotWorker?.applyPolicy(policy);

    // Re-apply countdown override on every heartbeat so the server policy cannot
    // silently clobber the test value. Fall back to server policy if no override.
    const testCountdown = process.env.DOCUFLOW_TEST_IDLE_COUNTDOWN_SECONDS;
    idleCountdownSeconds = testCountdown
      ? Math.max(5, parseInt(testCountdown, 10) || 30)
      : (policy.idleCountdownSeconds ?? 60);

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

let idlePromptDismissTimeout: ReturnType<typeof setTimeout> | null = null;
/** Tracks whether a global-input callback is registered on activityWorker (for cleanup). */
let idleActivityCheckActive = false;
/** Countdown seconds before the timer is auto-stopped. Updated by heartbeat policy. */
let idleCountdownSeconds = 60;
/** Wall-clock time when the user went idle — set by handleIdleUx, cleared on any resolution. */
let idleStartedAt: Date | null = null;

function clearIdleActivityCheck(): void {
  if (idleActivityCheckActive) {
    activityWorker?.setIdleInputCallback(null);
    idleActivityCheckActive = false;
  }
}

function clearIdleTimeout(): void {
  if (idlePromptDismissTimeout) { clearTimeout(idlePromptDismissTimeout); idlePromptDismissTimeout = null; }
  clearIdleActivityCheck();
}

/**
 * Called by ActivityWorker when idle crosses the configured threshold while timer is running.
 *
 * New flow (Time-Doctor style):
 *   1. Record when the user went idle — do NOT pause the timer yet.
 *   2. Push the warning prompt — timer keeps running visually during the countdown.
 *   3. If the user responds before the countdown expires → just dismiss ("Back to work")
 *      or stop retroactively ("I'm on break").
 *   4. If countdown expires → retroactively stop at idleStartedAt so idle time is
 *      excluded from Worked Today, then push a stopped-confirmation event.
 *
 * Worked Today correctness: sessions are closed at idleStartedAt (not at stop time),
 * so idle time is never counted regardless of when the user actually responds.
 */
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
  // Guard: if a prompt is already showing, ignore re-triggers caused by mouse movement
  // resetting the OS idle timer. Without this, each mouse move while the prompt is visible
  // would call clearIdleTimeout() (killing the ActivityWorker callback + auto-stop timer)
  // and reset the countdown, effectively dismissing on mouse movement.
  if (idleStartedAt !== null) {
    console.log(`[Main] handleIdleUx — skipped: prompt already active (idleStartedAt=${idleStartedAt.toISOString()})`);
    return;
  }

  // Capture idle start time — used for retroactive session close if the timer stops.
  // The timer is NOT paused here; it keeps running so the UI remains active.
  idleStartedAt = new Date(Date.now() - idleSeconds * 1000);

  const countdown = idleCountdownSeconds;
  console.log(`[Main] idle.warning — idleSeconds=${idleSeconds} countdown=${countdown}s idleStartedAt=${idleStartedAt.toISOString()}`);

  // Bring the window above all other windows so the prompt is visible regardless of focus
  raiseForIdlePrompt();

  console.log(`[Main] sending agent:idle-prompt to renderer — idleSeconds=${idleSeconds} countdownSeconds=${countdown}`);
  mainWindow?.webContents.send("agent:idle-prompt", { idleSeconds, countdownSeconds: countdown });

  // Register a one-shot callback on ActivityWorker (uiohook: global keydown/mousedown).
  // Must NOT treat clicks inside the agent window as "resume" — those belong to the modal
  // (e.g. "No, I'm not working") or the renderer's idle-card rules.
  clearIdleTimeout();
  if (activityWorker) {
    idleActivityCheckActive = true;
    activityWorker.setIdleInputCallback((payload: IdleGlobalInputPayload) => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        if (payload.kind === "mousedown") {
          const b = mainWindow.getBounds();
          const { x, y } = payload;
          if (x >= b.x && x < b.x + b.width && y >= b.y && y < b.y + b.height) {
            return false;
          }
        }
        if (payload.kind === "keydown" && mainWindow.isFocused()) {
          return false;
        }
      }
      idleActivityCheckActive = false;
      console.log("[Main] idle.globalActivity — dismiss as resume (outside agent window / key while unfocused)");
      clearIdleTimeout();
      releaseIdleOnTop();
      idleStartedAt = null;
      mainWindow?.webContents.send("agent:idle-dismiss");
    });
  }

  // Auto-stop after countdown expires — retroactively excludes idle time from Worked Today
  idlePromptDismissTimeout = setTimeout(() => {
    idlePromptDismissTimeout = null;
    clearIdleActivityCheck();
    const currentEntryId = store.getActiveEntryId();
    const capturedIdleStartedAt = idleStartedAt;
    idleStartedAt = null;

    releaseIdleOnTop();
    if (currentEntryId && store.getTimerStatus() === "running" && capturedIdleStartedAt) {
      // Retroactively close session at when idle started, then stop
      store.setTimerPaused(capturedIdleStartedAt);
      store.clearTimer();
      queue.enqueueTimerCommand({ clientCommandId: randomUUID(), type: "stop", entryId: currentEntryId });
      pushStateToRenderer();
      syncWorker?.triggerSync();
      // Compute actual idle duration from idleStartedAt to now — more accurate than
      // the threshold-crossing idleSeconds which was captured earlier.
      const actualIdleSeconds = Math.round((Date.now() - capturedIdleStartedAt.getTime()) / 1000);
      console.log(`[Main] idle.autoStop — countdown expired, timer stopped retroactively at ${capturedIdleStartedAt.toISOString()} (actualIdleSeconds=${actualIdleSeconds})`);
      // Push stopped-confirmation so renderer shows the second modal
      mainWindow?.webContents.send("agent:idle-stopped", {
        idleSeconds: actualIdleSeconds,
        idleStartedAt: capturedIdleStartedAt.toISOString(),
      });
    } else {
      mainWindow?.webContents.send("agent:idle-dismiss");
    }
  }, countdown * 1000);
}

/** Renderer: user chose "No, I'm not working" — same outcome as countdown expiry: not running anymore. */
ipcMain.handle("agent:idle-break", () => {
  clearIdleTimeout();
  releaseIdleOnTop();
  const entryId = store.getActiveEntryId();
  const capturedIdleStartedAt = idleStartedAt;
  idleStartedAt = null;

  if (entryId && store.getTimerStatus() === "running") {
    // Match idle.autoStop: close session at idle start, clear local active timer, enqueue stop.
    // (Pause-only left the entry active; server resync could flip UI back to "running" briefly.)
    store.setTimerPaused(capturedIdleStartedAt ?? undefined);
    store.clearTimer();
    queue.enqueueTimerCommand({ clientCommandId: randomUUID(), type: "stop", entryId });
    pushStateToRenderer();
    syncWorker?.triggerSync();
    const ts = capturedIdleStartedAt ?? new Date();
    const actualIdleSeconds = Math.round((Date.now() - ts.getTime()) / 1000);
    console.log(
      `[Main] idle.break confirmed — timer stopped retroactively at ${ts.toISOString()} (actualIdleSeconds=${actualIdleSeconds})`
    );
    mainWindow?.webContents.send("agent:idle-stopped", {
      idleSeconds: actualIdleSeconds,
      idleStartedAt: ts.toISOString(),
    });
  } else if (entryId && store.getTimerStatus() === "paused") {
    console.log("[Main] idle.break confirmed — timer was already paused, no-op");
    mainWindow?.webContents.send("agent:idle-dismiss");
  } else {
    mainWindow?.webContents.send("agent:idle-dismiss");
  }
  return { ok: true };
});

/** Renderer: user chose "Yes, keep tracking" — timer was never paused, just dismiss the prompt. */
ipcMain.handle("agent:idle-resume", () => {
  clearIdleTimeout();
  releaseIdleOnTop();
  idleStartedAt = null;
  mainWindow?.webContents.send("agent:idle-dismiss");
  console.log("[Main] idle.resume confirmed — timer continues running");
  // Timer was not paused during the warning countdown, so no resume action is needed.
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
  const _testCountdown = process.env.DOCUFLOW_TEST_IDLE_COUNTDOWN_SECONDS;
  if (_testIdleMin || _testCountdown) {
    console.log(
      `[Main] TEST OVERRIDES active:` +
      (_testIdleMin    ? ` IDLE_TIMEOUT_MINUTES=${_testIdleMin}`       : "") +
      (_testCountdown  ? ` IDLE_COUNTDOWN_SECONDS=${_testCountdown}`   : "")
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
