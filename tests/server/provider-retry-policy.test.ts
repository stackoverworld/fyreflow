import { describe, expect, it } from "vitest";

import {
  buildClaudeTimeoutFallbackInput,
  resolveClaudeCliAttemptTimeoutMs,
  shouldTryClaudeTimeoutFallback
} from "../../server/providers/retryPolicy.js";
import type { PipelineStep } from "../../server/types/contracts.js";
import type { ProviderExecutionInput } from "../../server/providers/types.js";

function createStep(partial: Partial<PipelineStep> = {}): PipelineStep {
  return {
    id: "step-1",
    name: "Pipeline Orchestrator",
    role: "orchestrator",
    prompt: "prompt",
    providerId: "claude",
    model: "claude-sonnet-4-6",
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

describe("Provider Retry Policy", () => {
  it("keeps a fallback reserve within stage timeout budget", () => {
    const step = createStep();
    const baseline = resolveClaudeCliAttemptTimeoutMs(step, step.model);
    const stageBudget = baseline + 120_000;
    const withBudget = resolveClaudeCliAttemptTimeoutMs(step, step.model, stageBudget);

    expect(withBudget).toBeLessThan(stageBudget);
    expect(stageBudget - withBudget).toBeGreaterThanOrEqual(30_000);
  });

  it("does not inflate attempt timeout to massive stage budget", () => {
    const step = createStep();
    const withHugeBudget = resolveClaudeCliAttemptTimeoutMs(step, step.model, 2_400_000);

    expect(withHugeBudget).toBeLessThan(2_400_000);
    expect(withHugeBudget).toBeGreaterThanOrEqual(60_000);
  });

  it("expands claude attempt timeout for long-running executor steps when stage budget is large", () => {
    const step = createStep({
      role: "executor",
      name: "HTML Builder",
      model: "claude-opus-4-6",
      reasoningEffort: "high"
    });

    const withLargeBudget = resolveClaudeCliAttemptTimeoutMs(step, step.model, 900_000);

    expect(withLargeBudget).toBeGreaterThan(420_000);
    expect(withLargeBudget).toBeLessThan(900_000);
  });

  it("skips timeout fallback when first attempt leaves too little stage budget", () => {
    const step = createStep({ role: "executor", name: "HTML Remediator" });
    const input: ProviderExecutionInput = {
      provider: {
        id: "claude",
        label: "Anthropic",
        authMode: "oauth",
        apiKey: "",
        oauthToken: "",
        baseUrl: "https://api.anthropic.com/v1",
        defaultModel: step.model,
        updatedAt: new Date().toISOString()
      },
      step,
      context: "ctx",
      task: "task",
      stageTimeoutMs: 420_000
    };

    const shouldFallback = shouldTryClaudeTimeoutFallback(
      input,
      new Error("/Users/me/.local/bin/claude timed out")
    );
    expect(shouldFallback).toBe(false);
  });

  it("allows timeout fallback when stage budget has enough room for a second attempt", () => {
    const step = createStep();
    const input: ProviderExecutionInput = {
      provider: {
        id: "claude",
        label: "Anthropic",
        authMode: "oauth",
        apiKey: "",
        oauthToken: "",
        baseUrl: "https://api.anthropic.com/v1",
        defaultModel: step.model,
        updatedAt: new Date().toISOString()
      },
      step,
      context: "ctx",
      task: "task",
      stageTimeoutMs: 900_000
    };

    const shouldFallback = shouldTryClaudeTimeoutFallback(
      input,
      new Error("/Users/me/.local/bin/claude timed out")
    );
    expect(shouldFallback).toBe(true);
  });

  it("disables fast mode in timeout fallback when Claude API key auth is not active", () => {
    const step = createStep({ fastMode: true, reasoningEffort: "high", use1MContext: true });
    const input: ProviderExecutionInput = {
      provider: {
        id: "claude",
        label: "Anthropic",
        authMode: "oauth",
        apiKey: "",
        oauthToken: "",
        baseUrl: "https://api.anthropic.com/v1",
        defaultModel: step.model,
        updatedAt: new Date().toISOString()
      },
      step,
      context: "ctx",
      task: "task"
    };

    const fallbackInput = buildClaudeTimeoutFallbackInput(input);
    expect(fallbackInput.step.fastMode).toBe(false);
    expect(fallbackInput.step.reasoningEffort).toBe("low");
    expect(fallbackInput.step.use1MContext).toBe(false);
  });

  it("keeps fast mode enabled in timeout fallback when Claude API key auth is active", () => {
    const step = createStep({ fastMode: false });
    const input: ProviderExecutionInput = {
      provider: {
        id: "claude",
        label: "Anthropic",
        authMode: "api_key",
        apiKey: "sk-ant-test",
        oauthToken: "",
        baseUrl: "https://api.anthropic.com/v1",
        defaultModel: step.model,
        updatedAt: new Date().toISOString()
      },
      step,
      context: "ctx",
      task: "task"
    };

    const fallbackInput = buildClaudeTimeoutFallbackInput(input);
    expect(fallbackInput.step.fastMode).toBe(true);
  });
});
