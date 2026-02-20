import { spawn } from "node:child_process";
import type { McpServerConfig } from "./types.js";

export interface McpToolCall {
  serverId: string;
  tool: string;
  arguments: Record<string, unknown>;
}

export interface McpToolResult {
  serverId: string;
  tool: string;
  ok: boolean;
  output?: unknown;
  error?: string;
}

interface CommandResult {
  stdout: string;
  stderr: string;
}

function parseCsv(value: string): string[] {
  return value
    .split(/[,\n]/g)
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

function parseCommandArgs(value: string): string[] {
  const matches = value.match(/"([^"]*)"|'([^']*)'|[^\s]+/g);
  if (!matches) {
    return [];
  }

  return matches.map((match) => {
    if ((match.startsWith("\"") && match.endsWith("\"")) || (match.startsWith("'") && match.endsWith("'"))) {
      return match.slice(1, -1);
    }

    return match;
  });
}

function parseEnvBindings(value: string): Record<string, string> {
  const env: Record<string, string> = {};
  for (const entry of value.split(/\n/g)) {
    const line = entry.trim();
    if (line.length === 0 || line.startsWith("#")) {
      continue;
    }

    const delimiterIndex = line.indexOf("=");
    if (delimiterIndex <= 0) {
      continue;
    }

    const key = line.slice(0, delimiterIndex).trim();
    const val = line.slice(delimiterIndex + 1).trim();
    if (key.length > 0) {
      env[key] = val;
    }
  }

  return env;
}

function parseHeaders(value: string): Record<string, string> {
  const headers: Record<string, string> = {};
  for (const entry of value.split(/\n/g)) {
    const line = entry.trim();
    if (line.length === 0 || line.startsWith("#")) {
      continue;
    }

    const delimiterIndex = line.indexOf(":");
    if (delimiterIndex <= 0) {
      continue;
    }

    const key = line.slice(0, delimiterIndex).trim();
    const val = line.slice(delimiterIndex + 1).trim();
    if (key.length > 0) {
      headers[key] = val;
    }
  }

  return headers;
}

function runCommand(
  command: string,
  args: string[],
  stdinInput: string | undefined,
  timeoutMs: number,
  extraEnv?: Record<string, string>
): Promise<CommandResult> {
  return new Promise<CommandResult>((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: ["pipe", "pipe", "pipe"],
      env: {
        ...process.env,
        ...(extraEnv ?? {})
      }
    });

    let stdout = "";
    let stderr = "";

    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      reject(new Error(`${command} timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    child.stdout.on("data", (chunk: Buffer | string) => {
      stdout += chunk.toString();
    });

    child.stderr.on("data", (chunk: Buffer | string) => {
      stderr += chunk.toString();
    });

    child.once("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });

    child.once("close", (code) => {
      clearTimeout(timer);

      if (code === 0) {
        resolve({ stdout, stderr });
        return;
      }

      reject(new Error(`${command} exited with code ${code}: ${(stderr || stdout).slice(0, 500)}`));
    });

    if (stdinInput && stdinInput.length > 0) {
      child.stdin.write(stdinInput);
    }
    child.stdin.end();
  });
}

function isToolAllowed(server: McpServerConfig, tool: string): boolean {
  const allowlist = parseCsv(server.toolAllowlist);
  if (allowlist.length === 0) {
    return true;
  }

  return allowlist.includes("*") || allowlist.includes(tool);
}

async function callHttpLikeMcp(server: McpServerConfig, call: McpToolCall, timeoutMs: number): Promise<unknown> {
  const endpoint = server.url.trim();
  if (endpoint.length === 0) {
    throw new Error("MCP server URL is empty");
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const headers = {
      "content-type": "application/json",
      ...parseHeaders(server.headers)
    };

    const response = await fetch(endpoint, {
      method: "POST",
      headers,
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
        method: "tools/call",
        params: {
          name: call.tool,
          arguments: call.arguments ?? {}
        }
      }),
      signal: controller.signal
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`MCP request failed (${response.status}): ${body.slice(0, 500)}`);
    }

    const contentType = response.headers.get("content-type") ?? "";
    if (contentType.includes("application/json")) {
      const payload = (await response.json()) as unknown;
      if (
        typeof payload === "object" &&
        payload !== null &&
        "error" in payload &&
        (payload as { error?: unknown }).error
      ) {
        const errorPayload = (payload as { error?: unknown }).error;
        throw new Error(
          typeof errorPayload === "string"
            ? errorPayload
            : JSON.stringify(errorPayload)
        );
      }

      if (typeof payload === "object" && payload !== null && "result" in payload) {
        return (payload as { result?: unknown }).result;
      }

      return payload;
    }

    return await response.text();
  } finally {
    clearTimeout(timer);
  }
}

async function callStdioMcp(server: McpServerConfig, call: McpToolCall, timeoutMs: number): Promise<unknown> {
  const command = server.command.trim();
  if (command.length === 0) {
    throw new Error("MCP stdio command is empty");
  }

  const args = parseCommandArgs(server.args);
  const env = parseEnvBindings(server.env);
  const payload = JSON.stringify({
    tool: call.tool,
    arguments: call.arguments ?? {}
  });

  const { stdout } = await runCommand(command, args, payload, timeoutMs, env);
  const trimmed = stdout.trim();
  if (trimmed.length === 0) {
    return "MCP stdio command returned no output";
  }

  try {
    return JSON.parse(trimmed) as unknown;
  } catch {
    return trimmed;
  }
}

export async function executeMcpToolCall(
  server: McpServerConfig | undefined,
  call: McpToolCall,
  timeoutMs: number
): Promise<McpToolResult> {
  if (!server) {
    return {
      serverId: call.serverId,
      tool: call.tool,
      ok: false,
      error: `MCP server "${call.serverId}" is not configured`
    };
  }

  if (!server.enabled) {
    return {
      serverId: call.serverId,
      tool: call.tool,
      ok: false,
      error: `MCP server "${server.name}" is disabled`
    };
  }

  if (!isToolAllowed(server, call.tool)) {
    return {
      serverId: call.serverId,
      tool: call.tool,
      ok: false,
      error: `Tool "${call.tool}" is blocked by allowlist for server "${server.name}"`
    };
  }

  try {
    const output =
      server.transport === "stdio"
        ? await callStdioMcp(server, call, timeoutMs)
        : await callHttpLikeMcp(server, call, timeoutMs);

    return {
      serverId: call.serverId,
      tool: call.tool,
      ok: true,
      output
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown MCP execution error";
    return {
      serverId: call.serverId,
      tool: call.tool,
      ok: false,
      error: message
    };
  }
}
