import { getModelEntry } from "@/lib/modelCatalog";
import type { ProviderConfig, ProviderOAuthStatus } from "@/lib/types";

export type RuntimeCapabilityState = "unavailable" | "maybe" | "confirmed";

function isNonEmpty(value: string): boolean {
  return value.trim().length > 0;
}

function hasActiveClaudeOAuthSession(
  provider: ProviderConfig | null | undefined,
  oauthStatus: ProviderOAuthStatus | null | undefined
): boolean {
  if (!provider || provider.id !== "claude" || provider.authMode !== "oauth") {
    return false;
  }

  if (oauthStatus?.canUseApi === true || oauthStatus?.canUseCli === true) {
    return true;
  }

  return isNonEmpty(provider.oauthToken);
}

function hasOpenAiCredential(provider: ProviderConfig | null | undefined): boolean {
  if (!provider || provider.id !== "openai") {
    return false;
  }

  if (provider.authMode === "api_key") {
    return isNonEmpty(provider.apiKey);
  }

  return provider.authMode === "oauth";
}

export function getOpenAiFastModeCapabilityState(
  provider: ProviderConfig | null | undefined,
  modelId = "gpt-5.4"
): RuntimeCapabilityState {
  if (!provider || provider.id !== "openai") {
    return "unavailable";
  }

  if (getModelEntry("openai", modelId)?.supportsFastMode === false) {
    return "unavailable";
  }

  return hasOpenAiCredential(provider) ? "confirmed" : "unavailable";
}

export function getClaudeFastModeCapabilityState(
  provider: ProviderConfig | null | undefined,
  modelId: string,
  oauthStatus?: ProviderOAuthStatus | null
): RuntimeCapabilityState {
  if (!provider || provider.id !== "claude" || modelId !== "claude-opus-4-6") {
    return "unavailable";
  }

  if (provider.authMode === "api_key") {
    return isNonEmpty(provider.apiKey) ? "maybe" : "unavailable";
  }

  return hasActiveClaudeOAuthSession(provider, oauthStatus) ? "maybe" : "unavailable";
}

export function getClaude1MContextCapabilityState(
  provider: ProviderConfig | null | undefined,
  modelId: string,
  oauthStatus?: ProviderOAuthStatus | null
): RuntimeCapabilityState {
  if (!provider || provider.id !== "claude") {
    return "unavailable";
  }

  if (modelId !== "claude-opus-4-6" && modelId !== "claude-sonnet-4-6") {
    return "unavailable";
  }

  if (provider.authMode === "oauth") {
    return hasActiveClaudeOAuthSession(provider, oauthStatus) ? "unavailable" : "unavailable";
  }

  return isNonEmpty(provider.apiKey) ? "maybe" : "unavailable";
}

export function canUseOpenAiFastMode(
  provider: ProviderConfig | null | undefined,
  modelId = "gpt-5.4"
): boolean {
  return getOpenAiFastModeCapabilityState(provider, modelId) !== "unavailable";
}

export function canUseClaudeFastMode(
  provider: ProviderConfig | null | undefined,
  modelId = "claude-opus-4-6",
  oauthStatus?: ProviderOAuthStatus | null
): boolean {
  return getClaudeFastModeCapabilityState(provider, modelId, oauthStatus) !== "unavailable";
}

export function canUseProviderFastMode(
  provider: ProviderConfig | null | undefined,
  modelId?: string,
  oauthStatus?: ProviderOAuthStatus | null
): boolean {
  if (!provider) {
    return false;
  }

  return provider.id === "openai"
    ? canUseOpenAiFastMode(provider, modelId)
    : canUseClaudeFastMode(provider, modelId, oauthStatus);
}

export function getOpenAiFastModeUnavailableNote(
  provider: ProviderConfig | null | undefined,
  modelId = "gpt-5.4"
): string {
  if (!provider) {
    return "Fast mode is unavailable while provider settings are loading.";
  }

  if (getModelEntry("openai", modelId)?.supportsFastMode === false) {
    return "The selected OpenAI model does not support fast mode.";
  }

  if (provider.authMode === "api_key" && !isNonEmpty(provider.apiKey)) {
    return "Fast mode requires an active OpenAI API key or OpenAI / Codex OAuth in Provider Auth.";
  }

  return "";
}

export function getClaudeFastModeUnavailableNote(
  provider: ProviderConfig | null | undefined,
  modelId = "claude-opus-4-6",
  oauthStatus?: ProviderOAuthStatus | null
): string {
  if (!provider) {
    return "Fast mode is unavailable while provider settings are loading.";
  }

  if (modelId !== "claude-opus-4-6") {
    return "Claude fast mode is only available for Opus 4.6.";
  }

  const state = getClaudeFastModeCapabilityState(provider, modelId, oauthStatus);
  if (state === "maybe") {
    return "Claude fast mode may be available for Opus 4.6, but Anthropic still gates it by account and runtime path.";
  }

  if (provider.authMode === "api_key" && !isNonEmpty(provider.apiKey)) {
    return "Fast mode requires an active Claude API key in Provider Auth.";
  }

  return "Fast mode requires a Claude Opus 4.6-capable auth path.";
}

export function getClaude1MContextUnavailableNote(
  provider: ProviderConfig | null | undefined,
  modelId = "claude-opus-4-6",
  oauthStatus?: ProviderOAuthStatus | null
): string {
  if (!provider) {
    return "1M context availability is loading.";
  }

  if (modelId !== "claude-opus-4-6" && modelId !== "claude-sonnet-4-6") {
    return "Claude 1M context is only available for Opus 4.6 and Sonnet 4.6.";
  }

  if (provider.authMode === "oauth") {
    return hasActiveClaudeOAuthSession(provider, oauthStatus)
      ? "Claude 1M context is skipped on OAuth-authenticated API runs because Anthropic rejects that beta on this path."
      : "Claude 1M context requires an API-key-authenticated Anthropic path.";
  }

  if (!isNonEmpty(provider.apiKey)) {
    return "Claude 1M context requires an active Anthropic API key and may also require Extra Usage.";
  }

  return "Claude 1M context is beta-gated and may require Extra Usage.";
}

export function getProviderFastModeUnavailableNote(
  provider: ProviderConfig | null | undefined,
  modelId?: string,
  oauthStatus?: ProviderOAuthStatus | null
): string {
  if (!provider) {
    return "Fast mode is unavailable while provider settings are loading.";
  }

  return provider.id === "openai"
    ? getOpenAiFastModeUnavailableNote(provider, modelId)
    : getClaudeFastModeUnavailableNote(provider, modelId, oauthStatus);
}
