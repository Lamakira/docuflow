import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("widgetBridge", {
  getState: () => ipcRenderer.invoke("agent:get-state"),
  timerPause: () => ipcRenderer.invoke("agent:timer-pause"),
  timerResume: () => ipcRenderer.invoke("agent:timer-resume"),
  /** Hide the widget for the rest of this timer session. Does not stop tracking. */
  dismiss: () => ipcRenderer.invoke("widget:dismiss"),
  /** Bring the main DocuFlow window to the foreground. */
  openMain: () => ipcRenderer.invoke("widget:open-main"),
  onStateUpdate: (callback: (state: any) => void) => {
    ipcRenderer.on("widget:state-update", (_event, state) => callback(state));
  },
});
