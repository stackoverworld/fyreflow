import type { ProviderConfig } from "./types.js";

export function hasActiveClaudeApiKey(provider: ProviderConfig): boolean {
  if (provider.id !== "claude") {
    return false;
  }

  return provider.authMode === "api_key" && provider.apiKey.trim().length > 0;
}

export function isClaudeFastModeEnabledForInput(
  provider: ProviderConfig,
  requestedFastMode: boolean | undefined
): boolean {
  return requestedFastMode === true && hasActiveClaudeApiKey(provider);
}

export function getClaudeFastModeAvailabilityNote(
  provider: ProviderConfig,
  requestedFastMode: boolean | undefined
): string {
  if (provider.id !== "claude") {
    return "Fast mode is not applicable for the selected provider.";
  }

  if (hasActiveClaudeApiKey(provider)) {
    return requestedFastMode === true
      ? "Claude fast mode is enabled (active API key auth)."
      : "Claude fast mode is available (active API key auth) but currently disabled.";
  }

  if (requestedFastMode === true) {
    return "Claude fast mode was requested but disabled because no active API key auth is configured.";
  }

  if (provider.authMode !== "api_key") {
    return "Claude fast mode is unavailable: switch Provider Auth to API key mode and save a valid key.";
  }

  return "Claude fast mode is unavailable: save a valid Claude API key in Provider Auth.";
}
