import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PipelineStep, ProviderConfig } from "../../server/types/contracts.js";

const mocks = vi.hoisted(() => ({
  executeViaCli: vi.fn(async () => "cli-output"),
  executeClaudeWithApi: vi.fn(async () => "api-output"),
  executeOpenAIWithApi: vi.fn(async () => "openai-output"),
  getProviderOAuthStatus: vi.fn(async () => ({
    canUseApi: false,
    canUseCli: true,
    message: "CLI auth is ready"
  }))
}));

vi.mock("../../server/oauth.js", () => ({
  getCachedCodexAccessToken: vi.fn(() => ""),
  getProviderOAuthStatus: mocks.getProviderOAuthStatus
}));

vi.mock("../../server/providers/clientFactory.js", () => ({
  executeViaCli: mocks.executeViaCli,
  executeClaudeWithApi: mocks.executeClaudeWithApi,
  executeOpenAIWithApi: mocks.executeOpenAIWithApi,
  ProviderApiError: class ProviderApiError extends Error {
    readonly statusCode: number;
    readonly retryAfterMs: number | null;

    constructor(statusCode: number, retryAfterMs: number | null, message: string) {
      super(message);
      this.statusCode = statusCode;
      this.retryAfterMs = retryAfterMs;
    }
  }
}));

import { executeProviderStep } from "../../server/providers.js";

function createStep(partial: Partial<PipelineStep> = {}): PipelineStep {
  return {
    id: "step-1",
    name: "Pipeline Orchestrator",
    role: "orchestrator",
    prompt: "prompt",
    providerId: "claude",
    model: "claude-sonnet-4-6",
    reasoningEffort: "medium",
    fastMode: true,
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
    id: "claude",
    label: "Anthropic",
    authMode: "oauth",
    apiKey: "",
    oauthToken: "",
    baseUrl: "https://api.anthropic.com/v1",
    defaultModel: "claude-sonnet-4-6",
    updatedAt: new Date().toISOString(),
    ...partial
  };
}

describe("executeProviderStep fast-mode gating", () => {
  beforeEach(() => {
    mocks.executeViaCli.mockClear();
    mocks.executeClaudeWithApi.mockClear();
    mocks.executeOpenAIWithApi.mockClear();
    mocks.getProviderOAuthStatus.mockClear();
  });

  it("forces fast mode off for Claude CLI path without active API key auth", async () => {
    const logs: string[] = [];
    const output = await executeProviderStep({
      provider: createProvider({ authMode: "oauth", apiKey: "", oauthToken: "" }),
      step: createStep({ fastMode: true }),
      context: "ctx",
      task: "task",
      log: (message) => logs.push(message)
    });

    expect(output).toBe("cli-output");
    expect(mocks.executeViaCli).toHaveBeenCalledTimes(1);
    expect(mocks.executeViaCli.mock.calls[0][0].step.fastMode).toBe(false);
    expect(
      logs.some((line) =>
        line.includes("Claude fast mode requested but unavailable without active API key auth")
      )
    ).toBe(true);
  });

  it("keeps fast mode on for Claude API key path", async () => {
    const output = await executeProviderStep({
      provider: createProvider({ authMode: "api_key", apiKey: "sk-ant-test" }),
      step: createStep({ fastMode: true }),
      context: "ctx",
      task: "task"
    });

    expect(output).toBe("api-output");
    expect(mocks.executeClaudeWithApi).toHaveBeenCalledTimes(1);
    expect(mocks.executeClaudeWithApi.mock.calls[0][0].step.fastMode).toBe(true);
  });

  it("fails fast when stored oauth token is still encrypted placeholder", async () => {
    await expect(
      executeProviderStep({
        provider: createProvider({
          authMode: "oauth",
          oauthToken: "enc:v1:iv.tag.payload"
        }),
        step: createStep({ fastMode: false }),
        context: "ctx",
        task: "task"
      })
    ).rejects.toThrow("Stored provider credential cannot be decrypted");

    expect(mocks.executeClaudeWithApi).not.toHaveBeenCalled();
    expect(mocks.executeViaCli).not.toHaveBeenCalled();
  });

  it("fails fast when Claude OAuth value is not a setup-token", async () => {
    await expect(
      executeProviderStep({
        provider: createProvider({
          authMode: "oauth",
          oauthToken: "XADbhD5WjGH0ORuYcWlealQ#QouSHToVDbDZTQDEMnhGk88"
        }),
        step: createStep({ fastMode: false }),
        context: "ctx",
        task: "task"
      })
    ).rejects.toThrow("Stored Claude OAuth value is not a setup-token");

    expect(mocks.executeClaudeWithApi).not.toHaveBeenCalled();
    expect(mocks.executeViaCli).not.toHaveBeenCalled();
  });
});
