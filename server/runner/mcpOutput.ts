import type { McpToolCall, McpToolResult } from "../mcp.js";

export function parseMcpCallsFromOutput(output: string): McpToolCall[] {
  const trimmed = output.trim();
  if (trimmed.length === 0) {
    return [];
  }

  try {
    const parsed = JSON.parse(trimmed) as unknown;
    if (typeof parsed !== "object" || parsed === null) {
      return [];
    }

    const payload = parsed as {
      mcp_calls?: unknown;
      mcpCalls?: unknown;
      tool_calls?: unknown;
    };
    const calls = Array.isArray(payload.mcp_calls)
      ? payload.mcp_calls
      : Array.isArray(payload.mcpCalls)
        ? payload.mcpCalls
        : Array.isArray(payload.tool_calls)
          ? payload.tool_calls
          : null;

    if (!calls) {
      return [];
    }

    const normalized: McpToolCall[] = [];
    for (const call of calls) {
      if (typeof call !== "object" || call === null) {
        continue;
      }

      const record = call as {
        server_id?: unknown;
        serverId?: unknown;
        server?: unknown;
        tool?: unknown;
        name?: unknown;
        arguments?: unknown;
        args?: unknown;
      };

      const serverIdRaw = record.server_id ?? record.serverId ?? record.server;
      const toolRaw = record.tool ?? record.name;
      const argsRaw = record.arguments ?? record.args;

      if (typeof serverIdRaw !== "string" || typeof toolRaw !== "string") {
        continue;
      }

      const serverId = serverIdRaw.trim();
      const tool = toolRaw.trim();
      if (serverId.length === 0 || tool.length === 0) {
        continue;
      }

      normalized.push({
        serverId,
        tool,
        arguments:
          typeof argsRaw === "object" && argsRaw !== null && !Array.isArray(argsRaw)
            ? (argsRaw as Record<string, unknown>)
            : {}
      });
    }

    return normalized;
  } catch {
    return [];
  }
}

export function formatMcpToolResults(results: McpToolResult[]): string {
  return JSON.stringify(
    {
      mcp_results: results.map((result) => ({
        server_id: result.serverId,
        tool: result.tool,
        ok: result.ok,
        output: result.output,
        error: result.error
      }))
    },
    null,
    2
  );
}
