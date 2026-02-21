import type { McpServerConfig } from "../../types.js";
import { parseCommandArgs, parseEnvBindings } from "../parsers.js";
import { runCommand } from "../process.js";

interface McpToolCallLike {
  tool: string;
  arguments: Record<string, unknown>;
}

export async function callStdioMcp(
  server: McpServerConfig,
  call: McpToolCallLike,
  timeoutMs: number,
  signal?: AbortSignal
): Promise<unknown> {
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

  const { stdout } = await runCommand(command, args, payload, timeoutMs, env, signal);
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
