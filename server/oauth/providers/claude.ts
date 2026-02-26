import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { execFileAsync, isCommandAvailable } from "../commandUtils.js";
import { CLAUDE_CLI_COMMAND } from "../config.js";
import type {
  ClaudeStatusJson,
  ProviderOAuthCodeSubmitResult,
  ProviderOAuthLoginResult,
  ProviderOAuthStatus,
  ProviderOAuthStatusOptions,
  ProviderOAuthSyncResult
} from "../contracts.js";
import { extractDeviceCode, extractFirstAuthUrl } from "../loginOutputParser.js";
import { probeClaudeRuntime } from "../runtimeProbe.js";
import { nowIso } from "../time.js";

const CLAUDE_LOGIN_BOOTSTRAP_TIMEOUT_MS = 20_000;
const CLAUDE_LOGIN_BOOTSTRAP_POLL_INTERVAL_MS = 150;
const CLAUDE_LOGIN_BOOTSTRAP_SETTLE_MS = 700;
const CLAUDE_LOGIN_CAPTURE_MAX_CHARS = 32 * 1024;
const CLAUDE_LOGIN_SESSION_RETENTION_MS = 5 * 60 * 1_000;
const CLAUDE_CODE_SUBMIT_STATUS_TIMEOUT_MS = 10_000;
const CLAUDE_CODE_SUBMIT_STATUS_POLL_MS = 1_200;
const GENERIC_CLAUDE_LOGIN_URL_PATTERN = /^https?:\/\/claude\.ai\/login(?:\/|\?|#|$)/i;
const CLAUDE_MANUAL_CODE_PROMPT_PATTERN = /(paste this into claude code|authentication code|paste.+code)/i;
const CLAUDE_CALLBACK_CODE_PATTERN = /(?:[?&#]|^)code=([^&#\s]+)/i;
const CLAUDE_CALLBACK_STATE_PATTERN = /(?:[?&#]|^)state=([^&#\s]+)/i;
const CLAUDE_PRESS_ENTER_PROMPT_PATTERN = /press enter/i;
const CLAUDE_INVALID_CODE_PATTERN = /oauth error:\s*invalid code|invalid code/i;

interface ActiveClaudeLoginSession {
  child: ChildProcessWithoutNullStreams;
  capturedOutput: string;
  startedAt: number;
  finished: boolean;
  exitCode: number | null;
  authState?: string;
}

let activeClaudeLoginSession: ActiveClaudeLoginSession | null = null;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function appendCapturedOutput(session: ActiveClaudeLoginSession, chunk: Buffer | string): void {
  const text = typeof chunk === "string" ? chunk : chunk.toString("utf8");
  session.capturedOutput = `${session.capturedOutput}${text}`;
  if (session.capturedOutput.length > CLAUDE_LOGIN_CAPTURE_MAX_CHARS) {
    session.capturedOutput = session.capturedOutput.slice(-CLAUDE_LOGIN_CAPTURE_MAX_CHARS);
  }
}

function decodeCodeValue(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function combineCallbackCodeAndState(code: string, state: string | undefined): string {
  const trimmedCode = code.trim();
  if (trimmedCode.length === 0) {
    return "";
  }
  if (trimmedCode.includes("#")) {
    return trimmedCode;
  }
  const trimmedState = (state ?? "").trim();
  if (trimmedState.length === 0) {
    return trimmedCode;
  }
  return `${trimmedCode}#${trimmedState}`;
}

function extractStateFromAuthUrl(authUrl: string | undefined): string | undefined {
  const trimmed = (authUrl ?? "").trim();
  if (trimmed.length === 0) {
    return undefined;
  }

  try {
    const parsed = new URL(trimmed);
    const state = parsed.searchParams.get("state");
    if (!state || state.trim().length === 0) {
      return undefined;
    }
    return state.trim();
  } catch {
    const stateMatch = CLAUDE_CALLBACK_STATE_PATTERN.exec(trimmed);
    if (!stateMatch?.[1]) {
      return undefined;
    }
    const state = decodeCodeValue(stateMatch[1]).trim();
    return state.length > 0 ? state : undefined;
  }
}

export function normalizeClaudeAuthorizationCodeInput(rawInput: string, fallbackState?: string): string {
  const trimmed = rawInput.trim();
  if (trimmed.length === 0) {
    return "";
  }

  const directMatch = CLAUDE_CALLBACK_CODE_PATTERN.exec(trimmed);
  if (directMatch?.[1]) {
    const extracted = decodeCodeValue(directMatch[1]).trim();
    const stateMatch = CLAUDE_CALLBACK_STATE_PATTERN.exec(trimmed);
    const extractedState = stateMatch?.[1] ? decodeCodeValue(stateMatch[1]).trim() : "";
    if (extracted.length > 0) {
      return combineCallbackCodeAndState(extracted, extractedState);
    }
  }

  if (/^https?:\/\//i.test(trimmed)) {
    try {
      const parsed = new URL(trimmed);
      const codeParam = parsed.searchParams.get("code");
      if (codeParam && codeParam.trim().length > 0) {
        const stateParam = parsed.searchParams.get("state");
        return combineCallbackCodeAndState(codeParam.trim(), stateParam?.trim());
      }
    } catch {
      // Ignore invalid URL parse; fallback to raw trimmed input.
    }
  }

  return combineCallbackCodeAndState(trimmed, fallbackState);
}

async function writeInputToSession(session: ActiveClaudeLoginSession, value: string): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    session.child.stdin.write(value, (error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });
}

function extractSubmitFailureHint(output: string): string | undefined {
  if (!CLAUDE_INVALID_CODE_PATTERN.test(output)) {
    return undefined;
  }

  return "Claude rejected this authentication code. Copy the full Authentication Code from browser and submit again.";
}

function hasPreferredClaudeAuthUrl(capturedOutput: string): boolean {
  const authUrl = extractFirstAuthUrl(capturedOutput);
  return typeof authUrl === "string" && !GENERIC_CLAUDE_LOGIN_URL_PATTERN.test(authUrl);
}

function extractLoginBootstrap(capturedOutput: string): {
  authUrl?: string;
  authCode?: string;
  awaitingManualCode: boolean;
} {
  const authUrl = extractFirstAuthUrl(capturedOutput);
  const authCode = extractDeviceCode(capturedOutput);
  const awaitingManualCode = CLAUDE_MANUAL_CODE_PROMPT_PATTERN.test(capturedOutput);
  return {
    authUrl,
    authCode,
    awaitingManualCode
  };
}

async function waitForLoginBootstrap(session: ActiveClaudeLoginSession): Promise<{
  authUrl?: string;
  authCode?: string;
  awaitingManualCode: boolean;
}> {
  const startedAt = Date.now();
  let lastOutput = session.capturedOutput;
  let lastOutputChangedAt = startedAt;

  while (Date.now() - startedAt < CLAUDE_LOGIN_BOOTSTRAP_TIMEOUT_MS) {
    const nextOutput = session.capturedOutput;
    if (nextOutput !== lastOutput) {
      lastOutput = nextOutput;
      lastOutputChangedAt = Date.now();
    }

    const bootstrap = extractLoginBootstrap(nextOutput);
    if (hasPreferredClaudeAuthUrl(nextOutput)) {
      return bootstrap;
    }

    if (
      nextOutput.length > 0 &&
      Date.now() - lastOutputChangedAt >= CLAUDE_LOGIN_BOOTSTRAP_SETTLE_MS &&
      (bootstrap.awaitingManualCode || typeof bootstrap.authCode === "string")
    ) {
      return bootstrap;
    }

    if (session.finished && nextOutput.length > 0) {
      return bootstrap;
    }

    await sleep(CLAUDE_LOGIN_BOOTSTRAP_POLL_INTERVAL_MS);
  }

  return extractLoginBootstrap(session.capturedOutput);
}

async function launchClaudeLoginSession(): Promise<ActiveClaudeLoginSession> {
  const previous = activeClaudeLoginSession;
  if (previous && !previous.finished) {
    try {
      previous.child.kill();
    } catch {
      // Ignore kill errors.
    }
  }

  activeClaudeLoginSession = null;

  return new Promise<ActiveClaudeLoginSession>((resolve, reject) => {
    const child = spawn(CLAUDE_CLI_COMMAND, ["auth", "login"], {
      stdio: ["pipe", "pipe", "pipe"]
    });

    const session: ActiveClaudeLoginSession = {
      child,
      capturedOutput: "",
      startedAt: Date.now(),
      finished: false,
      exitCode: null,
      authState: undefined
    };

    child.stdout.on("data", (chunk: Buffer | string) => {
      appendCapturedOutput(session, chunk);
    });

    child.stderr.on("data", (chunk: Buffer | string) => {
      appendCapturedOutput(session, chunk);
    });

    child.once("exit", (code) => {
      session.finished = true;
      session.exitCode = code;
      const cleanupTimer = setTimeout(() => {
        if (activeClaudeLoginSession === session) {
          activeClaudeLoginSession = null;
        }
      }, CLAUDE_LOGIN_SESSION_RETENTION_MS);
      cleanupTimer.unref();
    });

    child.once("error", (error) => {
      session.finished = true;
      session.exitCode = 1;
      if (activeClaudeLoginSession === session) {
        activeClaudeLoginSession = null;
      }
      reject(error);
    });

    child.once("spawn", () => {
      activeClaudeLoginSession = session;
      resolve(session);
    });
  });
}

async function waitForClaudeLoggedIn(timeoutMs: number): Promise<boolean> {
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    const elapsed = Date.now() - startedAt;
    const remaining = timeoutMs - elapsed;
    if (remaining <= 0) {
      break;
    }

    const statusTimeoutMs = Math.max(900, Math.min(2500, remaining));
    const status = await getClaudeLoggedInStatus(statusTimeoutMs);
    if (status.loggedIn === true) {
      return true;
    }

    await sleep(CLAUDE_CODE_SUBMIT_STATUS_POLL_MS);
  }

  const finalStatus = await getClaudeLoggedInStatus(1500);
  return finalStatus.loggedIn === true;
}

async function getClaudeLoggedInStatus(timeoutMs = 4000): Promise<ClaudeStatusJson> {
  try {
    const { stdout } = await execFileAsync(CLAUDE_CLI_COMMAND, ["auth", "status", "--json"], { timeout: timeoutMs });
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

  const session = await launchClaudeLoginSession();
  const bootstrap = await waitForLoginBootstrap(session);
  const authUrl = bootstrap.authUrl;
  session.authState = extractStateFromAuthUrl(authUrl);
  const authCode = bootstrap.authCode;

  const messageParts = [
    "Claude browser login started.",
    authUrl ? `Open ${authUrl}.` : "",
    bootstrap.awaitingManualCode
      ? "If browser shows Authentication Code, copy it and submit it in this dashboard."
      : "",
    "If the browser did not open, run `claude auth login` on the remote server terminal."
  ].filter((value) => value.length > 0);

  return {
    providerId,
    command: `${CLAUDE_CLI_COMMAND} auth login`,
    message: messageParts.join(" "),
    authUrl,
    authCode
  };
}

export async function submitClaudeOAuthCode(
  providerId: "claude",
  code: string
): Promise<ProviderOAuthCodeSubmitResult> {
  const available = await isCommandAvailable(CLAUDE_CLI_COMMAND);
  if (!available) {
    throw new Error(`Claude CLI command "${CLAUDE_CLI_COMMAND}" is not installed. Install Claude Code first, then retry.`);
  }

  const normalizedRaw = code.trim();
  if (normalizedRaw.length === 0) {
    throw new Error("Authorization code is required.");
  }

  const session = activeClaudeLoginSession;
  if (!session || session.finished) {
    const status = await getClaudeLoggedInStatus();
    if (status.loggedIn === true) {
      return {
        providerId,
        accepted: true,
        message: "Claude CLI is already authenticated."
      };
    }

    throw new Error("No active Claude login session. Click Connect first, then submit the browser code.");
  }

  const normalizedCode = normalizeClaudeAuthorizationCodeInput(normalizedRaw, session.authState);
  if (normalizedCode.length === 0) {
    throw new Error("Authorization code is required.");
  }

  if (CLAUDE_PRESS_ENTER_PROMPT_PATTERN.test(session.capturedOutput)) {
    await writeInputToSession(session, "\n");
    await sleep(200);
  }

  await writeInputToSession(session, `${normalizedCode}\n`);

  const loggedIn = await waitForClaudeLoggedIn(CLAUDE_CODE_SUBMIT_STATUS_TIMEOUT_MS);
  if (loggedIn) {
    return {
      providerId,
      accepted: true,
      message: "Authorization code submitted. Claude CLI login is connected."
    };
  }

  if (session.finished && session.exitCode !== 0) {
    const submitFailureHint = extractSubmitFailureHint(session.capturedOutput);
    return {
      providerId,
      accepted: false,
      message:
        submitFailureHint ??
        "Authorization code was submitted, but Claude login did not complete. Click Connect and try again."
    };
  }

  const submitFailureHint = extractSubmitFailureHint(session.capturedOutput);
  if (submitFailureHint) {
    return {
      providerId,
      accepted: false,
      message: submitFailureHint
    };
  }

  return {
    providerId,
    accepted: false,
    message: "Authorization code was sent, but Claude CLI is still waiting. Click Refresh or reconnect and retry."
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
