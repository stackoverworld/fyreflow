import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PipelineStep, ProviderConfig } from "../../server/types/contracts.js";

const mocks = vi.hoisted(() => ({
  executeViaCli: vi.fn(async () => "cli-output"),
  executeClaudeWithApi: vi.fn(async () => "api-output"),
  executeOpenAIWithApi: vi.fn(async () => "openai-output"),
  getCachedCodexAccessToken: vi.fn(() => ""),
  probeOpenAiApiCredential: vi.fn(async () => ({
    status: "pass" as const,
    message: "OpenAI API credential verified.",
    checkedAt: "2026-03-06T00:00:00.000Z"
  })),
  getProviderOAuthStatus: vi.fn(async () => ({
    canUseApi: false,
    canUseCli: true,
    message: "CLI auth is ready"
  }))
}));

vi.mock("../../server/oauth.js", () => ({
  getCachedCodexAccessToken: mocks.getCachedCodexAccessToken,
  getProviderOAuthStatus: mocks.getProviderOAuthStatus,
  probeOpenAiApiCredential: mocks.probeOpenAiApiCredential
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

const VALID_SETUP_TOKEN =
  "sk-ant-oat01-rotated-test-fixture-do-not-use-2026-03-02-ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789abcdefghijk";

function createStep(partial: Partial<PipelineStep> = {}): PipelineStep {
  return {
    id: "step-1",
    name: "Pipeline Orchestrator",
    role: "orchestrator",
    prompt: "prompt",
    providerId: "claude",
    model: "claude-opus-4-6",
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
    defaultModel: "claude-opus-4-6",
    updatedAt: new Date().toISOString(),
    ...partial
  };
}

function createOpenAiStep(partial: Partial<PipelineStep> = {}): PipelineStep {
  return createStep({
    providerId: "openai",
    model: "gpt-5.4",
    ...partial
  });
}

function createOpenAiProvider(partial: Partial<ProviderConfig> = {}): ProviderConfig {
  return {
    id: "openai",
    label: "OpenAI / Codex",
    authMode: "api_key",
    apiKey: "sk-openai-test",
    oauthToken: "",
    baseUrl: "https://api.openai.com/v1",
    defaultModel: "gpt-5.4",
    updatedAt: new Date().toISOString(),
    ...partial
  };
}

describe("executeProviderStep fast-mode gating", () => {
  beforeEach(() => {
    mocks.executeViaCli.mockClear();
    mocks.executeClaudeWithApi.mockClear();
    mocks.executeOpenAIWithApi.mockClear();
    mocks.getCachedCodexAccessToken.mockReset();
    mocks.getCachedCodexAccessToken.mockReturnValue("");
    mocks.probeOpenAiApiCredential.mockClear();
    mocks.probeOpenAiApiCredential.mockResolvedValue({
      status: "pass",
      message: "OpenAI API credential verified.",
      checkedAt: "2026-03-06T00:00:00.000Z"
    });
    mocks.getProviderOAuthStatus.mockClear();
  });

  it("keeps fast mode on for Claude OAuth CLI path", async () => {
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
    expect(mocks.executeViaCli.mock.calls[0][0].step.fastMode).toBe(true);
    expect(logs.every((line) => !line.includes("fast mode requested but unavailable"))).toBe(true);
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

  it("turns Claude fast mode off for Sonnet even when auth is available", async () => {
    const logs: string[] = [];
    const output = await executeProviderStep({
      provider: createProvider({ authMode: "api_key", apiKey: "sk-ant-test", defaultModel: "claude-sonnet-4-6" }),
      step: createStep({ model: "claude-sonnet-4-6", fastMode: true }),
      context: "ctx",
      task: "task",
      log: (message) => logs.push(message)
    });

    expect(output).toBe("api-output");
    expect(mocks.executeClaudeWithApi).toHaveBeenCalledTimes(1);
    expect(mocks.executeClaudeWithApi.mock.calls[0][0].step.fastMode).toBe(false);
    expect(logs.some((line) => line.includes("fast mode requested but unavailable"))).toBe(true);
  });

  it("uses CLI path when Claude OAuth token is encrypted placeholder but CLI auth is available", async () => {
    const output = await executeProviderStep({
      provider: createProvider({
        authMode: "oauth",
        oauthToken: "enc:v1:iv.tag.payload"
      }),
      step: createStep({ fastMode: false }),
      context: "ctx",
      task: "task"
    });

    expect(output).toBe("cli-output");
    expect(mocks.executeClaudeWithApi).not.toHaveBeenCalled();
    expect(mocks.executeViaCli).toHaveBeenCalledTimes(1);
  });

  it("falls back to CLI when Claude OAuth value is not a setup-token", async () => {
    const output = await executeProviderStep({
      provider: createProvider({
        authMode: "oauth",
        oauthToken: "XADbhD5WjGH0ORuYcWlealQ#QouSHToVDbDZTQDEMnhGk88"
      }),
      step: createStep({ fastMode: false }),
      context: "ctx",
      task: "task"
    });

    expect(output).toBe("cli-output");
    expect(mocks.executeClaudeWithApi).not.toHaveBeenCalled();
    expect(mocks.executeViaCli).toHaveBeenCalledTimes(1);
  });

  it("prefers CLI path when Claude OAuth CLI session is available", async () => {
    const output = await executeProviderStep({
      provider: createProvider({
        authMode: "oauth",
        oauthToken: VALID_SETUP_TOKEN
      }),
      step: createStep({ fastMode: false }),
      context: "ctx",
      task: "task"
    });

    expect(output).toBe("cli-output");
    expect(mocks.executeViaCli).toHaveBeenCalledTimes(1);
    expect(mocks.executeClaudeWithApi).not.toHaveBeenCalled();
  });

  it("treats Claude OAuth as not ready when runtime probe fails before CLI execution", async () => {
    mocks.getProviderOAuthStatus.mockResolvedValueOnce({
      canUseApi: false,
      canUseCli: true,
      message: "Logged in with Claude Code.",
      runtimeProbe: {
        status: "fail",
        message: "Claude CLI runtime probe failed: not logged in",
        checkedAt: "2026-03-05T12:00:00.000Z"
      }
    });

    await expect(
      executeProviderStep({
        provider: createProvider({ authMode: "oauth", apiKey: "", oauthToken: "" }),
        step: createStep({ fastMode: false }),
        context: "ctx",
        task: "task"
      })
    ).rejects.toThrow("Provider OAuth is not ready");

    expect(mocks.executeViaCli).not.toHaveBeenCalled();
  });

  it("uses Claude API token fallback when CLI runtime probe fails", async () => {
    mocks.getProviderOAuthStatus.mockResolvedValueOnce({
      canUseApi: false,
      canUseCli: true,
      message: "Logged in with Claude Code.",
      runtimeProbe: {
        status: "fail",
        message: "Claude CLI runtime probe failed: command exited with code 1",
        checkedAt: "2026-03-05T12:00:00.000Z"
      }
    });

    const output = await executeProviderStep({
      provider: createProvider({
        authMode: "oauth",
        oauthToken: VALID_SETUP_TOKEN
      }),
      step: createStep({ fastMode: false }),
      context: "ctx",
      task: "task"
    });

    expect(output).toBe("api-output");
    expect(mocks.executeClaudeWithApi).toHaveBeenCalledTimes(1);
    expect(mocks.executeViaCli).not.toHaveBeenCalled();
  });

  it("keeps fast mode on for OpenAI API key path", async () => {
    const output = await executeProviderStep({
      provider: createOpenAiProvider(),
      step: createOpenAiStep({ fastMode: true }),
      context: "ctx",
      task: "task"
    });

    expect(output).toBe("openai-output");
    expect(mocks.executeOpenAIWithApi).toHaveBeenCalledTimes(1);
    expect(mocks.executeOpenAIWithApi.mock.calls[0][0].step.fastMode).toBe(true);
  });

  it("keeps OpenAI fast mode enabled when execution falls back to Codex CLI", async () => {
    const output = await executeProviderStep({
      provider: createOpenAiProvider({
        authMode: "oauth",
        apiKey: "",
        oauthToken: ""
      }),
      step: createOpenAiStep({ fastMode: true }),
      context: "ctx",
      task: "task"
    });

    expect(output).toBe("cli-output");
    expect(mocks.executeOpenAIWithApi).not.toHaveBeenCalled();
    expect(mocks.executeViaCli).toHaveBeenCalledTimes(1);
    expect(mocks.executeViaCli.mock.calls[0][0].step.fastMode).toBe(true);
  });

  it("rejects OpenAI API-only models when only the Codex CLI path is available", async () => {
    await expect(
      executeProviderStep({
        provider: createOpenAiProvider({
          authMode: "oauth",
          apiKey: "",
          oauthToken: ""
        }),
        step: createOpenAiStep({ fastMode: false, model: "gpt-5.4-pro" }),
        context: "ctx",
        task: "task"
      })
    ).rejects.toThrow("gpt-5.4-pro requires an OpenAI API-capable credential");

    expect(mocks.executeOpenAIWithApi).not.toHaveBeenCalled();
    expect(mocks.executeViaCli).not.toHaveBeenCalled();
  });

  it("rejects OpenAI API-only models when stored OAuth credential fails runtime validation", async () => {
    mocks.probeOpenAiApiCredential.mockResolvedValueOnce({
      status: "fail",
      message: "OpenAI API token expired. Refresh OpenAI OAuth or save a fresh API key.",
      checkedAt: "2026-03-06T00:00:00.000Z"
    });

    await expect(
      executeProviderStep({
        provider: createOpenAiProvider({
          authMode: "oauth",
          apiKey: "",
          oauthToken: "stored-openai-token"
        }),
        step: createOpenAiStep({ fastMode: false, model: "gpt-5.4-pro" }),
        context: "ctx",
        task: "task"
      })
    ).rejects.toThrow("gpt-5.4-pro requires a valid OpenAI API-capable credential");

    expect(mocks.executeOpenAIWithApi).not.toHaveBeenCalled();
    expect(mocks.executeViaCli).not.toHaveBeenCalled();
  });

  it("does not use cached Codex API token when OpenAI is still saved in API key mode", async () => {
    mocks.getCachedCodexAccessToken.mockReturnValue("cached-openai-token");

    await expect(
      executeProviderStep({
        provider: createOpenAiProvider({
          authMode: "api_key",
          apiKey: "",
          oauthToken: ""
        }),
        step: createOpenAiStep({ fastMode: false, model: "gpt-5.4-pro" }),
        context: "ctx",
        task: "task"
      })
    ).rejects.toThrow("gpt-5.4-pro requires an OpenAI API-capable credential");

    expect(mocks.executeOpenAIWithApi).not.toHaveBeenCalled();
    expect(mocks.executeViaCli).not.toHaveBeenCalled();
  });
});
