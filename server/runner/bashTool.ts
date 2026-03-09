import { exec } from "node:child_process";
import type { McpToolResult } from "../mcp.js";
import { buildRestrictedSubprocessEnv } from "../runtime/subprocessEnv.js";
import type { StepSandboxMode } from "../sandboxMode.js";

export const BUILTIN_SHELL_SERVER_ID = "__shell__";

const SHELL_COMMAND_TIMEOUT_MS = 60_000;
const MAX_OUTPUT_BYTES = 1024 * 1024;
const MAX_RESULT_CHARS = 200_000;
const SHELL_NETWORK_COMMAND_PATTERNS = [
  /\bcurl\b/i,
  /\bwget\b/i,
  /\bhttpie\b/i,
  /\bfetch\s+/i,
  /\bgit\s+(?:clone|fetch|pull|push)\b/i,
  /\bgh\s+api\b/i,
  /\bglab\b/i,
  /\bnpm\s+publish\b/i,
  /\bpnpm\s+publish\b/i,
  /\bbun\s+publish\b/i,
  /\bssh\b/i,
  /\bscp\b/i,
  /\brsync\b/i,
  /\bhttps?:\/\//i
] as const;

function isShellNetworkAccessEnabled(): boolean {
  const raw = (process.env.FYREFLOW_ALLOW_SHELL_NETWORK ?? "").trim().toLowerCase();
  return raw === "1" || raw === "true" || raw === "yes" || raw === "on";
}

function isNetworkLikeShellCommand(command: string): boolean {
  return SHELL_NETWORK_COMMAND_PATTERNS.some((pattern) => pattern.test(command));
}

export function isBuiltinShellServer(serverId: string): boolean {
  return serverId === BUILTIN_SHELL_SERVER_ID;
}

export function shouldEnableBuiltinShell(sandboxMode: StepSandboxMode | undefined): boolean {
  return sandboxMode === "full";
}

export async function executeBuiltinShellCall(
  tool: string,
  args: Record<string, unknown>,
  timeoutMs: number,
  signal?: AbortSignal
): Promise<McpToolResult> {
  if (tool !== "run_command") {
    return {
      serverId: BUILTIN_SHELL_SERVER_ID,
      tool,
      ok: false,
      error: `Unknown shell tool "${tool}". Available: run_command`
    };
  }

  const command = typeof args.command === "string" ? args.command.trim() : "";
  if (command.length === 0) {
    return {
      serverId: BUILTIN_SHELL_SERVER_ID,
      tool,
      ok: false,
      error: "Command is empty."
    };
  }

  if (isNetworkLikeShellCommand(command) && !isShellNetworkAccessEnabled()) {
    return {
      serverId: BUILTIN_SHELL_SERVER_ID,
      tool,
      ok: false,
      error:
        "Networked or publish-oriented shell commands are disabled by default. Configure an explicit MCP integration or set FYREFLOW_ALLOW_SHELL_NETWORK=1 for controlled environments."
    };
  }

  const effectiveTimeout = Math.min(timeoutMs, SHELL_COMMAND_TIMEOUT_MS);

  return new Promise<McpToolResult>((resolve) => {
    const child = exec(command, {
      timeout: effectiveTimeout,
      maxBuffer: MAX_OUTPUT_BYTES,
      shell: "/bin/sh",
      env: buildRestrictedSubprocessEnv()
    }, (error, stdout, stderr) => {
      if (signal?.aborted) {
        resolve({
          serverId: BUILTIN_SHELL_SERVER_ID,
          tool,
          ok: false,
          error: "Command aborted."
        });
        return;
      }

      const stdoutStr = typeof stdout === "string" ? stdout : "";
      const stderrStr = typeof stderr === "string" ? stderr : "";
      const parts: string[] = [];
      if (stdoutStr.trim().length > 0) {
        parts.push(stdoutStr.trim());
      }
      if (stderrStr.trim().length > 0) {
        parts.push(`[stderr]\n${stderrStr.trim()}`);
      }
      const combined = parts.join("\n\n") || "(no output)";
      const truncated = combined.length > MAX_RESULT_CHARS
        ? `${combined.slice(0, MAX_RESULT_CHARS)}\n[output truncated]`
        : combined;

      if (error) {
        resolve({
          serverId: BUILTIN_SHELL_SERVER_ID,
          tool,
          ok: false,
          output: truncated,
          error: error.killed
            ? `Command timed out after ${effectiveTimeout}ms.`
            : `Exit code ${(error as { code?: number }).code ?? "unknown"}.`
        });
        return;
      }

      resolve({
        serverId: BUILTIN_SHELL_SERVER_ID,
        tool,
        ok: true,
        output: truncated
      });
    });

    if (signal) {
      const onAbort = (): void => {
        child.kill("SIGTERM");
      };
      signal.addEventListener("abort", onAbort, { once: true });
    }
  });
}

export function buildShellGuidance(): string {
  return [
    `Built-in shell execution is available (server_id: "${BUILTIN_SHELL_SERVER_ID}").`,
    "Use the mcp_call tool (or mcp_calls JSON) with:",
    `  server_id: "${BUILTIN_SHELL_SERVER_ID}"`,
    '  tool: "run_command"',
    '  arguments: { "command": "your shell command" }',
    "Use shell for tightly scoped local file inspection, git status/diff, and deterministic local data processing.",
    "Do not use built-in shell for outbound network or publish actions unless the runtime explicitly enables FYREFLOW_ALLOW_SHELL_NETWORK=1.",
    "Prefer typed MCP integrations for remote APIs so credentials and allowlists stay explicit."
  ].join("\n");
}
