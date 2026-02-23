import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PipelineStep, ProviderConfig } from "../../server/types/contracts.js";

const mocks = vi.hoisted(() => ({
  executeViaCli: vi.fn(async () => "cli-output"),
  executeClaudeWithApi: vi.fn(async () => "claude-output"),
  executeOpenAIWithApi: vi.fn(async () => "openai-output"),
  getProviderOAuthStatus: vi.fn(async () => ({
    canUseApi: true,
    canUseCli: true,
    message: "OAuth ready"
  })),
  ProviderApiError: class ProviderApiError extends Error {
    readonly statusCode: number;
    readonly retryAfterMs: number | null;

    constructor(statusCode: number, retryAfterMs: number | null, message: string) {
      super(message);
      this.name = "ProviderApiError";
      this.statusCode = statusCode;
      this.retryAfterMs = retryAfterMs;
    }
  }
}));

vi.mock("../../server/oauth.js", () => ({
  getCachedCodexAccessToken: vi.fn(() => ""),
  getProviderOAuthStatus: mocks.getProviderOAuthStatus
}));

vi.mock("../../server/providers/clientFactory.js", () => ({
  executeViaCli: mocks.executeViaCli,
  executeClaudeWithApi: mocks.executeClaudeWithApi,
  executeOpenAIWithApi: mocks.executeOpenAIWithApi,
  ProviderApiError: mocks.ProviderApiError
}));

import { executeProviderStep } from "../../server/providers.js";

function createStep(partial: Partial<PipelineStep> = {}): PipelineStep {
  return {
    id: "step-1",
    name: "Pipeline Orchestrator",
    role: "orchestrator",
    prompt: "prompt",
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
    skipIfArtifacts: [],
    ...partial
  };
}

function createProvider(partial: Partial<ProviderConfig> = {}): ProviderConfig {
  return {
    id: "openai",
    label: "OpenAI",
    authMode: "api_key",
    apiKey: "sk-test",
    oauthToken: "",
    baseUrl: "https://api.openai.com/v1",
    defaultModel: "gpt-5.3-codex",
    updatedAt: new Date().toISOString(),
    ...partial
  };
}

describe("executeProviderStep retry-after behavior", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mocks.executeViaCli.mockClear();
    mocks.executeClaudeWithApi.mockClear();
    mocks.executeOpenAIWithApi.mockClear();
    mocks.getProviderOAuthStatus.mockClear();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("retries OpenAI API calls after retry-after delay", async () => {
    mocks.executeOpenAIWithApi
      .mockRejectedValueOnce(new mocks.ProviderApiError(429, 50, "rate limited"))
      .mockResolvedValueOnce("openai-recovered");

    const logs: string[] = [];
    const pending = executeProviderStep({
      provider: createProvider(),
      step: createStep(),
      context: "ctx",
      task: "task",
      log: (line) => logs.push(line)
    });

    await vi.advanceTimersByTimeAsync(49);
    expect(mocks.executeOpenAIWithApi).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(1);
    await expect(pending).resolves.toBe("openai-recovered");
    expect(mocks.executeOpenAIWithApi).toHaveBeenCalledTimes(2);
    expect(logs.some((line) => line.includes("retry_after_ms=50"))).toBe(true);
  });

  it("does not retry non-retryable OpenAI API status codes", async () => {
    mocks.executeOpenAIWithApi.mockRejectedValueOnce(new mocks.ProviderApiError(400, null, "bad request"));

    await expect(
      executeProviderStep({
        provider: createProvider(),
        step: createStep(),
        context: "ctx",
        task: "task"
      })
    ).rejects.toThrow("bad request");

    expect(mocks.executeOpenAIWithApi).toHaveBeenCalledTimes(1);
  });
});
