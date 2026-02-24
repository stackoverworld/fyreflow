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
      name: "HTML Reviewer",
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

afterEach(() => {
  global.fetch = originalFetch;
  vi.restoreAllMocks();
});

describe("API runner provider-level structured output", () => {
  it("sends OpenAI strict json_schema response_format for GateResult JSON steps", async () => {
    let payload: Record<string, unknown> | null = null;
    global.fetch = vi.fn(async (_url, init) => {
      payload = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return new Response(JSON.stringify({ output_text: '{"workflow_status":"PASS"}' }), {
        status: 200,
        headers: {
          "content-type": "application/json"
        }
      });
    }) as typeof fetch;

    const input = createInput("openai");
    input.outputMode = "json";

    await executeOpenAIWithApi(input, "sk-test");

    expect(payload).not.toBeNull();
    const responseFormat = payload?.response_format as Record<string, unknown>;
    expect(responseFormat?.type).toBe("json_schema");
    const jsonSchema = responseFormat?.json_schema as Record<string, unknown>;
    expect(jsonSchema?.strict).toBe(true);
    expect(payload?.parallel_tool_calls).toBe(false);
  });

  it("sends Anthropic output_config.format json_schema for GateResult JSON steps", async () => {
    let payload: Record<string, unknown> | null = null;
    global.fetch = vi.fn(async (_url, init) => {
      payload = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return new Response(
        JSON.stringify({
          content: [{ type: "text", text: '{"workflow_status":"PASS","next_action":"continue","reasons":[{"code":"ok","message":"ok"}]}' }]
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
    input.outputMode = "json";

    await executeClaudeWithApi(input, "sk-test");

    expect(payload).not.toBeNull();
    const outputConfig = payload?.output_config as Record<string, unknown>;
    const format = outputConfig?.format as Record<string, unknown>;
    expect(format?.type).toBe("json_schema");
    expect(format?.name).toBe("gate_result_contract");
  });
});
