import { describe, expect, it, vi } from "vitest";
import type { LocalStore } from "../../server/storage.js";
import type { PipelineLink, PipelineStep, ProviderConfig } from "../../server/types/contracts.js";

vi.mock("../../server/providers.js", () => ({
  executeProviderStep: vi.fn()
}));

import { executeProviderStep } from "../../server/providers.js";
import { evaluateStepExecution } from "../../server/runner/execution.js";

const executeProviderStepMock = vi.mocked(executeProviderStep);

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

function createStep(partial: Partial<PipelineStep> = {}): PipelineStep {
  return {
    id: "step-1",
    name: "Delivery",
    role: "executor",
    prompt: "Deliver final artifacts",
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

function createOutputContract(partial: Record<string, unknown> = {}): string {
  return JSON.stringify({
    workflow_status: "COMPLETE",
    next_action: "stop",
    stage: "final",
    step_role: "delivery",
    gate_target: "delivery",
    summary: "done",
    reasons: [{ code: "done", message: "Delivery complete." }],
    ...partial
  });
}

async function runStep(step: PipelineStep, outgoingLinks: PipelineLink[]): Promise<Awaited<ReturnType<typeof evaluateStepExecution>>> {
  return evaluateStepExecution({
    store: {} as LocalStore,
    runId: "run-1",
    step,
    attempt: 1,
    provider: createProvider(),
    context: "ctx",
    task: "task",
    stageTimeoutMs: 420_000,
    mcpServersById: new Map(),
    runInputs: {},
    outgoingLinks,
    qualityGates: [],
    stepById: new Map([[step.id, step]]),
    storagePaths: {
      sharedStoragePath: "DISABLED",
      isolatedStoragePath: "DISABLED",
      runStoragePath: "DISABLED"
    }
  });
}

describe("delivery completion invariant", () => {
  it("fails COMPLETE contract when emitted before final stage", async () => {
    executeProviderStepMock.mockResolvedValueOnce(createOutputContract());
    const step = createStep({ id: "review", name: "HTML Reviewer", role: "review" });
    const outgoingLinks: PipelineLink[] = [
      { id: "l1", sourceStepId: "review", targetStepId: "next", condition: "always" }
    ];

    const result = await runStep(step, outgoingLinks);
    const invariantGate = result.qualityGateResults.find(
      (entry) => entry.gateName === "Delivery completion target invariant"
    );

    expect(invariantGate?.status).toBe("fail");
    expect(result.hasBlockingGateFailure).toBe(true);
  });

  it("passes COMPLETE contract on final delivery executor stage", async () => {
    executeProviderStepMock.mockResolvedValueOnce(createOutputContract());
    const step = createStep();

    const result = await runStep(step, []);
    const invariantGate = result.qualityGateResults.find(
      (entry) => entry.gateName === "Delivery completion target invariant"
    );

    expect(invariantGate?.status).toBe("pass");
    expect(result.hasBlockingGateFailure).toBe(false);
  });
});
