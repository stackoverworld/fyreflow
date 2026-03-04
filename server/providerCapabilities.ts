import type { ProviderConfig } from "./types.js";

export function canClaudeUseFastMode(provider: ProviderConfig): boolean {
  if (provider.id !== "claude") {
    return false;
  }

  if (provider.authMode === "api_key") {
    return provider.apiKey.trim().length > 0;
  }

  return provider.authMode === "oauth";
}

export function isClaudeFastModeEnabledForInput(
  provider: ProviderConfig,
  requestedFastMode: boolean | undefined
): boolean {
  return requestedFastMode === true && canClaudeUseFastMode(provider);
}

export function getClaudeFastModeAvailabilityNote(
  provider: ProviderConfig,
  requestedFastMode: boolean | undefined
): string {
  if (provider.id !== "claude") {
    return "Fast mode is not applicable for the selected provider.";
  }

  if (canClaudeUseFastMode(provider)) {
    return requestedFastMode === true
      ? "Claude fast mode is enabled."
      : "Claude fast mode is available but currently disabled.";
  }

  if (requestedFastMode === true) {
    return "Claude fast mode was requested but disabled because no active credential is configured.";
  }

  if (provider.authMode === "api_key") {
    return "Claude fast mode is unavailable: save a valid Claude API key in Provider Auth.";
  }

  return "Claude fast mode is unavailable: configure Provider Auth credentials.";
}
