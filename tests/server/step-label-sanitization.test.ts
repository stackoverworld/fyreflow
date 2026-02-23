import { describe, expect, it, vi } from "vitest";

import { runPipeline } from "../../server/runner.js";
import { normalizeStep } from "../../server/storage/pipelineStore/normalization.js";
import type { Pipeline, PipelineLink, PipelineStep } from "../../server/types/contracts.js";
import { createTempStore } from "../helpers/tempStore.js";

vi.mock("../../server/runner/stepExecution.js", () => ({
  executeStepForPipeline: async (input: { outgoingLinks: PipelineLink[] }) => ({
    status: "success",
    stepExecution: {
      output: "ok",
      qualityGateResults: [],
      hasBlockingGateFailure: false,
      shouldStopForInput: false,
      workflowOutcome: "pass",
      outgoingLinks: input.outgoingLinks,
      routedLinks: input.outgoingLinks,
      subagentNotes: []
    }
  })
}));

function createMalformedStep(): PipelineStep {
  return {
    id: "step-1",
    name: { invalid: true } as unknown as string,
    role: "orchestrator",
    prompt: "prompt",
    providerId: "claude",
    model: "claude-sonnet-4-6",
    reasoningEffort: "low",
    fastMode: false,
    use1MContext: false,
    contextWindowTokens: 128_000,
    position: { x: 0, y: 0 },
    contextTemplate: "",
    enableDelegation: true,
    delegationCount: 3,
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

describe("Step label sanitization", () => {
  it("normalizes malformed step id/name values", () => {
    const normalized = normalizeStep(
      {
        id: { bad: true } as unknown as string,
        name: { bad: true } as unknown as string,
        role: "analysis",
        prompt: "prompt"
      },
      0
    );

    expect(typeof normalized.id).toBe("string");
    expect(normalized.id.length).toBeGreaterThan(0);
    expect(normalized.name).toBe(normalized.id);
  });

  it("keeps run logs free of [object Object] when step name is malformed", async () => {
    const { store, cleanup } = await createTempStore();

    try {
      const basePipeline = store.listPipelines()[0];
      const pipeline: Pipeline = {
        ...basePipeline,
        id: `${basePipeline.id}-step-label-sanitization`,
        steps: [createMalformedStep()],
        links: [],
        runtime: {
          ...basePipeline.runtime,
          maxLoops: 1,
          maxStepExecutions: 3
        }
      };

      const run = store.createRun(pipeline, "Step label sanitization run");
      expect(run.steps[0]?.stepName).toBe("step-1");

      await runPipeline({
        store,
        runId: run.id,
        pipeline,
        task: run.task
      });

      const completed = store.getRun(run.id);
      expect(completed?.status).toBe("completed");
      expect(completed?.logs.some((line) => line.includes("[object Object]"))).toBe(false);
      expect(completed?.logs.some((line) => line.includes("Subagent-1 started: step-1"))).toBe(true);
    } finally {
      await cleanup();
    }
  });
});
