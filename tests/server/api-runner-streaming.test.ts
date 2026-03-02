import { afterEach, describe, expect, it, vi } from "vitest";

import { executeClaudeWithApi, executeOpenAIWithApi } from "../../server/providers/clientFactory/apiRunner.js";
import type { ProviderExecutionInput } from "../../server/providers/types.js";

const VALID_SETUP_TOKEN =
  "sk-ant-oat01-rotated-test-fixture-do-not-use-2026-03-02-ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789abcdefghijk";

function createInput(providerId: "openai" | "claude"): ProviderExecutionInput {
  return {
    provider: {
      id: providerId,
      label: providerId === "openai" ? "OpenAI" : "Anthropic",
      authMode: "api_key",
      apiKey: "sk-test",
      oauthToken: "",
      baseUrl: providerId === "openai" ? "https://api.openai.com/v1" : "https://api.anthropic.com/v1",
      defaultModel: providerId === "openai" ? "gpt-5.3-codex" : "claude-sonnet-4-6",
      updatedAt: new Date().toISOString()
    },
    step: {
      id: `step-${providerId}`,
      name: "Reviewer",
      role: "review",
      prompt: "Review output",
      providerId,
      model: providerId === "openai" ? "gpt-5.3-codex" : "claude-sonnet-4-6",
      reasoningEffort: "medium",
      fastMode: false,
      use1MContext: false,
      contextWindowTokens: 128_000,
      position: { x: 0, y: 0 },
      contextTemplate: "",
      enableDelegation: false,
      delegationCount: 1,
      enableIsolatedStorage: false,
      enableSharedStorage: true,
      enabledMcpServerIds: [],
      outputFormat: "markdown",
      requiredOutputFields: [],
      requiredOutputFiles: [],
      scenarios: [],
      skipIfArtifacts: []
    },
    context: "ctx",
    task: "task"
  };
}

function createSseResponse(chunks: string[], requestIdHeader: string): Response {
  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(encoder.encode(chunk));
      }
      controller.close();
    }
  });

  return new Response(body, {
    status: 200,
    headers: {
      "content-type": "text/event-stream",
      [requestIdHeader]: "req_test_123"
    }
  });
}

const originalFetch = global.fetch;

afterEach(() => {
  global.fetch = originalFetch;
  vi.restoreAllMocks();
});

describe("API runner streaming mode", () => {
  it("parses OpenAI SSE deltas and logs request id", async () => {
    const logs: string[] = [];
    global.fetch = vi.fn(async () =>
      createSseResponse(
        [
          'event: response.created\ndata: {"type":"response.created"}\n\n',
          'event: response.output_text.delta\ndata: {"type":"response.output_text.delta","delta":"Hello"}\n\n',
          'event: response.output_text.delta\ndata: {"type":"response.output_text.delta","delta":" world"}\n\n',
          'event: response.completed\ndata: {"type":"response.completed","response":{"output_text":"Hello world"}}\n\n',
          "data: [DONE]\n\n"
        ],
        "x-request-id"
      )
    ) as typeof fetch;

    const output = await executeOpenAIWithApi({ ...createInput("openai"), log: (line) => logs.push(line) }, "sk-test");
    expect(output).toBe("Hello world");
    expect(logs.some((line) => line.includes("OpenAI request id: req_test_123"))).toBe(true);
    expect(logs.some((line) => line.includes("OpenAI stream event: response.output_text.delta"))).toBe(true);
    expect(logs.some((line) => line.includes("Model summary:"))).toBe(true);
  });

  it("parses Claude SSE content deltas and logs ping heartbeat", async () => {
    const logs: string[] = [];
    global.fetch = vi.fn(async () =>
      createSseResponse(
        [
          'event: message_start\ndata: {"type":"message_start"}\n\n',
          'event: ping\ndata: {"type":"ping"}\n\n',
          'event: content_block_delta\ndata: {"type":"content_block_delta","delta":{"type":"text_delta","text":"PASS"}}\n\n',
          'event: message_stop\ndata: {"type":"message_stop"}\n\n'
        ],
        "request-id"
      )
    ) as typeof fetch;

    const output = await executeClaudeWithApi({ ...createInput("claude"), log: (line) => logs.push(line) }, "sk-test");
    expect(output).toBe("PASS");
    expect(logs.some((line) => line.includes("Claude request id: req_test_123"))).toBe(true);
    expect(logs.some((line) => line.includes("Claude stream event: ping"))).toBe(true);
    expect(logs.some((line) => line.includes("Model summary:"))).toBe(true);
  });

  it("uses x-api-key header as primary auth for Claude setup-token OAuth mode", async () => {
    const logs: string[] = [];
    const capturedHeaders: Array<Record<string, string>> = [];

    global.fetch = vi.fn(async (_url, init) => {
      capturedHeaders.push((init?.headers ?? {}) as Record<string, string>);
      return new Response(
        JSON.stringify({
          content: [{ type: "text", text: "Setup-token worked via x-api-key primary mode" }]
        }),
        {
          status: 200,
          headers: {
            "content-type": "application/json"
          }
        }
      );
    }) as typeof fetch;

    const input = createInput("claude");
    input.provider.authMode = "oauth";

    const output = await executeClaudeWithApi({ ...input, log: (line) => logs.push(line) }, VALID_SETUP_TOKEN);
    expect(output).toContain("Setup-token worked via x-api-key primary mode");
    expect(capturedHeaders).toHaveLength(1);
    expect(capturedHeaders[0]?.Authorization).toBeUndefined();
    expect(capturedHeaders[0]?.["x-api-key"]).toBe(VALID_SETUP_TOKEN);
    expect(capturedHeaders[0]?.["anthropic-beta"]).toContain("oauth-2025-04-20");
    expect(capturedHeaders[0]?.["anthropic-beta"]).toContain("claude-code-20250219");
    expect(logs.some((line) => line.includes("setup-token compatibility"))).toBe(false);
  });

  it("retries once with x-api-key when Claude OAuth bearer auth is rejected", async () => {
    const capturedHeaders: Array<Record<string, string>> = [];

    global.fetch = vi.fn(async (_url, init) => {
      capturedHeaders.push((init?.headers ?? {}) as Record<string, string>);
      if (capturedHeaders.length === 1) {
        return new Response(
          JSON.stringify({
            type: "error",
            error: {
              type: "authentication_error",
              message: "invalid x-api-key"
            }
          }),
          {
            status: 401,
            headers: { "content-type": "application/json" }
          }
        );
      }

      return new Response(
        JSON.stringify({
          content: [{ type: "text", text: "ok" }]
        }),
        {
          status: 200,
          headers: { "content-type": "application/json" }
        }
      );
    }) as typeof fetch;

    const input = createInput("claude");
    input.provider.authMode = "oauth";

    const output = await executeClaudeWithApi(input, "oauth-token-not-a-setup-token");
    expect(output).toBe("ok");
    expect(capturedHeaders).toHaveLength(2);
    expect(capturedHeaders[0]?.Authorization).toBe("Bearer oauth-token-not-a-setup-token");
    expect(capturedHeaders[0]?.["x-api-key"]).toBeUndefined();
    expect(capturedHeaders[1]?.["x-api-key"]).toBe("oauth-token-not-a-setup-token");
    expect(capturedHeaders[1]?.Authorization).toBeUndefined();
  });

  it("includes context-1m beta for Claude OAuth setup-token auth when requested", async () => {
    const capturedHeaders: Array<Record<string, string>> = [];
    global.fetch = vi.fn(async (_url, init) => {
      capturedHeaders.push((init?.headers ?? {}) as Record<string, string>);
      return new Response(
        JSON.stringify({
          content: [{ type: "text", text: "ok" }]
        }),
        {
          status: 200,
          headers: {
            "content-type": "application/json",
            "request-id": "req_oauth_beta_ok"
          }
        }
      );
    }) as typeof fetch;

    const input = createInput("claude");
    input.provider.authMode = "oauth";
    input.step.use1MContext = true;

    const output = await executeClaudeWithApi(input, VALID_SETUP_TOKEN);
    expect(output).toBe("ok");
    expect(capturedHeaders).toHaveLength(1);
    expect(capturedHeaders[0]?.Authorization).toBeUndefined();
    expect(capturedHeaders[0]?.["x-api-key"]).toBe(VALID_SETUP_TOKEN);
    expect(capturedHeaders[0]?.["anthropic-beta"]).toContain("oauth-2025-04-20");
    expect(capturedHeaders[0]?.["anthropic-beta"]).toContain("claude-code-20250219");
    expect(capturedHeaders[0]?.["anthropic-beta"]).toContain("context-1m-2025-08-07");
  });
});
