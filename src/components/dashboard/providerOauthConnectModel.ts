import type { RuntimeConnectionMode } from "@/lib/connectionSettingsStorage";
import type { ProviderId } from "@/lib/types";

const PROVIDER_OAUTH_LOGIN_URL: Record<ProviderId, string> = {
  openai: "https://chatgpt.com",
  claude: "https://claude.ai/login"
};

const PROVIDER_LABEL: Record<ProviderId, string> = {
  openai: "OpenAI / Codex",
  claude: "Claude"
};

interface BuildProviderOAuthStartMessageArgs {
  connectionMode: RuntimeConnectionMode;
  providerId: ProviderId;
  apiMessage: string;
  command: string;
  authUrl?: string;
  authCode?: string;
}

interface BuildProviderOAuthStartErrorMessageArgs {
  connectionMode: RuntimeConnectionMode;
  providerId: ProviderId;
  errorMessage: string;
}

function normalizeWhitespace(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}

export function shouldOpenProviderOAuthBrowser(connectionMode: RuntimeConnectionMode): boolean {
  return connectionMode === "remote";
}

export function getProviderOAuthLoginUrl(providerId: ProviderId): string {
  return PROVIDER_OAUTH_LOGIN_URL[providerId];
}

export function resolveProviderOAuthLoginUrl(providerId: ProviderId, apiAuthUrl?: string): string {
  const authUrl = normalizeWhitespace(apiAuthUrl ?? "");
  if (authUrl.length > 0) {
    return authUrl;
  }

  return getProviderOAuthLoginUrl(providerId);
}

export function buildProviderOAuthStartMessage(args: BuildProviderOAuthStartMessageArgs): string {
  const apiMessage = normalizeWhitespace(args.apiMessage);
  if (args.connectionMode !== "remote") {
    return apiMessage.length > 0 ? apiMessage : "OAuth login started.";
  }

  const loginUrl = resolveProviderOAuthLoginUrl(args.providerId, args.authUrl);
  const authCode = normalizeWhitespace(args.authCode ?? "");
  const command = normalizeWhitespace(args.command);
  const remoteCommandHint =
    command.length > 0
      ? `Run "${command}" on the remote server terminal if login is still pending.`
      : "Run the provider CLI login command on the remote server terminal if login is still pending.";
  const codeHint = authCode.length > 0 ? `Use one-time code ${authCode} if prompted.` : "";
  const prefix = apiMessage.length > 0 ? `${apiMessage} ` : "";

  const remoteParts = [
    `${prefix}Remote mode is active, so the server cannot open a browser tab on this device.`,
    `Open ${PROVIDER_LABEL[args.providerId]} login in this browser: ${loginUrl}.`,
    codeHint,
    remoteCommandHint
  ].filter((value) => value.length > 0);

  return remoteParts.join(" ");
}

function remoteCliInstallHint(providerId: ProviderId): string {
  if (providerId === "claude") {
    return "Install Claude CLI on the remote server and set CLAUDE_CLI_PATH if needed.";
  }

  return "Install Codex CLI on the remote server and set CODEX_CLI_PATH if needed.";
}

export function buildProviderOAuthStartErrorMessage(args: BuildProviderOAuthStartErrorMessageArgs): string {
  const message = normalizeWhitespace(args.errorMessage);
  if (args.connectionMode !== "remote") {
    return message.length > 0 ? message : "Failed to start OAuth login.";
  }

  const hasCliMissingSignal = /\b(not installed|not found|enoent|cli unavailable|command)\b/i.test(message);
  const modeHint = "Remote mode runs provider OAuth on the remote server.";
  if (hasCliMissingSignal) {
    return `${message} ${modeHint} ${remoteCliInstallHint(args.providerId)}`.trim();
  }

  if (message.length > 0) {
    return `${message} ${modeHint}`.trim();
  }

  return `${modeHint} Failed to start OAuth login.`;
}
