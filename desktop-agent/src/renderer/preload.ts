/**
 * Preload script — exposes safe IPC bridge to renderer.
 * S4: pairing code removed, replaced with email+password login.
 */

import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("agentBridge", {
  // Auth
  getState: () => ipcRenderer.invoke("agent:get-state"),
  login: (data: { email: string; password: string }) =>
    ipcRenderer.invoke("agent:login", data),
  unpair: () => ipcRenderer.invoke("agent:unpair"),

  // Projects & Tasks
  getProjects: () => ipcRenderer.invoke("agent:get-projects"),
  getTasks: (data: { crmProjectId: string }) => ipcRenderer.invoke("agent:get-tasks", data),

  // Timer
  timerStart: (data: { crmProjectId: string; taskId?: string; taskName?: string; projectName: string; description?: string; taskDurationToday?: number }) =>
    ipcRenderer.invoke("agent:timer-start", data),
  timerPause: () => ipcRenderer.invoke("agent:timer-pause"),
  timerResume: () => ipcRenderer.invoke("agent:timer-resume"),
  timerStop: () => ipcRenderer.invoke("agent:timer-stop"),
  timerState: () => ipcRenderer.invoke("agent:timer-state"),

  // Open URL in default browser
  openExternal: (url: string) => ipcRenderer.invoke("agent:open-external", url),

  // Daily totals
  getWorkedToday: () => ipcRenderer.invoke("agent:get-worked-today"),
  getTodayBreakdown: () => ipcRenderer.invoke("agent:today-breakdown"),

  // Idle / break
  idleBreak: () => ipcRenderer.invoke("agent:idle-break"),
  idleResume: () => ipcRenderer.invoke("agent:idle-resume"),
  onIdlePrompt: (callback: (data: { idleSeconds: number; countdownSeconds: number }) => void) => {
    const handler = (_event: any, data: { idleSeconds: number; countdownSeconds: number }) => callback(data);
    ipcRenderer.on("agent:idle-prompt", handler);
    return () => ipcRenderer.off("agent:idle-prompt", handler);
  },
  onIdleDismiss: (callback: () => void) => {
    const handler = () => callback();
    ipcRenderer.on("agent:idle-dismiss", handler);
    return () => ipcRenderer.off("agent:idle-dismiss", handler);
  },
  onIdleStopped: (callback: (data: { idleSeconds: number; idleStartedAt: string }) => void) => {
    const handler = (_event: any, data: { idleSeconds: number; idleStartedAt: string }) => callback(data);
    ipcRenderer.on("agent:idle-stopped", handler);
    return () => ipcRenderer.off("agent:idle-stopped", handler);
  },

  // Login progress events pushed from main during waitForBackend + loginWithPassword
  onLoginProgress: (callback: (data: { message: string }) => void) => {
    const handler = (_event: any, data: { message: string }) => callback(data);
    ipcRenderer.on("agent:login-progress", handler);
    return () => ipcRenderer.off("agent:login-progress", handler);
  },

  // State push from main process
  onStateUpdate: (callback: (state: any) => void) => {
    ipcRenderer.on("agent:state-update", (_event, state) => callback(state));
  },

  // Local settings
  getLocalPrefs: () => ipcRenderer.invoke("settings:get-local-prefs"),
  setOpenAtLogin: (value: boolean) => ipcRenderer.invoke("settings:set-open-at-login", value),

  // Org policy (read-only, from last heartbeat)
  getOrgPolicy: () => ipcRenderer.invoke("settings:get-org-policy"),

  // Widget utilities
  resetWidgetPosition: () => ipcRenderer.invoke("widget:reset-position"),

  // Clipboard
  copyToClipboard: (text: string) => ipcRenderer.invoke("settings:copy-to-clipboard", text),

  // Display timezone preference
  getDisplayTimezone: (): Promise<'local' | 'utc'> => ipcRenderer.invoke("settings:get-display-timezone"),
  setDisplayTimezone: (tz: 'local' | 'utc') => ipcRenderer.invoke("settings:set-display-timezone", tz),

  // Period-based worked time (for hover card week/month aggregates)
  getWorkedPeriod: (startIso: string, endIso: string): Promise<{ ok: boolean; total: number }> =>
    ipcRenderer.invoke("agent:worked-period", startIso, endIso),
});
