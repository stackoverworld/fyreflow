import { spawn } from "node:child_process";
import type { CommandResult, ProviderOAuthStatus, ProviderRuntimeProbe } from "./contracts.js";
import {
  CLAUDE_CLI_COMMAND,
  CLAUDE_CLI_DISABLE_SLASH_COMMANDS,
  CLAUDE_CLI_PERMISSION_MODE,
  CLAUDE_CLI_SETTING_SOURCES,
  CLAUDE_CLI_SKIP_PERMISSIONS,
  CLAUDE_CLI_STRICT_MCP,
  CLAUDE_PROBE_TIMEOUT_MS
} from "./config.js";
import { nowIso } from "./time.js";

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

export function probeOpenAiRuntime(base: ProviderOAuthStatus): ProviderRuntimeProbe {
  if (base.canUseApi || base.canUseCli) {
    return buildRuntimeProbe("pass", "OpenAI runtime credentials look ready.");
  }

  return buildRuntimeProbe("fail", "OpenAI runtime is not ready: no API token and CLI session is not logged in.");
}

export async function probeClaudeRuntime(base: ProviderOAuthStatus): Promise<ProviderRuntimeProbe> {
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
