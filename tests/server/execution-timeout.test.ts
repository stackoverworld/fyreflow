import { describe, expect, it } from "vitest";

import { resolveEffectiveStageTimeoutMs } from "../../server/runner/execution.js";
import type { PipelineStep, ProviderConfig } from "../../server/types/contracts.js";

function createStep(overrides?: Partial<PipelineStep>): PipelineStep {
  return {
    id: "step-1",
    name: "Git Fetcher",
    role: "analysis",
    prompt: "Fetch",
    providerId: "claude",
    model: "claude-opus-4-1",
    reasoningEffort: "high",
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
    sandboxMode: "secure",
    outputFormat: "markdown",
    requiredOutputFields: [],
    requiredOutputFiles: [],
    scenarios: [],
    skipIfArtifacts: [],
    policyProfileIds: [],
    cacheBypassInputKeys: [],
    cacheBypassOrchestratorPromptPatterns: [],
    ...overrides
  };
}

const claudeProvider: ProviderConfig = {
  id: "claude",
  label: "Anthropic",
  authMode: "oauth",
  apiKey: "",
  oauthToken: "",
  baseUrl: "https://api.anthropic.com/v1",
  defaultModel: "claude-opus-4-1",
  updatedAt: new Date().toISOString()
};

describe("resolveEffectiveStageTimeoutMs", () => {
  it("caps heavy claude stages instead of inflating them to hour-long waits", () => {
    const timeoutMs = resolveEffectiveStageTimeoutMs(createStep(), claudeProvider, 3_600_000);
    expect(timeoutMs).toBe(900_000);
  });

  it("preserves smaller caller-provided timeouts", () => {
    const timeoutMs = resolveEffectiveStageTimeoutMs(
      createStep({ model: "claude-sonnet-4-6", reasoningEffort: "medium" }),
      { ...claudeProvider, defaultModel: "claude-sonnet-4-6" },
      180_000
    );

    expect(timeoutMs).toBe(180_000);
  });
});
