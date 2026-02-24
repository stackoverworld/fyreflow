import { describe, expect, it, vi } from "vitest";

import { runPipeline } from "../../server/runner.js";
import type { Pipeline, PipelineLink, PipelineQualityGate, PipelineStep } from "../../server/types/contracts.js";
import { createTempStore } from "../helpers/tempStore.js";

const mocks = vi.hoisted(() => ({
  executeStepForPipeline: vi.fn(async (input: { outgoingLinks: PipelineLink[] }) => ({
    status: "success" as const,
    stepExecution: {
      output: "ok",
      qualityGateResults: [],
      hasBlockingGateFailure: false,
      shouldStopForInput: false,
      workflowOutcome: "pass" as const,
      outgoingLinks: input.outgoingLinks,
      routedLinks: input.outgoingLinks,
      subagentNotes: []
    }
  }))
}));

vi.mock("../../server/runner/stepExecution.js", () => ({
  executeStepForPipeline: mocks.executeStepForPipeline
}));

function createStep(id: string, name: string, role: PipelineStep["role"]): PipelineStep {
  return {
    id,
    name,
    role,
    prompt: "prompt",
    providerId: "claude",
    model: "claude-sonnet-4-6",
    reasoningEffort: "low",
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
    policyProfileIds: [],
    cacheBypassInputKeys: [],
    cacheBypassOrchestratorPromptPatterns: []
  };
}

function createDeliveryCompletionGate(targetStepId: string): PipelineQualityGate {
  return {
    id: "delivery-complete-gate",
    name: "Delivery Completion Gate",
    targetStepId,
    kind: "regex_must_match",
    blocking: true,
    pattern: "WORKFLOW_STATUS:\\s*COMPLETE",
    flags: "i",
    jsonPath: "",
    artifactPath: "",
    message: ""
  };
}

describe("runPipeline delivery completion gate validation", () => {
  it("fails fast when delivery completion gate targetStepId is not explicit", async () => {
    const { store, cleanup } = await createTempStore();

    try {
      mocks.executeStepForPipeline.mockClear();
      const basePipeline = store.listPipelines()[0];
      const steps: PipelineStep[] = [
        createStep("step-orchestrator", "Pipeline Orchestrator", "orchestrator"),
        createStep("step-delivery", "Delivery", "executor")
      ];
      const links: PipelineLink[] = [
        {
          id: "link-1",
          sourceStepId: "step-orchestrator",
          targetStepId: "step-delivery",
          condition: "always"
        }
      ];

      const pipeline: Pipeline = {
        ...basePipeline,
        id: `${basePipeline.id}-delivery-gate-validation`,
        steps,
        links,
        qualityGates: [createDeliveryCompletionGate("any_step")],
        runtime: {
          ...basePipeline.runtime,
          maxLoops: 1,
          maxStepExecutions: 4
        }
      };

      const run = store.createRun(pipeline, "Validate delivery gate targeting");

      await runPipeline({
        store,
        runId: run.id,
        pipeline,
        task: run.task
      });

      const completed = store.getRun(run.id);
      expect(completed?.status).toBe("failed");
      expect(
        completed?.logs.some((line) =>
          line.includes("Delivery completion quality gate is misconfigured")
        )
      ).toBe(true);
      expect(mocks.executeStepForPipeline).not.toHaveBeenCalled();
    } finally {
      await cleanup();
    }
  });
});
