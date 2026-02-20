const APP_SETTINGS_STORAGE_KEY = "fyreflow:app-settings";

export type ThemePreference = "system" | "light" | "dark";

export interface DesktopNotificationSettings {
  enabled: boolean;
  inputRequired: boolean;
  runFailed: boolean;
  runCompleted: boolean;
}

export interface AppSettings {
  debugEnabled: boolean;
  theme: ThemePreference;
  desktopNotifications: DesktopNotificationSettings;
}

const DEFAULT_APP_SETTINGS: AppSettings = {
  debugEnabled: true,
  theme: "system",
  desktopNotifications: {
    enabled: true,
    inputRequired: true,
    runFailed: true,
    runCompleted: true
  }
};

const VALID_THEMES: ThemePreference[] = ["system", "light", "dark"];
const DEFAULT_NOTIFICATION_SETTINGS = DEFAULT_APP_SETTINGS.desktopNotifications;

function normalizeDesktopNotifications(value: unknown): DesktopNotificationSettings {
  if (!value || typeof value !== "object") {
    return { ...DEFAULT_NOTIFICATION_SETTINGS };
  }

  const notifications = value as Partial<DesktopNotificationSettings>;
  return {
    enabled:
      typeof notifications.enabled === "boolean" ? notifications.enabled : DEFAULT_NOTIFICATION_SETTINGS.enabled,
    inputRequired:
      typeof notifications.inputRequired === "boolean"
        ? notifications.inputRequired
        : DEFAULT_NOTIFICATION_SETTINGS.inputRequired,
    runFailed:
      typeof notifications.runFailed === "boolean" ? notifications.runFailed : DEFAULT_NOTIFICATION_SETTINGS.runFailed,
    runCompleted:
      typeof notifications.runCompleted === "boolean"
        ? notifications.runCompleted
        : DEFAULT_NOTIFICATION_SETTINGS.runCompleted
  };
}

function normalizeAppSettings(value: unknown): AppSettings {
  if (!value || typeof value !== "object") {
    return DEFAULT_APP_SETTINGS;
  }

  const settings = value as Partial<AppSettings>;

  return {
    debugEnabled: typeof settings.debugEnabled === "boolean" ? settings.debugEnabled : DEFAULT_APP_SETTINGS.debugEnabled,
    theme: typeof settings.theme === "string" && VALID_THEMES.includes(settings.theme as ThemePreference)
      ? (settings.theme as ThemePreference)
      : DEFAULT_APP_SETTINGS.theme,
    desktopNotifications: normalizeDesktopNotifications(settings.desktopNotifications)
  };
}

export function loadAppSettings(): AppSettings {
  if (typeof window === "undefined") {
    return DEFAULT_APP_SETTINGS;
  }

  try {
    const raw = window.localStorage.getItem(APP_SETTINGS_STORAGE_KEY);
    if (!raw) {
      return DEFAULT_APP_SETTINGS;
    }
    return normalizeAppSettings(JSON.parse(raw));
  } catch {
    return DEFAULT_APP_SETTINGS;
  }
}

export function saveAppSettings(settings: AppSettings): void {
  if (typeof window === "undefined") {
    return;
  }

  try {
    window.localStorage.setItem(APP_SETTINGS_STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // Ignore write errors.
  }
}
