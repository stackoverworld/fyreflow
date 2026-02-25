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
    return "set in your server's environment variables";
  }

  return "set in your local .env file";
}

export function getRemoteAuthErrorMessage(rawMessage: string, context: "connection" | "pairingAdmin"): string {
  const normalized = rawMessage.trim().toLowerCase();
  const isUnauthorized = normalized === "unauthorized" || normalized.includes("401");
  if (!isUnauthorized) {
    return rawMessage;
  }

  if (context === "pairingAdmin") {
    return "Authorization failed. Make sure the admin token is set in the auth token field above, then try again.";
  }

  return "Authorization failed. Check that your auth token is correct and saved.";
}

export function getPairingRealtimeErrorMessage(rawMessage: string): string {
  const normalized = rawMessage.trim().toLowerCase();
  if (
    normalized.includes("closed before subscription was established") ||
    normalized.includes("failed to open pairing realtime stream")
  ) {
    return "Live updates unavailable. Use the buttons below to continue the pairing flow manually.";
  }

  return rawMessage;
}
