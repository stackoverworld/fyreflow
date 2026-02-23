import { describe, expect, it, vi } from "vitest";

import type { PipelineStep, ProviderConfig } from "../../server/types/contracts.js";

vi.mock("../../server/providers.js", () => ({
  executeProviderStep: vi.fn(async () => "final output")
}));

import { executeStep } from "../../server/runner/execution.js";
import { executeProviderStep } from "../../server/providers.js";

const executeProviderStepMock = vi.mocked(executeProviderStep);

function createStep(): PipelineStep {
  return {
    id: "step-log-1",
    name: "Pipeline Orchestrator",
    role: "orchestrator",
    prompt: "Do the thing",
    providerId: "claude",
    model: "claude-sonnet-4-6",
    reasoningEffort: "low",
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
    skipIfArtifacts: []
  };
}

function createProvider(): ProviderConfig {
  return {
    id: "claude",
    label: "Anthropic",
    authMode: "oauth",
    apiKey: "",
    oauthToken: "",
    baseUrl: "https://api.anthropic.com/v1",
    defaultModel: "claude-sonnet-4-6",
    updatedAt: new Date().toISOString()
  };
}

describe("Step Execution Logging", () => {
  it("emits runtime progress logs around provider execution", async () => {
    const step = createStep();
    const provider = createProvider();
    const logs: string[] = [];

    const output = await executeStep(
      step,
      provider,
      "Context",
      "Task",
      420_000,
      new Map(),
      {},
      (message) => logs.push(message)
    );

    expect(output).toBe("final output");
    expect(logs.some((line) => line.includes("Execution config: provider=claude"))).toBe(true);
    expect(logs.some((line) => line.includes("Provider round 1 started"))).toBe(true);
    expect(logs.some((line) => line.includes("Provider round 1 finished"))).toBe(true);
    expect(logs.some((line) => line.includes("completed with final output"))).toBe(true);

    expect(executeProviderStepMock).toHaveBeenCalledTimes(1);
    expect(executeProviderStepMock.mock.calls[0][0]).toEqual(
      expect.objectContaining({
        stageTimeoutMs: expect.any(Number),
        log: expect.any(Function)
      })
    );
  });
});
