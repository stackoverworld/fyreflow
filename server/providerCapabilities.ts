import type { ProviderConfig } from "./types.js";
import type { ProviderOAuthStatus } from "./oauth.js";
import { getModelEntry } from "./modelCatalog.js";

export type RuntimeCapabilityState = "unavailable" | "maybe" | "confirmed";

function hasActiveCredential(value: string): boolean {
  return value.trim().length > 0;
}

function hasActiveClaudeOAuthRuntime(
  provider: ProviderConfig,
  oauthStatus?: ProviderOAuthStatus | null
): boolean {
  if (provider.id !== "claude" || provider.authMode !== "oauth") {
    return false;
  }

  if (oauthStatus?.canUseApi === true || oauthStatus?.canUseCli === true) {
    return true;
  }

  return hasActiveCredential(provider.oauthToken);
}

export function getOpenAiFastModeCapabilityState(
  provider: ProviderConfig,
  modelId: string
): RuntimeCapabilityState {
  if (provider.id !== "openai") {
    return "unavailable";
  }

  if (getModelEntry("openai", modelId)?.supportsFastMode === false) {
    return "unavailable";
  }

  if (provider.authMode === "api_key") {
    return hasActiveCredential(provider.apiKey) ? "confirmed" : "unavailable";
  }

  return provider.authMode === "oauth" ? "confirmed" : "unavailable";
}

export function getClaudeFastModeCapabilityState(
  provider: ProviderConfig,
  modelId: string,
  oauthStatus?: ProviderOAuthStatus | null
): RuntimeCapabilityState {
  if (provider.id !== "claude" || modelId !== "claude-opus-4-6") {
    return "unavailable";
  }

  if (provider.authMode === "api_key") {
    return hasActiveCredential(provider.apiKey) ? "maybe" : "unavailable";
  }

  return hasActiveClaudeOAuthRuntime(provider, oauthStatus) ? "maybe" : "unavailable";
}

export function canOpenAiUseFastMode(provider: ProviderConfig, modelId: string): boolean {
  return getOpenAiFastModeCapabilityState(provider, modelId) !== "unavailable";
}

export function canClaudeUseFastMode(
  provider: ProviderConfig,
  modelId: string,
  oauthStatus?: ProviderOAuthStatus | null
): boolean {
  return getClaudeFastModeCapabilityState(provider, modelId, oauthStatus) !== "unavailable";
}

export function canProviderUseFastMode(
  provider: ProviderConfig,
  modelId: string,
  oauthStatus?: ProviderOAuthStatus | null
): boolean {
  return provider.id === "openai"
    ? canOpenAiUseFastMode(provider, modelId)
    : canClaudeUseFastMode(provider, modelId, oauthStatus);
}

export function isOpenAiFastModeEnabledForInput(
  provider: ProviderConfig,
  modelId: string,
  requestedFastMode: boolean | undefined
): boolean {
  return requestedFastMode === true && canOpenAiUseFastMode(provider, modelId);
}

export function isClaudeFastModeEnabledForInput(
  provider: ProviderConfig,
  modelId: string,
  oauthStatus: ProviderOAuthStatus | null | undefined,
  requestedFastMode: boolean | undefined
): boolean {
  return requestedFastMode === true && canClaudeUseFastMode(provider, modelId, oauthStatus);
}

export function isProviderFastModeEnabledForInput(
  provider: ProviderConfig,
  modelId: string,
  oauthStatus: ProviderOAuthStatus | null | undefined,
  requestedFastMode: boolean | undefined
): boolean {
  return requestedFastMode === true && canProviderUseFastMode(provider, modelId, oauthStatus);
}

export function getOpenAiFastModeAvailabilityNote(
  provider: ProviderConfig,
  modelId: string,
  requestedFastMode: boolean | undefined
): string {
  if (provider.id !== "openai") {
    return "Fast mode is not applicable for the selected provider.";
  }

  if (getModelEntry("openai", modelId)?.supportsFastMode === false) {
    return "The selected OpenAI model does not support fast mode.";
  }

  if (canOpenAiUseFastMode(provider, modelId)) {
    return requestedFastMode === true
      ? 'OpenAI fast mode is enabled. API runs use priority processing and Codex CLI runs request `service_tier="fast"`.'
      : 'OpenAI fast mode is available. API runs use priority processing and Codex CLI runs can request `service_tier="fast"`.';
  }

  if (requestedFastMode === true) {
    return "OpenAI fast mode was requested but disabled because no active credential is configured.";
  }

  if (provider.authMode === "api_key") {
    return "OpenAI fast mode is unavailable: save a valid OpenAI API key in Provider Auth or switch to OpenAI / Codex OAuth.";
  }

  return "OpenAI fast mode is unavailable: configure OpenAI / Codex credentials in Provider Auth.";
}

export function getClaudeFastModeAvailabilityNote(
  provider: ProviderConfig,
  modelId: string,
  oauthStatus: ProviderOAuthStatus | null | undefined,
  requestedFastMode: boolean | undefined
): string {
  if (provider.id !== "claude") {
    return "Fast mode is not applicable for the selected provider.";
  }

  if (modelId !== "claude-opus-4-6") {
    return "Claude fast mode is only available for Opus 4.6.";
  }

  const capabilityState = getClaudeFastModeCapabilityState(provider, modelId, oauthStatus);
  if (capabilityState === "maybe") {
    return requestedFastMode === true
      ? "Claude fast mode is enabled on a best-effort basis for Opus 4.6. Anthropic still gates it by account and runtime path."
      : "Claude fast mode may be available for Opus 4.6, but Anthropic still gates it by account and runtime path.";
  }

  if (requestedFastMode === true) {
    return "Claude fast mode was requested but disabled because this auth path or model cannot use it.";
  }

  if (provider.authMode === "api_key") {
    return "Claude fast mode is unavailable: save a valid Claude API key in Provider Auth.";
  }

  return "Claude fast mode is unavailable: configure an Opus 4.6-capable Claude auth path.";
}

export function getProviderFastModeAvailabilityNote(
  provider: ProviderConfig,
  modelId: string,
  oauthStatus: ProviderOAuthStatus | null | undefined,
  requestedFastMode: boolean | undefined
): string {
  return provider.id === "openai"
    ? getOpenAiFastModeAvailabilityNote(provider, modelId, requestedFastMode)
    : getClaudeFastModeAvailabilityNote(provider, modelId, oauthStatus, requestedFastMode);
}
