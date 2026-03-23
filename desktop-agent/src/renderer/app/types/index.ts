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
  elapsed: number;     // seconds for the current entry (session-derived + server base)
  workedToday: number; // seconds across all tasks today (session-derived)
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
