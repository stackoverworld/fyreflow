import type { ProviderId } from "./types.js";
import type {
  ProviderOAuthStatus as ProviderOAuthStatusContract,
  ProviderOAuthStatusOptions
} from "./oauth/contracts.js";
import {
  getCachedCodexAccessToken as getCachedCodexAccessTokenImpl,
  getOpenAiOAuthStatus,
  startOpenAiOAuthLogin,
  syncOpenAiOAuthToken
} from "./oauth/providers/openai.js";
import {
  getClaudeOAuthStatus,
  startClaudeOAuthLogin,
  syncClaudeOAuthToken
} from "./oauth/providers/claude.js";

export type ProviderOAuthStatus = ProviderOAuthStatusContract;

export function getCachedCodexAccessToken(): string | undefined {
  return getCachedCodexAccessTokenImpl();
}

export async function startProviderOAuthLogin(providerId: ProviderId): Promise<{
  providerId: ProviderId;
  command: string;
  message: string;
  authUrl?: string;
  authCode?: string;
}> {
  if (providerId === "openai") {
    return startOpenAiOAuthLogin(providerId);
  }

  return startClaudeOAuthLogin(providerId);
}

export async function getProviderOAuthStatus(
  providerId: ProviderId,
  options: ProviderOAuthStatusOptions = {}
): Promise<ProviderOAuthStatus> {
  if (providerId === "openai") {
    return getOpenAiOAuthStatus(providerId, options);
  }

  return getClaudeOAuthStatus(providerId, options);
}

export async function syncProviderOAuthToken(providerId: ProviderId): Promise<{
  providerId: ProviderId;
  oauthToken?: string;
  message: string;
  status: ProviderOAuthStatus;
}> {
  if (providerId === "openai") {
    return syncOpenAiOAuthToken(providerId);
  }

  return syncClaudeOAuthToken(providerId);
}
