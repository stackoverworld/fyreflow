import type { McpToolCall, McpToolResult } from "../mcp.js";

export function extractFirstJsonObject(text: string): string | null {
  const start = text.indexOf("{");
  if (start === -1) {
    return null;
  }

  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let index = start; index < text.length; index += 1) {
    const char = text[index];

    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (char === "\"") {
        inString = false;
      }
      continue;
    }

    if (char === "\"") {
      inString = true;
      continue;
    }

    if (char === "{") {
      depth += 1;
      continue;
    }

    if (char === "}") {
      depth -= 1;
      if (depth === 0) {
        return text.slice(start, index + 1);
      }
    }
  }

  return null;
}

export function parseMcpCallsFromOutput(output: string): McpToolCall[] {
  const candidates = new Set<string>();
  const trimmed = output.trim();
  if (trimmed.length > 0) {
    candidates.add(trimmed);
  }

  const fenced = [...output.matchAll(/```(?:json)?\s*([\s\S]*?)```/gi)];
  for (const block of fenced) {
    const content = block[1]?.trim();
    if (content) {
      candidates.add(content);
    }
  }

  const object = extractFirstJsonObject(output);
  if (object) {
    candidates.add(object);
  }

  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate) as unknown;
      if (typeof parsed !== "object" || parsed === null) {
        continue;
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
        continue;
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

        normalized.push({
          serverId: serverIdRaw.trim(),
          tool: toolRaw.trim(),
          arguments:
            typeof argsRaw === "object" && argsRaw !== null && !Array.isArray(argsRaw)
              ? (argsRaw as Record<string, unknown>)
              : {}
        });
      }

      if (normalized.length > 0) {
        return normalized;
      }
    } catch {
      //
    }
  }

  return [];
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
