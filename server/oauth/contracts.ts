import type { ProviderId } from "../types.js";

export interface ProviderRuntimeProbe {
  status: "pass" | "fail";
  message: string;
  checkedAt: string;
  latencyMs?: number;
}

export interface ProviderOAuthStatus {
  providerId: ProviderId;
  loginSource: string;
  cliCommand?: string;
  cliAvailable: boolean;
  loggedIn: boolean;
  tokenAvailable: boolean;
  canUseApi: boolean;
  canUseCli: boolean;
  message: string;
  checkedAt: string;
  runtimeProbe?: ProviderRuntimeProbe;
}

export interface ClaudeStatusJson {
  loggedIn?: boolean;
  authMethod?: string;
  apiProvider?: string;
}

export interface ProviderOAuthStatusOptions {
  includeRuntimeProbe?: boolean;
}

export interface CommandResult {
  stdout: string;
  stderr: string;
}

export interface ProviderOAuthLoginResult {
  providerId: ProviderId;
  command: string;
  message: string;
}

export interface ProviderOAuthSyncResult {
  providerId: ProviderId;
  oauthToken?: string;
  message: string;
  status: ProviderOAuthStatus;
}
