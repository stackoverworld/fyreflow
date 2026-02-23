import { describe, expect, it, vi } from "vitest";

import { runPipeline } from "../../server/runner.js";
import type { Pipeline, PipelineLink, PipelineStep } from "../../server/types/contracts.js";
import { createTempStore } from "../helpers/tempStore.js";

const schedulerProbe = {
  step1Running: false,
  step2Running: false,
  step2StartedWhileStep1Running: false,
  step3StartedWhileStep2Running: false
};

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

vi.mock("../../server/runner/stepExecution.js", () => ({
  executeStepForPipeline: async (input: { step: PipelineStep; outgoingLinks: PipelineLink[] }) => {
    const { step } = input;

    if (step.id === "step-2" && schedulerProbe.step1Running) {
      schedulerProbe.step2StartedWhileStep1Running = true;
    }
    if (step.id === "step-3" && schedulerProbe.step2Running) {
      schedulerProbe.step3StartedWhileStep2Running = true;
    }

    if (step.id === "step-1") {
      schedulerProbe.step1Running = true;
      await delay(60);
      schedulerProbe.step1Running = false;
    } else if (step.id === "step-2") {
      schedulerProbe.step2Running = true;
      await delay(40);
      schedulerProbe.step2Running = false;
    } else {
      await delay(10);
    }

    return {
      status: "success",
      stepExecution: {
        output: `${step.name} done`,
        qualityGateResults: [],
        hasBlockingGateFailure: false,
        shouldStopForInput: false,
        workflowOutcome: "pass",
        outgoingLinks: input.outgoingLinks,
        routedLinks: input.outgoingLinks,
        subagentNotes: []
      }
    };
  }
}));

function createStep(
  id: string,
  name: string,
  role: PipelineStep["role"],
  enableDelegation = false,
  delegationCount = 1
): PipelineStep {
  return {
    id,
    name,
    role,
    prompt: "prompt",
    providerId: "claude",
    model: "claude-sonnet-4-6",
    reasoningEffort: "medium",
    fastMode: false,
    use1MContext: false,
    contextWindowTokens: 128_000,
    position: { x: 0, y: 0 },
    contextTemplate: "",
    enableDelegation,
    delegationCount,
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

describe("Runner Parallel Scheduling", () => {
  it("does not start dependent steps while a predecessor is still running", async () => {
    schedulerProbe.step1Running = false;
    schedulerProbe.step2Running = false;
    schedulerProbe.step2StartedWhileStep1Running = false;
    schedulerProbe.step3StartedWhileStep2Running = false;

    const { store, cleanup } = await createTempStore();
    try {
      const basePipeline = store.listPipelines()[0];
      const steps: PipelineStep[] = [
        createStep("step-1", "Pipeline Orchestrator", "orchestrator", true, 3),
        createStep("step-2", "Design Asset Extraction", "analysis"),
        createStep("step-3", "PDF Content Extractor", "analysis")
      ];
      const pipeline: Pipeline = {
        ...basePipeline,
        id: `${basePipeline.id}-parallel-order`,
        steps,
        links: [
          {
            id: "link-1",
            sourceStepId: "step-1",
            targetStepId: "step-2",
            condition: "always"
          },
          {
            id: "link-2",
            sourceStepId: "step-2",
            targetStepId: "step-3",
            condition: "always"
          }
        ],
        runtime: {
          ...basePipeline.runtime,
          maxLoops: 1,
          maxStepExecutions: 10
        }
      };

      const run = store.createRun(pipeline, "Scheduler dependency order test");

      await runPipeline({
        store,
        runId: run.id,
        pipeline,
        task: run.task
      });

      const completedRun = store.getRun(run.id);
      expect(completedRun?.status).toBe("completed");
      expect(completedRun?.logs.some((line) => line.includes("disconnected fallback"))).toBe(false);
      expect(schedulerProbe.step2StartedWhileStep1Running).toBe(false);
      expect(schedulerProbe.step3StartedWhileStep2Running).toBe(false);
    } finally {
      await cleanup();
    }
  });
});
