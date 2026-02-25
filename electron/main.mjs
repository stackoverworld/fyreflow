import { app, autoUpdater, BrowserWindow, dialog, ipcMain, nativeImage, nativeTheme, Notification, shell } from "electron";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

app.setName("FyreFlow");

function resolveMacDockIconCandidates() {
  const candidates = [
    path.join(__dirname, "icon.png"),
    path.join(__dirname, "icon.icns"),
    path.join(process.resourcesPath, "electron.icns")
  ];

  return candidates.filter((candidate) => existsSync(candidate));
}

function setMacDockIconSafely() {
  if (process.platform !== "darwin") {
    return;
  }

  const isDev = Boolean(process.env.ELECTRON_RENDERER_URL);
  const iconPaths = resolveMacDockIconCandidates();
  if (iconPaths.length === 0) {
    return;
  }

  for (const iconPath of iconPaths) {
    try {
      const iconImage = nativeImage.createFromPath(iconPath);
      if (iconImage.isEmpty()) {
        continue;
      }

      app.dock.setIcon(iconImage);
      if (isDev) {
        console.log(`[dock-icon] Using ${iconPath}`);
      }
      return;
    } catch (error) {
      console.warn(`[dock-icon] Failed to set icon from "${iconPath}"`, error);
    }
  }

  if (isDev) {
    console.warn("[dock-icon] Could not load any configured dock icon candidates.");
  }
}

const rendererUrl = process.env.ELECTRON_RENDERER_URL;
const indexHtmlPath = path.join(__dirname, "..", "dist", "index.html");
const MAX_NOTIFICATION_TITLE_LENGTH = 120;
const MAX_NOTIFICATION_BODY_LENGTH = 400;
const MAX_REVEAL_PATH_LENGTH = 2048;
const desktopUpdateFeedUrl = (process.env.FYREFLOW_DESKTOP_UPDATE_FEED_URL ?? "").trim();
const DESKTOP_UPDATE_CHECK_DEFAULT_INTERVAL_MS = 60 * 60 * 1000;
const DESKTOP_UPDATE_CHECK_MIN_INTERVAL_MS = 5 * 60 * 1000;
const DESKTOP_UPDATE_CHECK_MAX_INTERVAL_MS = 24 * 60 * 60 * 1000;
const desktopUpdateCheckIntervalMs = (() => {
  const raw = process.env.FYREFLOW_DESKTOP_UPDATE_CHECK_INTERVAL_MS;
  const parsed = Number.parseInt(raw ?? "", 10);
  if (!Number.isFinite(parsed)) {
    return DESKTOP_UPDATE_CHECK_DEFAULT_INTERVAL_MS;
  }

  return Math.max(
    DESKTOP_UPDATE_CHECK_MIN_INTERVAL_MS,
    Math.min(DESKTOP_UPDATE_CHECK_MAX_INTERVAL_MS, parsed)
  );
})();
const desktopUpdateSupported = process.platform === "darwin" || process.platform === "win32";
let desktopUpdateCheckInFlight = false;
let desktopUpdateTimer = null;

function normalizeNotificationPayload(raw) {
  if (!raw || typeof raw !== "object") {
    return null;
  }

  const titleValue = typeof raw.title === "string" ? raw.title.trim() : "";
  if (!titleValue) {
    return null;
  }

  const bodyValue = typeof raw.body === "string" ? raw.body.trim() : "";
  return {
    title: titleValue.slice(0, MAX_NOTIFICATION_TITLE_LENGTH),
    body: bodyValue.slice(0, MAX_NOTIFICATION_BODY_LENGTH)
  };
}

function normalizeRevealPathPayload(raw) {
  if (!raw || typeof raw !== "object") {
    return null;
  }

  const pathValue = typeof raw.path === "string" ? raw.path.trim() : "";
  if (!pathValue) {
    return null;
  }

  return {
    path: pathValue.slice(0, MAX_REVEAL_PATH_LENGTH)
  };
}

function createMainWindow() {
  const bgColor = nativeTheme.shouldUseDarkColors ? "#131314" : "#faf9f0";
  const windowOptions = {
    width: 1440,
    height: 900,
    minWidth: 1100,
    minHeight: 700,
    backgroundColor: bgColor,
    titleBarStyle: "hiddenInset",
    trafficLightPosition: { x: 16, y: 13 },
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false
    }
  };

  if (process.platform !== "darwin") {
    windowOptions.icon = path.join(__dirname, "icon.png");
  }

  const window = new BrowserWindow(windowOptions);

  window.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url);
    return { action: "deny" };
  });

  if (rendererUrl) {
    void window.loadURL(rendererUrl);
    window.webContents.openDevTools({ mode: "detach" });
    return;
  }

  void window.loadFile(indexHtmlPath);
}

async function checkForDesktopUpdates(trigger) {
  if (!desktopUpdateSupported || desktopUpdateFeedUrl.length === 0 || rendererUrl || desktopUpdateCheckInFlight) {
    return;
  }

  desktopUpdateCheckInFlight = true;
  try {
    await autoUpdater.checkForUpdates();
    console.log(`[desktop-updates] checked (${trigger})`);
  } catch (error) {
    console.warn(`[desktop-updates] check failed (${trigger})`, error);
  } finally {
    desktopUpdateCheckInFlight = false;
  }
}

function setupDesktopAutoUpdater() {
  if (rendererUrl) {
    return;
  }

  if (!desktopUpdateSupported) {
    console.warn("[desktop-updates] auto-update is supported only on macOS/Windows.");
    return;
  }

  if (desktopUpdateFeedUrl.length === 0) {
    console.log("[desktop-updates] FYREFLOW_DESKTOP_UPDATE_FEED_URL is not set; skipping desktop auto-update checks.");
    return;
  }

  try {
    autoUpdater.setFeedURL({ url: desktopUpdateFeedUrl });
  } catch (error) {
    console.warn("[desktop-updates] failed to configure feed URL", error);
    return;
  }

  autoUpdater.on("error", (error) => {
    console.warn("[desktop-updates] updater error", error);
  });

  autoUpdater.on("update-available", () => {
    console.log("[desktop-updates] update available; downloading.");
  });

  autoUpdater.on("update-not-available", () => {
    console.log("[desktop-updates] already on latest desktop version.");
  });

  autoUpdater.on("update-downloaded", async () => {
    try {
      const result = await dialog.showMessageBox({
        type: "info",
        buttons: ["Restart now", "Later"],
        defaultId: 0,
        cancelId: 1,
        title: "Update ready",
        message: "A new desktop version has been downloaded.",
        detail: "Restart FyreFlow to apply the update."
      });

      if (result.response === 0) {
        autoUpdater.quitAndInstall();
      }
    } catch (error) {
      console.warn("[desktop-updates] failed to apply downloaded update", error);
    }
  });

  void checkForDesktopUpdates("startup");
  desktopUpdateTimer = setInterval(() => {
    void checkForDesktopUpdates("interval");
  }, desktopUpdateCheckIntervalMs);
}

ipcMain.handle("window:minimize", (event) => {
  BrowserWindow.fromWebContents(event.sender)?.minimize();
});

ipcMain.handle("window:maximize", (event) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (win?.isMaximized()) {
    win.unmaximize();
  } else {
    win?.maximize();
  }
});

ipcMain.handle("window:close", (event) => {
  BrowserWindow.fromWebContents(event.sender)?.close();
});

ipcMain.handle("desktop:notify", (event, payload) => {
  if (!Notification.isSupported()) {
    return { ok: false, reason: "unsupported" };
  }

  const normalized = normalizeNotificationPayload(payload);
  if (!normalized) {
    return { ok: false, reason: "invalid_payload" };
  }

  const notification = new Notification({
    title: normalized.title,
    body: normalized.body
  });

  notification.on("click", () => {
    const targetWindow = BrowserWindow.fromWebContents(event.sender);
    if (!targetWindow) {
      return;
    }

    if (targetWindow.isMinimized()) {
      targetWindow.restore();
    }
    targetWindow.show();
    targetWindow.focus();
  });

  notification.show();
  return { ok: true };
});

ipcMain.handle("desktop:reveal-path", (event, payload) => {
  const normalized = normalizeRevealPathPayload(payload);
  if (!normalized) {
    return { ok: false, reason: "invalid_payload" };
  }

  const targetWindow = BrowserWindow.fromWebContents(event.sender);
  if (targetWindow && targetWindow.isMinimized()) {
    targetWindow.restore();
  }

  return shell.openPath(normalized.path).then((errorMessage) => {
    if (errorMessage && errorMessage.trim().length > 0) {
      return { ok: false, reason: "open_failed", message: errorMessage };
    }

    return { ok: true };
  });
});

app.whenReady().then(() => {
  createMainWindow();
  setMacDockIconSafely();
  setupDesktopAutoUpdater();

  app.on("activate", () => {
    setMacDockIconSafely();
    if (BrowserWindow.getAllWindows().length === 0) {
      createMainWindow();
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("before-quit", () => {
  if (desktopUpdateTimer) {
    clearInterval(desktopUpdateTimer);
    desktopUpdateTimer = null;
  }
});
