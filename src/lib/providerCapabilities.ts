import type { ProviderConfig } from "@/lib/types";

function isNonEmpty(value: string): boolean {
  return value.trim().length > 0;
}

export function canUseClaudeFastMode(provider: ProviderConfig | null | undefined): boolean {
  if (!provider || provider.id !== "claude") {
    return false;
  }

  if (provider.authMode === "api_key") {
    return isNonEmpty(provider.apiKey);
  }

  return provider.authMode === "oauth";
}

export function getClaudeFastModeUnavailableNote(provider: ProviderConfig | null | undefined): string {
  if (!provider) {
    return "Fast mode is unavailable while provider settings are loading.";
  }

  if (provider.authMode === "api_key" && !isNonEmpty(provider.apiKey)) {
    return "Fast mode requires an active Claude API key in Provider Auth.";
  }

  return "";
}
