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
    return "set in Railway/service environment variables (DASHBOARD_API_TOKEN)";
  }

  return "set in local API environment (.env)";
}

export function getRemoteAuthErrorMessage(rawMessage: string, context: "connection" | "pairingAdmin"): string {
  const normalized = rawMessage.trim().toLowerCase();
  const isUnauthorized = normalized === "unauthorized" || normalized.includes("401");
  if (!isUnauthorized) {
    return rawMessage;
  }

  if (context === "pairingAdmin") {
    return "Unauthorized. For step 1 (Approve), paste DASHBOARD_API_TOKEN into \"Connection auth token\", click Save Connection, then retry.";
  }

  return "Unauthorized. Paste DASHBOARD_API_TOKEN (owner) or a claimed Device Token into \"Connection auth token\", then click Save Connection.";
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
