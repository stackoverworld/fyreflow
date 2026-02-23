import { describe, expect, it, vi } from "vitest";

import { runPipeline } from "../../server/runner.js";
import type { Pipeline, PipelineLink, PipelineStep } from "../../server/types/contracts.js";
import { createTempStore } from "../helpers/tempStore.js";

vi.mock("../../server/runner/stepExecution.js", () => ({
  executeStepForPipeline: async (input: { step: PipelineStep; outgoingLinks: PipelineLink[] }) => {
    const isPdfContentExtractor = input.step.id === "step-pdf";
    return {
      status: "success",
      stepExecution: {
        output: `${input.step.name} executed`,
        qualityGateResults: [],
        hasBlockingGateFailure: false,
        shouldStopForInput: false,
        workflowOutcome: isPdfContentExtractor ? "neutral" : "pass",
        outgoingLinks: input.outgoingLinks,
        routedLinks: isPdfContentExtractor ? [] : input.outgoingLinks,
        subagentNotes: []
      }
    };
  }
}));

function createStep(
  id: string,
  name: string,
  role: PipelineStep["role"],
  prompt: string
): PipelineStep {
  return {
    id,
    name,
    role,
    prompt,
    providerId: "claude",
    model: "claude-sonnet-4-6",
    reasoningEffort: "medium",
    fastMode: false,
    use1MContext: false,
    contextWindowTokens: 128_000,
    position: { x: 0, y: 0 },
    contextTemplate: "Task:\n{{task}}",
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

describe("Runner disconnected fallback trigger source", () => {
  it("prefers latest completed incoming step over orchestrator for fallback provenance", async () => {
    const { store, cleanup } = await createTempStore();

    try {
      const pipelineId = "pipeline-fallback-trigger-source";
      const steps: PipelineStep[] = [
        createStep("step-orchestrator", "Pipeline Orchestrator", "orchestrator", "Route the pipeline."),
        createStep("step-pdf", "PDF Content Extractor", "analysis", "Extract PDF content."),
        createStep("step-html", "HTML Builder", "executor", "Build HTML.")
      ];

      const pipeline: Pipeline = {
        ...store.listPipelines()[0],
        id: pipelineId,
        name: "Fallback source preference pipeline",
        steps,
        links: [
          { id: "l1", sourceStepId: "step-orchestrator", targetStepId: "step-pdf", condition: "on_pass" },
          { id: "l2", sourceStepId: "step-pdf", targetStepId: "step-html", condition: "on_pass" }
        ],
        qualityGates: [],
        runtime: {
          maxLoops: 1,
          maxStepExecutions: 10,
          stageTimeoutMs: 180_000
        }
      };

      const run = store.createRun(pipeline, "Fallback source selection");
      await runPipeline({
        store,
        runId: run.id,
        pipeline,
        task: run.task
      });

      const completedRun = store.getRun(run.id);
      expect(completedRun?.status).toBe("completed");
      expect(
        completedRun?.logs.some((line) => line.includes("PDF Content Extractor produced neutral; no conditional route matched"))
      ).toBe(true);

      const htmlStep = completedRun?.steps.find((step) => step.stepId === "step-html");
      expect(htmlStep?.triggeredByReason).toBe("disconnected_fallback");
      expect(htmlStep?.triggeredByStepId).toBe("step-pdf");
    } finally {
      await cleanup();
    }
  });
});
