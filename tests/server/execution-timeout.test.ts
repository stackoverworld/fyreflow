import { describe, expect, it } from "vitest";

import { resolveEffectiveStageTimeoutMs } from "../../server/runner/execution.js";
import type { PipelineStep, ProviderConfig } from "../../server/types/contracts.js";

function createStep(partial: Partial<PipelineStep> = {}): PipelineStep {
  return {
    id: "step-1",
    name: "Step",
    role: "analysis",
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

describe("resolveEffectiveStageTimeoutMs", () => {
  it("extends sonnet high-effort artifact roles to multi-minute budgets", () => {
    const step = createStep({ role: "analysis", reasoningEffort: "high", model: "claude-sonnet-4-6" });
    const provider = createProvider({ id: "claude", defaultModel: "claude-sonnet-4-6" });

    const timeoutMs = resolveEffectiveStageTimeoutMs(step, provider, 420_000);
    expect(timeoutMs).toBe(2_400_000);
  });

  it("extends sonnet artifact roles at medium effort to at least 20 minutes", () => {
    const step = createStep({ role: "executor", reasoningEffort: "medium", model: "claude-sonnet-4-6" });
    const provider = createProvider({ id: "claude", defaultModel: "claude-sonnet-4-6" });

    const timeoutMs = resolveEffectiveStageTimeoutMs(step, provider, 420_000);
    expect(timeoutMs).toBe(1_200_000);
  });

  it("keeps non-artifact claude roles on baseline floor", () => {
    const step = createStep({ role: "orchestrator", reasoningEffort: "low", model: "claude-sonnet-4-6" });
    const provider = createProvider({ id: "claude", defaultModel: "claude-sonnet-4-6" });

    const timeoutMs = resolveEffectiveStageTimeoutMs(step, provider, 420_000);
    expect(timeoutMs).toBe(420_000);
  });
});
