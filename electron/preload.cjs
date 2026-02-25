const { contextBridge, ipcRenderer } = require("electron");

const platform = typeof process !== "undefined" && typeof process.platform === "string" ? process.platform : "unknown";
const appVersion =
  typeof process !== "undefined" && process?.env && typeof process.env.npm_package_version === "string"
    ? process.env.npm_package_version.trim()
    : "";

contextBridge.exposeInMainWorld("desktop", {
  isElectron: true,
  platform,
  appVersion,
  minimize: () => ipcRenderer.invoke("window:minimize"),
  maximize: () => ipcRenderer.invoke("window:maximize"),
  close: () => ipcRenderer.invoke("window:close"),
  notify: (payload) => ipcRenderer.invoke("desktop:notify", payload),
  revealPath: (payload) => ipcRenderer.invoke("desktop:reveal-path", payload)
});
