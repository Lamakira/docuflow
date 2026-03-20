import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("widgetBridge", {
  getState: () => ipcRenderer.invoke("agent:get-state"),
  timerPause: () => ipcRenderer.invoke("agent:timer-pause"),
  timerResume: () => ipcRenderer.invoke("agent:timer-resume"),
  onStateUpdate: (callback: (state: any) => void) => {
    ipcRenderer.on("widget:state-update", (_event, state) => callback(state));
  },
});
