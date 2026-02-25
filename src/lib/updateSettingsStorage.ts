const UPDATE_SETTINGS_STORAGE_KEY = "fyreflow:update-settings";

export interface UpdateSettings {
  updaterBaseUrl: string;
  updaterAuthToken: string;
}

function normalizeBaseUrl(raw: unknown): string {
  if (typeof raw !== "string") {
    return "http://localhost:8788";
  }

  const trimmed = raw.trim();
  if (trimmed.length === 0) {
    return "http://localhost:8788";
  }

  try {
    return new URL(trimmed).toString().replace(/\/+$/, "");
  } catch {
    return "http://localhost:8788";
  }
}

function getDefaultSettings(): UpdateSettings {
  return {
    updaterBaseUrl: "http://localhost:8788",
    updaterAuthToken: ""
  };
}

function normalizeSettings(raw: unknown): UpdateSettings {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return getDefaultSettings();
  }

  const value = raw as Partial<UpdateSettings>;
  const defaults = getDefaultSettings();

  return {
    updaterBaseUrl: normalizeBaseUrl(value.updaterBaseUrl),
    updaterAuthToken: typeof value.updaterAuthToken === "string" ? value.updaterAuthToken.trim() : defaults.updaterAuthToken
  };
}

export function loadUpdateSettings(): UpdateSettings {
  if (typeof window === "undefined") {
    return getDefaultSettings();
  }

  try {
    const raw = window.localStorage.getItem(UPDATE_SETTINGS_STORAGE_KEY);
    if (!raw) {
      return getDefaultSettings();
    }

    return normalizeSettings(JSON.parse(raw));
  } catch {
    return getDefaultSettings();
  }
}

export function saveUpdateSettings(next: UpdateSettings): UpdateSettings {
  const normalized = normalizeSettings(next);
  if (typeof window !== "undefined") {
    try {
      window.localStorage.setItem(UPDATE_SETTINGS_STORAGE_KEY, JSON.stringify(normalized));
    } catch {
      // Ignore storage write errors.
    }
  }

  return normalized;
}
