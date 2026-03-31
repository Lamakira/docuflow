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
  getProjects: () => Promise<{ ok: boolean; data: Project[] }>;
  getTasks: (data: { crmProjectId: string }) => Promise<{ ok: boolean; data: Task[] }>;
  timerStart: (data: {
    crmProjectId: string;
    taskId?: string;
    taskName?: string;
    projectName: string;
    description?: string;
  }) => Promise<{ ok: boolean; entry?: any; error?: string }>;
  timerPause: () => Promise<{ ok: boolean; error?: string }>;
  timerResume: () => Promise<{ ok: boolean; error?: string }>;
  timerStop: () => Promise<{ ok: boolean; error?: string }>;
  timerState: () => Promise<TimerState>;
  openExternal: (url: string) => void;
  getWorkedToday: () => Promise<{ ok: boolean; total: number }>;
  idleBreak: () => Promise<{ ok: boolean }>;
  idleResume: () => Promise<{ ok: boolean; error?: string }>;
  onIdlePrompt: (cb: (data: { idleSeconds: number }) => void) => () => void;
  onIdleDismiss: (cb: () => void) => () => void;
  getTodayBreakdown: () => Promise<{ ok: boolean; rows: BreakdownRow[]; error?: string }>;
  onLoginProgress: (cb: (data: { message: string }) => void) => () => void;
  onStateUpdate: (cb: (state: any) => void) => void;
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
