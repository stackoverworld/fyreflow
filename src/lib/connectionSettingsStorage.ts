const CONNECTION_SETTINGS_STORAGE_KEY = "fyreflow:connection-settings";
export const CONNECTION_SETTINGS_CHANGED_EVENT = "fyreflow:connection-changed";

const DEFAULT_LOCAL_API_BASE_URL = (import.meta.env.VITE_API_BASE_URL ?? "http://localhost:8787").trim();
const DEFAULT_API_TOKEN = (import.meta.env.VITE_DASHBOARD_API_TOKEN ?? "").trim();
const DEFAULT_REALTIME_PATH = (import.meta.env.VITE_REALTIME_WS_PATH ?? "/api/ws").trim();

export type RuntimeConnectionMode = "local" | "remote";

export interface ConnectionSettings {
  mode: RuntimeConnectionMode;
  localApiBaseUrl: string;
  remoteApiBaseUrl: string;
  apiToken: string;
  realtimePath: string;
  deviceToken: string;
}

function normalizeApiBaseUrl(raw: unknown, fallback: string): string {
  if (typeof raw !== "string") {
    return fallback;
  }

  const trimmed = raw.trim();
  if (trimmed.length === 0) {
    return fallback;
  }

  try {
    const url = new URL(trimmed);
    return url.toString().replace(/\/+$/, "");
  } catch {
    return fallback;
  }
}

function normalizeRealtimePath(raw: unknown): string {
  if (typeof raw !== "string") {
    return DEFAULT_REALTIME_PATH;
  }

  const trimmed = raw.trim();
  if (trimmed.length === 0) {
    return DEFAULT_REALTIME_PATH;
  }

  return trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
}

function getDefaultConnectionSettings(): ConnectionSettings {
  return {
    mode: "local",
    localApiBaseUrl: normalizeApiBaseUrl(DEFAULT_LOCAL_API_BASE_URL, "http://localhost:8787"),
    remoteApiBaseUrl: normalizeApiBaseUrl(DEFAULT_LOCAL_API_BASE_URL, "http://localhost:8787"),
    apiToken: DEFAULT_API_TOKEN,
    realtimePath: normalizeRealtimePath(DEFAULT_REALTIME_PATH),
    deviceToken: ""
  };
}

function normalizeConnectionSettings(raw: unknown): ConnectionSettings {
  const defaults = getDefaultConnectionSettings();
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return defaults;
  }

  const value = raw as Partial<ConnectionSettings>;
  return {
    mode: value.mode === "remote" ? "remote" : "local",
    localApiBaseUrl: normalizeApiBaseUrl(value.localApiBaseUrl, defaults.localApiBaseUrl),
    remoteApiBaseUrl: normalizeApiBaseUrl(value.remoteApiBaseUrl, defaults.remoteApiBaseUrl),
    apiToken: typeof value.apiToken === "string" ? value.apiToken.trim() : defaults.apiToken,
    realtimePath: normalizeRealtimePath(value.realtimePath),
    deviceToken: typeof value.deviceToken === "string" ? value.deviceToken.trim() : defaults.deviceToken
  };
}

export function loadConnectionSettings(): ConnectionSettings {
  if (typeof window === "undefined") {
    return getDefaultConnectionSettings();
  }

  try {
    const raw = window.localStorage.getItem(CONNECTION_SETTINGS_STORAGE_KEY);
    if (!raw) {
      return getDefaultConnectionSettings();
    }

    return normalizeConnectionSettings(JSON.parse(raw));
  } catch {
    return getDefaultConnectionSettings();
  }
}

function saveConnectionSettingsInternal(settings: ConnectionSettings): void {
  if (typeof window === "undefined") {
    return;
  }

  try {
    window.localStorage.setItem(CONNECTION_SETTINGS_STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // Ignore write errors.
  }
}

export function saveConnectionSettings(patch: Partial<ConnectionSettings>): ConnectionSettings {
  const current = loadConnectionSettings();
  const next = normalizeConnectionSettings({
    ...current,
    ...patch
  });

  saveConnectionSettingsInternal(next);
  return next;
}

export function setConnectionSettings(next: ConnectionSettings): ConnectionSettings {
  const normalized = normalizeConnectionSettings(next);
  saveConnectionSettingsInternal(normalized);
  return normalized;
}

export function getActiveConnectionSettings(settings: ConnectionSettings = loadConnectionSettings()): {
  mode: RuntimeConnectionMode;
  apiBaseUrl: string;
  apiToken: string;
  realtimePath: string;
  deviceToken: string;
} {
  return {
    mode: settings.mode,
    apiBaseUrl: settings.mode === "remote" ? settings.remoteApiBaseUrl : settings.localApiBaseUrl,
    apiToken: settings.apiToken,
    realtimePath: settings.realtimePath,
    deviceToken: settings.deviceToken
  };
}

export function notifyConnectionSettingsChanged(): void {
  if (typeof window === "undefined") {
    return;
  }

  window.dispatchEvent(new Event(CONNECTION_SETTINGS_CHANGED_EVENT));
}
