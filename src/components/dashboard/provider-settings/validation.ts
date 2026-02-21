import type {
  AuthMode,
  ProviderConfig,
  ProviderId,
  ProviderOAuthStatus
} from "@/lib/types";

export function shouldAutoSwitchToOAuth(args: {
  provider: ProviderConfig;
  status: ProviderOAuthStatus | null;
  hasAlreadyAutoSwitched: boolean;
}): boolean {
  if (!args.status?.loggedIn) {
    return false;
  }

  if (args.provider.authMode === "oauth") {
    return false;
  }

  if (args.provider.apiKey.trim().length > 0) {
    return false;
  }

  if (args.hasAlreadyAutoSwitched) {
    return false;
  }

  return true;
}

export function oauthStatusLine(
  status: ProviderOAuthStatus | null,
  fallbackMessage: string
): string {
  if (!status) {
    return fallbackMessage || "Checking status...";
  }

  return `${status.message} Last checked ${new Date(status.checkedAt).toLocaleTimeString()}.`;
}

export function shouldShowOAuthTokenInput(authMode: AuthMode, providerId: ProviderId): boolean {
  return authMode !== "oauth" || providerId === "openai";
}

export function shouldShowOAuthConnectedNote(provider: ProviderConfig, status: ProviderOAuthStatus | null): boolean {
  return provider.authMode === "api_key" && status?.loggedIn === true && provider.apiKey.trim().length === 0;
}
