import type { RuntimeConnectionMode } from "@/lib/connectionSettingsStorage";

export interface ActiveApiBaseUrlField {
  label: string;
  placeholder: string;
  value: string;
}

export function getActiveApiBaseUrlField(settings: {
  mode: RuntimeConnectionMode;
  localApiBaseUrl: string;
  remoteApiBaseUrl: string;
}): ActiveApiBaseUrlField {
  if (settings.mode === "remote") {
    return {
      label: "Remote API base URL",
      placeholder: "https://your-app.up.railway.app",
      value: settings.remoteApiBaseUrl
    };
  }

  return {
    label: "Local API base URL",
    placeholder: "http://localhost:8787",
    value: settings.localApiBaseUrl
  };
}

export function getApiTokenSourceHint(mode: RuntimeConnectionMode): string {
  if (mode === "remote") {
    return "set in Railway/service environment variables";
  }

  return "set in local API environment (.env)";
}

export function getPairingRealtimeErrorMessage(rawMessage: string): string {
  const normalized = rawMessage.trim().toLowerCase();
  if (
    normalized.includes("closed before subscription was established") ||
    normalized.includes("failed to open pairing realtime stream")
  ) {
    return "Session created, but realtime updates are unavailable. Continue manually: click Refresh, then 1) Approve Device and 2) Claim Token.";
  }

  return rawMessage;
}
