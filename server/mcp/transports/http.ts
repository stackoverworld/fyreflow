import { mergeAbortSignals } from "../../abort.js";
import type { McpServerConfig } from "../../types.js";
import { parseHeaders } from "../parsers.js";

interface McpToolCallLike {
  tool: string;
  arguments: Record<string, unknown>;
}

export async function callHttpLikeMcp(
  server: McpServerConfig,
  call: McpToolCallLike,
  timeoutMs: number,
  signal?: AbortSignal
): Promise<unknown> {
  const endpoint = server.url.trim();
  if (endpoint.length === 0) {
    throw new Error("MCP server URL is empty");
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const requestSignal = mergeAbortSignals([signal, controller.signal]);

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
      signal: requestSignal
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
