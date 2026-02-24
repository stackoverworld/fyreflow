import { afterEach, describe, expect, it, vi } from "vitest";

import { executeClaudeWithApi, executeOpenAIWithApi } from "../../server/providers/clientFactory/apiRunner.js";
import type { ProviderExecutionInput } from "../../server/providers/types.js";

const originalFetch = global.fetch;

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
      name: "Extractor",
      role: "analysis",
      prompt: "Extract design assets",
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
    task: "task",
    mcpServerIds: ["figma"]
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

afterEach(() => {
  global.fetch = originalFetch;
  vi.restoreAllMocks();
});

describe("API runner MCP native tool calling", () => {
  it("uses OpenAI function tool call for MCP routing", async () => {
    let payload: Record<string, unknown> | null = null;
    global.fetch = vi.fn(async (_url, init) => {
      payload = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return createSseResponse(
        [
          'event: response.created\ndata: {"type":"response.created"}\n\n',
          'event: response.output_item.done\ndata: {"type":"response.output_item.done","item":{"type":"function_call","name":"mcp_call","arguments":"{\\"server_id\\":\\"figma\\",\\"tool\\":\\"export_frames\\",\\"arguments\\":{\\"fileKey\\":\\"abc\\"}}"}}\n\n',
          'event: response.completed\ndata: {"type":"response.completed"}\n\n',
          "data: [DONE]\n\n"
        ],
        "x-request-id"
      );
    }) as typeof fetch;

    const output = await executeOpenAIWithApi(createInput("openai"), "sk-test");
    const parsed = JSON.parse(output) as { mcp_calls?: Array<Record<string, unknown>> };

    expect(parsed.mcp_calls).toHaveLength(1);
    expect(parsed.mcp_calls?.[0]).toEqual({
      server_id: "figma",
      tool: "export_frames",
      arguments: { fileKey: "abc" }
    });

    expect(payload).not.toBeNull();
    expect(Array.isArray(payload?.tools)).toBe(true);
    const toolDef = (payload?.tools as Array<Record<string, unknown>>)[0];
    expect(toolDef?.name).toBe("mcp_call");
    expect(payload?.tool_choice).toBe("auto");
    expect(payload?.parallel_tool_calls).toBe(false);
  });

  it("uses Claude tool_use blocks for MCP routing", async () => {
    let payload: Record<string, unknown> | null = null;
    global.fetch = vi.fn(async (_url, init) => {
      payload = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return createSseResponse(
        [
          'event: message_start\ndata: {"type":"message_start"}\n\n',
          'event: content_block_start\ndata: {"type":"content_block_start","index":0,"content_block":{"type":"tool_use","name":"mcp_call","input":{"server_id":"figma","tool":"export_frames","arguments":{"fileKey":"abc"}}}}\n\n',
          'event: content_block_stop\ndata: {"type":"content_block_stop","index":0}\n\n',
          'event: message_stop\ndata: {"type":"message_stop"}\n\n'
        ],
        "request-id"
      );
    }) as typeof fetch;

    const output = await executeClaudeWithApi(createInput("claude"), "sk-test");
    const parsed = JSON.parse(output) as { mcp_calls?: Array<Record<string, unknown>> };

    expect(parsed.mcp_calls).toHaveLength(1);
    expect(parsed.mcp_calls?.[0]).toEqual({
      server_id: "figma",
      tool: "export_frames",
      arguments: { fileKey: "abc" }
    });

    expect(payload).not.toBeNull();
    expect(Array.isArray(payload?.tools)).toBe(true);
    const toolDef = (payload?.tools as Array<Record<string, unknown>>)[0];
    expect(toolDef?.name).toBe("mcp_call");
    expect((payload?.tool_choice as { type?: unknown })?.type).toBe("auto");
  });
});
