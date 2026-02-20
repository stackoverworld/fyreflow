import { app, BrowserWindow, ipcMain, nativeImage, nativeTheme, Notification, shell } from "electron";
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
      preload: path.join(__dirname, "preload.mjs"),
      contextIsolation: true,
      nodeIntegration: false
    }
  };

  // On macOS, rely on bundle icon metadata instead of runtime overrides.
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

app.whenReady().then(() => {
  createMainWindow();
  setMacDockIconSafely();

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
