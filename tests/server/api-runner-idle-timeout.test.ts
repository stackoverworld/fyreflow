import { afterEach, describe, expect, it, vi } from "vitest";

import type { ProviderExecutionInput } from "../../server/providers/types.js";

const originalFetch = global.fetch;

function createOpenAiInput(): ProviderExecutionInput {
  return {
    provider: {
      id: "openai",
      label: "OpenAI",
      authMode: "api_key",
      apiKey: "sk-test",
      oauthToken: "",
      baseUrl: "https://api.openai.com/v1",
      defaultModel: "gpt-5.3-codex",
      updatedAt: new Date().toISOString()
    },
    step: {
      id: "step-openai",
      name: "Reviewer",
      role: "review",
      prompt: "Review output",
      providerId: "openai",
      model: "gpt-5.3-codex",
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
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("API runner streaming idle timeout", () => {
  it("aborts stalled OpenAI SSE streams", async () => {
    vi.stubEnv("LLM_STREAM_IDLE_TIMEOUT_MS", "25");
    vi.resetModules();

    const stream = new ReadableStream<Uint8Array>({
      start() {
        // keep connection open with no events
      }
    });

    global.fetch = vi.fn(async () =>
      new Response(stream, {
        status: 200,
        headers: {
          "content-type": "text/event-stream"
        }
      })
    ) as typeof fetch;

    const { executeOpenAIWithApi } = await import("../../server/providers/clientFactory/apiRunner.js");

    await expect(executeOpenAIWithApi(createOpenAiInput(), "sk-test")).rejects.toThrow(/stalled/i);
  });
});
