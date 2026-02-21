const { contextBridge, ipcRenderer } = require("electron");

const platform = typeof process !== "undefined" && typeof process.platform === "string" ? process.platform : "unknown";

contextBridge.exposeInMainWorld("desktop", {
  isElectron: true,
  platform,
  minimize: () => ipcRenderer.invoke("window:minimize"),
  maximize: () => ipcRenderer.invoke("window:maximize"),
  close: () => ipcRenderer.invoke("window:close"),
  notify: (payload) => ipcRenderer.invoke("desktop:notify", payload),
  revealPath: (payload) => ipcRenderer.invoke("desktop:reveal-path", payload)
});
