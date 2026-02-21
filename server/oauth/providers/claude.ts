import { execFileAsync, isCommandAvailable, launchDetached } from "../commandUtils.js";
import { CLAUDE_CLI_COMMAND } from "../config.js";
import type {
  ClaudeStatusJson,
  ProviderOAuthLoginResult,
  ProviderOAuthStatus,
  ProviderOAuthStatusOptions,
  ProviderOAuthSyncResult
} from "../contracts.js";
import { probeClaudeRuntime } from "../runtimeProbe.js";
import { nowIso } from "../time.js";

async function getClaudeLoggedInStatus(): Promise<ClaudeStatusJson> {
  try {
    const { stdout } = await execFileAsync(CLAUDE_CLI_COMMAND, ["auth", "status", "--json"], { timeout: 12000 });
    return JSON.parse(stdout) as ClaudeStatusJson;
  } catch {
    return {
      loggedIn: false,
      authMethod: "unknown",
      apiProvider: "unknown"
    };
  }
}

export async function startClaudeOAuthLogin(providerId: "claude"): Promise<ProviderOAuthLoginResult> {
  const available = await isCommandAvailable(CLAUDE_CLI_COMMAND);
  if (!available) {
    throw new Error(`Claude CLI command "${CLAUDE_CLI_COMMAND}" is not installed. Install Claude Code first, then retry.`);
  }

  launchDetached(CLAUDE_CLI_COMMAND, ["auth", "login"]);
  return {
    providerId,
    command: `${CLAUDE_CLI_COMMAND} auth login`,
    message:
      "Claude browser login started. Complete login in the opened page. If the browser did not open, run `claude auth login` in your terminal."
  };
}

export async function getClaudeOAuthStatus(
  providerId: "claude",
  options: ProviderOAuthStatusOptions = {}
): Promise<ProviderOAuthStatus> {
  const cliAvailable = await isCommandAvailable(CLAUDE_CLI_COMMAND);
  const claudeStatus = cliAvailable ? await getClaudeLoggedInStatus() : { loggedIn: false };
  const loggedIn = claudeStatus.loggedIn === true;

  const status: ProviderOAuthStatus = {
    providerId,
    loginSource: "claude-cli",
    cliCommand: CLAUDE_CLI_COMMAND,
    cliAvailable,
    loggedIn,
    tokenAvailable: false,
    canUseApi: false,
    canUseCli: loggedIn,
    checkedAt: nowIso(),
    message: !cliAvailable
      ? "Claude CLI not found."
      : loggedIn
        ? "Logged in with Claude Code. OAuth credentials are managed by Claude CLI."
        : "Not logged in. Start browser login."
  };

  if (options.includeRuntimeProbe) {
    status.runtimeProbe = await probeClaudeRuntime(status);
  }

  return status;
}

export async function syncClaudeOAuthToken(providerId: "claude"): Promise<ProviderOAuthSyncResult> {
  const status = await getClaudeOAuthStatus(providerId);
  return {
    providerId,
    message:
      "Claude Code stores OAuth credentials internally. Token export is not available; use CLI login and OAuth mode.",
    status
  };
}
