import type { McpServerConfig } from "./types.js";
import { isToolAllowed } from "./mcp/allowlist.js";
import { callHttpLikeMcp } from "./mcp/transports/http.js";
import { callStdioMcp } from "./mcp/transports/stdio.js";

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

export async function executeMcpToolCall(
  server: McpServerConfig | undefined,
  call: McpToolCall,
  timeoutMs: number,
  signal?: AbortSignal
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
        ? await callStdioMcp(server, call, timeoutMs, signal)
        : await callHttpLikeMcp(server, call, timeoutMs, signal);

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
