import { execFileAsync, isCommandAvailable, launchDetachedAndCapture } from "../commandUtils.js";
import { CLAUDE_CLI_COMMAND } from "../config.js";
import type {
  ClaudeStatusJson,
  ProviderOAuthLoginResult,
  ProviderOAuthStatus,
  ProviderOAuthStatusOptions,
  ProviderOAuthSyncResult
} from "../contracts.js";
import { extractDeviceCode, extractFirstAuthUrl } from "../loginOutputParser.js";
import { probeClaudeRuntime } from "../runtimeProbe.js";
import { nowIso } from "../time.js";

const CLAUDE_CAPTURE_TIMEOUT_MS = 15_000;
const CLAUDE_CAPTURE_SETTLE_MS = 600;
const GENERIC_CLAUDE_LOGIN_URL_PATTERN = /^https?:\/\/claude\.ai\/login(?:\/|\?|#|$)/i;

function hasPreferredClaudeAuthUrl(capturedOutput: string): boolean {
  const url = extractFirstAuthUrl(capturedOutput);
  return typeof url === "string" && !GENERIC_CLAUDE_LOGIN_URL_PATTERN.test(url);
}

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

  const launchResult = await launchDetachedAndCapture(CLAUDE_CLI_COMMAND, ["auth", "login"], {
    captureTimeoutMs: CLAUDE_CAPTURE_TIMEOUT_MS,
    settleTimeMs: CLAUDE_CAPTURE_SETTLE_MS,
    isOutputSufficient: hasPreferredClaudeAuthUrl
  });
  const authUrl = extractFirstAuthUrl(launchResult.capturedOutput);
  const authCode = extractDeviceCode(launchResult.capturedOutput);

  const messageParts = [
    "Claude browser login started.",
    authUrl ? `Open ${authUrl}.` : "",
    authCode ? `Use code ${authCode}.` : "",
    "If the browser did not open, run `claude auth login` in your terminal."
  ].filter((value) => value.length > 0);

  return {
    providerId,
    command: `${CLAUDE_CLI_COMMAND} auth login`,
    message: messageParts.join(" "),
    authUrl,
    authCode
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
      ? "Claude CLI not found on this server. Install Claude Code CLI on backend and set CLAUDE_CLI_PATH if needed."
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
