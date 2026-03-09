import { afterEach, describe, expect, it, vi } from "vitest";

import { isToolAllowed } from "../../server/mcp/allowlist.js";
import { callHttpLikeMcp } from "../../server/mcp/transports/http.js";
import type { McpServerConfig } from "../../server/types.js";

function createServer(overrides: Partial<McpServerConfig> = {}): McpServerConfig {
  return {
    id: "mcp-1",
    name: "Secure MCP",
    enabled: true,
    transport: "http",
    command: "",
    args: "",
    url: "https://93.184.216.34/mcp",
    env: "",
    headers: "",
    toolAllowlist: "search",
    hostAllowlist: "93.184.216.34",
    health: "unknown",
    updatedAt: "2026-03-09T00:00:00.000Z",
    ...overrides
  };
}

describe("MCP security", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("blocks calls when the tool allowlist is empty", () => {
    expect(isToolAllowed(createServer({ toolAllowlist: "" }), "search")).toBe(false);
  });

  it("rejects HTTP MCP targets outside the configured host allowlist", async () => {
    await expect(
      callHttpLikeMcp(
        createServer({ hostAllowlist: "api.github.com" }),
        {
          tool: "search",
          arguments: { query: "hello" }
        },
        5_000
      )
    ).rejects.toThrow(/host .* not allowed/i);
  });

  it("allows HTTP MCP calls only when the host is explicitly allowlisted", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ result: { ok: true } }), {
          status: 200,
          headers: { "content-type": "application/json" }
        })
      )
    );

    const result = await callHttpLikeMcp(
      createServer(),
      {
        tool: "search",
        arguments: { query: "hello" }
      },
      5_000
    );

    expect(result).toEqual({ ok: true });
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});
