import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import type { ProviderId } from "./types.js";

const execFileAsync = promisify(execFile);
const CODEX_AUTH_PATH = path.join(os.homedir(), ".codex", "auth.json");
const LOCAL_BIN_DIR = path.join(os.homedir(), ".local", "bin");
const CODEX_LOCAL_BIN_PATH = path.join(LOCAL_BIN_DIR, "codex");
const CLAUDE_LOCAL_BIN_PATH = path.join(LOCAL_BIN_DIR, "claude");
const CODEX_CLI_COMMAND =
  (process.env.CODEX_CLI_PATH ?? "").trim() || (fs.existsSync(CODEX_LOCAL_BIN_PATH) ? CODEX_LOCAL_BIN_PATH : "codex");
const CLAUDE_CLI_COMMAND =
  (process.env.CLAUDE_CLI_PATH ?? "").trim() ||
  (fs.existsSync(CLAUDE_LOCAL_BIN_PATH) ? CLAUDE_LOCAL_BIN_PATH : "claude");
const CLAUDE_CLI_SKIP_PERMISSIONS = (process.env.CLAUDE_CLI_SKIP_PERMISSIONS ?? "1").trim() !== "0";
const CLAUDE_CLI_STRICT_MCP = (process.env.CLAUDE_CLI_STRICT_MCP ?? "1").trim() !== "0";
const CLAUDE_CLI_DISABLE_SLASH_COMMANDS = (process.env.CLAUDE_CLI_DISABLE_SLASH_COMMANDS ?? "1").trim() !== "0";
const CLAUDE_CLI_SETTING_SOURCES = (process.env.CLAUDE_CLI_SETTING_SOURCES ?? "user").trim();
const CLAUDE_CLI_PERMISSION_MODE = (() => {
  const candidate = (process.env.CLAUDE_CLI_PERMISSION_MODE ?? "bypassPermissions").trim();
  const allowed = new Set(["acceptEdits", "bypassPermissions", "default", "dontAsk", "plan"]);
  return allowed.has(candidate) ? candidate : "bypassPermissions";
})();
const CLAUDE_PROBE_TIMEOUT_MS = (() => {
  const raw = Number.parseInt(process.env.CLAUDE_CLI_PROBE_TIMEOUT_MS ?? "45000", 10);
  if (!Number.isFinite(raw)) {
    return 45_000;
  }
  return Math.max(15_000, Math.min(300_000, raw));
})();

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

interface ClaudeStatusJson {
  loggedIn?: boolean;
  authMethod?: string;
  apiProvider?: string;
}

interface ProviderOAuthStatusOptions {
  includeRuntimeProbe?: boolean;
}

interface ProviderRuntimeProbe {
  status: "pass" | "fail";
  message: string;
  checkedAt: string;
  latencyMs?: number;
}

interface CommandResult {
  stdout: string;
  stderr: string;
}

function runCommandCapture(command: string, args: string[], timeoutMs: number): Promise<CommandResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: ["pipe", "pipe", "pipe"]
    });
    let stdout = "";
    let stderr = "";
    let settled = false;
    let timedOut = false;

    const finish = (fn: () => void) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      fn();
    };

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
    }, timeoutMs);

    child.stdout.on("data", (chunk: Buffer | string) => {
      stdout += chunk.toString();
    });

    child.stderr.on("data", (chunk: Buffer | string) => {
      stderr += chunk.toString();
    });

    child.once("error", (error) => {
      finish(() => reject(error));
    });

    child.once("close", (code, signal) => {
      if (timedOut) {
        const timeoutError = Object.assign(new Error(`Command timed out after ${timeoutMs}ms`), {
          killed: true,
          signal: signal ?? "SIGTERM",
          stdout,
          stderr
        });
        finish(() => reject(timeoutError));
        return;
      }

      if (code === 0) {
        finish(() => resolve({ stdout, stderr }));
        return;
      }

      const nonZeroError = Object.assign(
        new Error(`${command} exited with code ${code}: ${(stderr || stdout).slice(0, 520)}`),
        {
          code: code ?? undefined,
          signal: signal ?? undefined,
          stdout,
          stderr
        }
      );
      finish(() => reject(nonZeroError));
    });

    child.stdin.end();
  });
}

function nowIso(): string {
  return new Date().toISOString();
}

function normalizeProbeMessage(value: string | undefined): string {
  if (!value) {
    return "Unknown runtime probe error.";
  }
  return value.replace(/\s+/g, " ").trim().slice(0, 280);
}

function buildRuntimeProbe(status: "pass" | "fail", message: string, latencyMs?: number): ProviderRuntimeProbe {
  return {
    status,
    message,
    checkedAt: nowIso(),
    ...(typeof latencyMs === "number" ? { latencyMs } : {})
  };
}

function applyClaudeNonInteractiveFlags(args: string[]): void {
  args.push("--no-session-persistence");
  if (CLAUDE_CLI_SETTING_SOURCES.length > 0) {
    args.push("--setting-sources", CLAUDE_CLI_SETTING_SOURCES);
  }
  if (CLAUDE_CLI_STRICT_MCP) {
    args.push("--strict-mcp-config");
  }
  if (CLAUDE_CLI_DISABLE_SLASH_COMMANDS) {
    args.push("--disable-slash-commands");
  }
  if (CLAUDE_CLI_SKIP_PERMISSIONS) {
    args.push("--dangerously-skip-permissions");
    return;
  }
  args.push("--permission-mode", CLAUDE_CLI_PERMISSION_MODE);
}

function applyClaudeCompatibilityFlags(args: string[]): void {
  args.push("--no-session-persistence");
  if (CLAUDE_CLI_SKIP_PERMISSIONS) {
    args.push("--dangerously-skip-permissions");
    return;
  }
  args.push("--permission-mode", CLAUDE_CLI_PERMISSION_MODE);
}

function isUnknownClaudeOptionError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }
  return /\bunknown\b.+\b(option|argument)\b|did you mean|unrecognized option/i.test(error.message);
}

function probeOpenAiRuntime(base: ProviderOAuthStatus): ProviderRuntimeProbe {
  if (base.canUseApi || base.canUseCli) {
    return buildRuntimeProbe("pass", "OpenAI runtime credentials look ready.");
  }

  return buildRuntimeProbe("fail", "OpenAI runtime is not ready: no API token and CLI session is not logged in.");
}

async function probeClaudeRuntime(base: ProviderOAuthStatus): Promise<ProviderRuntimeProbe> {
  if (!base.cliAvailable) {
    return buildRuntimeProbe("fail", "Claude CLI is not installed.");
  }
  if (!base.loggedIn) {
    return buildRuntimeProbe("fail", "Claude CLI is not logged in.");
  }

  const startedAt = Date.now();
  try {
    const buildArgs = (compatibilityMode = false): string[] => {
      const args = ["--print", "--output-format", "text"];
      if (compatibilityMode) {
        applyClaudeCompatibilityFlags(args);
      } else {
        applyClaudeNonInteractiveFlags(args);
      }
      args.push("--tools", "");
      args.push("--model", "claude-sonnet-4-6");
      args.push("Reply with exactly: OK");
      return args;
    };

    let stdout = "";
    try {
      ({ stdout } = await runCommandCapture(CLAUDE_CLI_COMMAND, buildArgs(false), CLAUDE_PROBE_TIMEOUT_MS));
    } catch (error) {
      if (!isUnknownClaudeOptionError(error)) {
        throw error;
      }
      ({ stdout } = await runCommandCapture(CLAUDE_CLI_COMMAND, buildArgs(true), CLAUDE_PROBE_TIMEOUT_MS));
    }

    const latencyMs = Date.now() - startedAt;
    const normalizedOutput = stdout.trim().toUpperCase();
    if (normalizedOutput.includes("OK")) {
      return buildRuntimeProbe("pass", "Claude CLI runtime probe succeeded.", latencyMs);
    }

    return buildRuntimeProbe(
      "fail",
      `Claude CLI responded unexpectedly: ${normalizeProbeMessage(stdout) || "empty output"}`,
      latencyMs
    );
  } catch (error) {
    const latencyMs = Date.now() - startedAt;
    const rawError =
      error as Error & {
        code?: string | number;
        signal?: string;
        killed?: boolean;
        stdout?: string | Buffer;
        stderr?: string | Buffer;
      };
    const baseMessage = normalizeProbeMessage(error instanceof Error ? error.message : String(error));
    const isTimeout =
      rawError.killed === true ||
      rawError.signal === "SIGTERM" ||
      /\btimed?\s*out\b|etimedout|timeout/i.test(baseMessage);
    const stderrText =
      typeof rawError.stderr === "string"
        ? normalizeProbeMessage(rawError.stderr)
        : rawError.stderr instanceof Buffer
          ? normalizeProbeMessage(rawError.stderr.toString("utf8"))
          : "";
    const stdoutText =
      typeof rawError.stdout === "string"
        ? normalizeProbeMessage(rawError.stdout)
        : rawError.stdout instanceof Buffer
          ? normalizeProbeMessage(rawError.stdout.toString("utf8"))
          : "";

    let details = baseMessage;
    if (isTimeout) {
      details = `Command timed out after ${CLAUDE_PROBE_TIMEOUT_MS}ms. Claude CLI may be blocked by local MCP/hooks, confirmation prompts, or severe model latency.`;
    }
    if (stderrText.length > 0) {
      details = `${details} stderr: ${stderrText}`;
    } else if (stdoutText.length > 0) {
      details = `${details} stdout: ${stdoutText}`;
    } else {
      details = `${details} Command: ${CLAUDE_CLI_COMMAND} --print --output-format text ...`;
    }

    return buildRuntimeProbe("fail", `Claude CLI runtime probe failed: ${details}`, latencyMs);
  }
}

async function isCommandAvailable(command: string): Promise<boolean> {
  try {
    await execFileAsync(command, ["--version"], { timeout: 6000 });
    return true;
  } catch {
    return false;
  }
}

export function getCachedCodexAccessToken(): string | undefined {
  try {
    if (!fs.existsSync(CODEX_AUTH_PATH)) {
      return undefined;
    }

    const raw = fs.readFileSync(CODEX_AUTH_PATH, "utf8");
    const parsed = JSON.parse(raw) as {
      tokens?: {
        access_token?: unknown;
      };
    };

    const token = parsed.tokens?.access_token;
    if (typeof token !== "string") {
      return undefined;
    }

    const trimmed = token.trim();
    return trimmed.length > 0 ? trimmed : undefined;
  } catch {
    return undefined;
  }
}

async function getCodexLoggedInStatus(): Promise<boolean> {
  try {
    const { stdout, stderr } = await execFileAsync(CODEX_CLI_COMMAND, ["login", "status"], { timeout: 12000 });
    const text = `${stdout}\n${stderr}`.toLowerCase();
    return text.includes("logged in") && !text.includes("not logged in");
  } catch {
    return false;
  }
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

function launchDetached(command: string, args: string[]): void {
  const child = spawn(command, args, {
    detached: true,
    stdio: "ignore"
  });
  child.unref();
}

export async function startProviderOAuthLogin(providerId: ProviderId): Promise<{
  providerId: ProviderId;
  command: string;
  message: string;
}> {
  if (providerId === "openai") {
    const available = await isCommandAvailable(CODEX_CLI_COMMAND);
    if (!available) {
      throw new Error(`Codex CLI command "${CODEX_CLI_COMMAND}" is not installed. Install Codex CLI first, then retry.`);
    }

    launchDetached(CODEX_CLI_COMMAND, ["login", "--device-auth"]);
    return {
      providerId,
      command: `${CODEX_CLI_COMMAND} login --device-auth`,
      message:
        "Codex browser login started. Complete login in the opened page. If the browser did not open, run `codex login --device-auth` in your terminal."
    };
  }

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

export async function getProviderOAuthStatus(
  providerId: ProviderId,
  options: ProviderOAuthStatusOptions = {}
): Promise<ProviderOAuthStatus> {
  if (providerId === "openai") {
    const cliAvailable = await isCommandAvailable(CODEX_CLI_COMMAND);
    const loggedIn = cliAvailable ? await getCodexLoggedInStatus() : false;
    const tokenAvailable = Boolean(getCachedCodexAccessToken());

    const status: ProviderOAuthStatus = {
      providerId,
      loginSource: "codex-cli",
      cliCommand: CODEX_CLI_COMMAND,
      cliAvailable,
      loggedIn,
      tokenAvailable,
      canUseApi: tokenAvailable,
      canUseCli: loggedIn,
      checkedAt: nowIso(),
      message: !cliAvailable
        ? "Codex CLI not found."
        : loggedIn && tokenAvailable
          ? "Logged in via ChatGPT. Cached access token is available for import."
          : loggedIn
            ? "Logged in via ChatGPT. No cached access token found yet."
            : "Not logged in. Start browser login."
    };

    if (options.includeRuntimeProbe) {
      status.runtimeProbe = probeOpenAiRuntime(status);
    }

    return status;
  }

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

export async function syncProviderOAuthToken(providerId: ProviderId): Promise<{
  providerId: ProviderId;
  oauthToken?: string;
  message: string;
  status: ProviderOAuthStatus;
}> {
  if (providerId === "openai") {
    const token = getCachedCodexAccessToken();
    const status = await getProviderOAuthStatus(providerId);

    if (!token) {
      return {
        providerId,
        message: "No Codex cached token found. Complete browser login first.",
        status
      };
    }

    return {
      providerId,
      oauthToken: token,
      message: "Imported token from Codex local auth cache.",
      status
    };
  }

  const status = await getProviderOAuthStatus(providerId);
  return {
    providerId,
    message:
      "Claude Code stores OAuth credentials internally. Token export is not available; use CLI login and OAuth mode.",
    status
  };
}
