import { mergeAbortSignals } from "../../abort.js";
import { assertResolvedPublicAddress } from "../../security/networkTargets.js";
import type { McpServerConfig } from "../../types.js";
import { parseCsv, parseHeaders } from "../parsers.js";

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
  const allowedHosts = parseCsv(server.hostAllowlist).map((entry) => entry.toLowerCase());
  if (allowedHosts.length === 0) {
    throw new Error("MCP HTTP host allowlist is empty.");
  }

  const parsedEndpoint = await assertResolvedPublicAddress(endpoint, "MCP server URL");
  const endpointHost = parsedEndpoint.hostname.trim().toLowerCase();
  if (!allowedHosts.includes(endpointHost)) {
    throw new Error(`MCP server host "${endpointHost}" is not allowed by hostAllowlist.`);
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
