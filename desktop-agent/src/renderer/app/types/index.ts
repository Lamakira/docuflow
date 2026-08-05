export interface Project {
  id: string;
  name: string;
}

export interface Task {
  id: string;
  name: string;
  crmProjectId: string;
  durationToday?: number;
}

export type TimerStatus = 'running' | 'paused' | 'stopped';

export interface TimerState {
  status: TimerStatus;
  elapsed: number;      // total entry elapsed (unclamped) — for server reconciliation
  elapsedToday: number; // entry elapsed clamped to current local day — use this for UI display
  workedToday: number;  // all tasks today, clamped to current local day (all devices)
  thisSession: number;  // total tracked since this app launch (all tasks, not day-scoped)
  dayKey: string;       // local calendar day or synthetic test-day key (midnight rollover detection)
  entryId: string | null;
  taskId: string | null;
  projectName: string | null;
  taskName: string | null;
  description: string | null;
}

export interface AgentState {
  isPaired: boolean;
  deviceName: string | null;
  userEmail: string | null;
  apiHost: string | null;
  apiBase: string | null;
  apiBaseSource: string | null;
  timer: TimerState;
}

export interface RecentTask {
  crmProjectId: string;
  taskId: string | null;
  taskName: string | null;
  projectName: string;
  description: string | null;
}

export type AppPage = 'timer' | 'activity' | 'screenshots' | 'settings';

export interface BreakdownRow {
  projectName: string;
  taskId: string | null;
  taskName: string | null;
  stoppedSeconds: number;
  activeSeconds?: number; // only on the currently running row, overlaid by main process
}

export interface AgentBridge {
  getState: () => Promise<AgentState>;
  login: (data: { email: string; password: string }) => Promise<{ ok: boolean; error?: string }>;
  unpair: () => Promise<{ ok: boolean }>;
  getProjects: () => Promise<{ ok: boolean; data: Project[]; error?: string }>;
  /** Fails with "Access denied" when the user is not a member of the project. */
  getTasks: (data: { crmProjectId: string }) => Promise<{ ok: boolean; data: Task[]; error?: string }>;
  /** Creates a CRM project on the server — it appears in the web app too. */
  createProject: (data: { name: string }) => Promise<{ ok: boolean; data?: Project; error?: string }>;
  createTask: (data: { crmProjectId: string; name: string }) => Promise<{ ok: boolean; data?: Task; error?: string }>;
  timerStart: (data: {
    crmProjectId: string;
    taskId?: string;
    taskName?: string;
    projectName: string;
    description?: string;
    taskDurationToday?: number; // seeds elapsedToday immediately, avoids 0→jump on restart
  }) => Promise<{ ok: boolean; entry?: any; error?: string }>;
  timerPause: () => Promise<{ ok: boolean; error?: string }>;
  timerResume: () => Promise<{ ok: boolean; error?: string }>;
  timerStop: () => Promise<{ ok: boolean; error?: string }>;
  timerState: () => Promise<TimerState>;
  openExternal: (url: string) => void;
  checkUpdate: () => Promise<{
    ok: boolean;
    updateAvailable?: boolean;
    currentVersion: string;
    latestVersion?: string;
    downloadUrl?: string;
    error?: string;
  }>;
  getWorkedToday: () => Promise<{ ok: boolean; total: number }>;
  idleBreak: () => Promise<{ ok: boolean }>;
  idleResume: () => Promise<{ ok: boolean; error?: string }>;
  onIdlePrompt: (cb: (data: { idleSeconds: number }) => void) => () => void;
  onIdleDismiss: (cb: () => void) => () => void;
  getTodayBreakdown: () => Promise<{ ok: boolean; rows: BreakdownRow[]; error?: string }>;
  onLoginProgress: (cb: (data: { message: string }) => void) => () => void;
  onStateUpdate: (cb: (state: any) => void) => void;
  getLocalPrefs: () => Promise<{ openAtLogin: boolean; isPackaged: boolean; appVersion: string }>;
  setOpenAtLogin: (value: boolean) => Promise<{ ok: boolean }>;
  resetWidgetPosition: () => Promise<{ ok: boolean }>;
  /**
   * Ask the main process for the window size this UI needs. Optional: v1 never
   * calls it and keeps the portrait window the app is created with.
   */
  setWindowLayout?: (layout: {
    width: number;
    height: number;
    minWidth: number;
    minHeight: number;
    /** Pre-paint fill. Ignored on a transparent window. */
    background?: string;
    /** 'app' when this UI draws its own title bar; remembered for next launch. */
    chrome?: 'app' | 'native';
  }) => Promise<{ ok: boolean; chromeApplied?: boolean }>;

  /* Window controls. Present only in builds whose preload exposes them, and
     only meaningful when the window was created without a native frame. */
  windowMinimize?: () => Promise<{ ok: boolean }>;
  windowToggleMaximize?: () => Promise<{ ok: boolean; maximized: boolean }>;
  windowHide?: () => Promise<{ ok: boolean }>;
  windowIsMaximized?: () => Promise<{ maximized: boolean }>;
  onWindowMaximizedChange?: (cb: (maximized: boolean) => void) => () => void;
  copyToClipboard: (text: string) => Promise<{ ok: boolean }>;
  getDisplayTimezone: () => Promise<'local' | 'utc'>;
  setDisplayTimezone: (tz: 'local' | 'utc') => Promise<{ ok: boolean }>;
  getWorkedPeriod: (startIso: string, endIso: string) => Promise<{ ok: boolean; total: number }>;
  getOrgPolicy: () => Promise<{
    screenshotsEnabled: boolean;
    idlePromptEnabled: boolean;
    idleTimeoutMinutes: number;
    idleCountdownSeconds: number;
  } | null>;
  listScreenshots: () => Promise<{
    ok: boolean;
    data: Array<{ filename: string; timestampMs: number; sizeKb: number; projectName: string | null; taskName: string | null }>;
  }>;
  readScreenshot: (filename: string) => Promise<{ ok: boolean; dataUrl?: string }>;
}

declare global {
  interface Window {
    agentBridge: AgentBridge;
  }
}

export function formatTime(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  return [h, m, s].map((v) => String(v).padStart(2, '0')).join(':');
}

/** Format as "Xh MMm" — used for Worked Today (no seconds) */
export function formatWorkedToday(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return `${h}h ${String(m).padStart(2, '0')}m`;
}
