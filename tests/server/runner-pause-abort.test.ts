import { describe, expect, it, vi } from "vitest";

import { createAbortError } from "../../server/abort.js";
import { pauseRun, runPipeline } from "../../server/runner.js";
import type { Pipeline, PipelineLink, PipelineStep } from "../../server/types/contracts.js";
import { createTempStore } from "../helpers/tempStore.js";

const executionProbe: {
  started?: () => void;
} = {};

vi.mock("../../server/runner/stepExecution.js", () => ({
  executeStepForPipeline: async (input: { abortSignal?: AbortSignal; step: PipelineStep; outgoingLinks: PipelineLink[] }) => {
    executionProbe.started?.();
    await new Promise<void>((resolve) => {
      if (input.abortSignal?.aborted) {
        resolve();
        return;
      }
      input.abortSignal?.addEventListener("abort", () => resolve(), { once: true });
    });

    return {
      status: "cancelled" as const
    };
  }
}));

function createStep(id: string, name: string): PipelineStep {
  return {
    id,
    name,
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
    skipIfArtifacts: []
  };
}

describe("Runner pause abort handling", () => {
  it("keeps run paused when active execution is aborted by pause", async () => {
    const { store, cleanup } = await createTempStore();
    try {
      const basePipeline = store.listPipelines()[0];
      const step = createStep("step-1", "Pipeline Orchestrator");
      const pipeline: Pipeline = {
        ...basePipeline,
        id: `${basePipeline.id}-pause-abort`,
        steps: [step],
        links: [],
        runtime: {
          ...basePipeline.runtime,
          maxLoops: 1,
          maxStepExecutions: 2,
          stageTimeoutMs: 120_000
        }
      };

      const run = store.createRun(pipeline, "Pause abort test");
      const abortController = new AbortController();
      const stepStarted = new Promise<void>((resolve) => {
        executionProbe.started = resolve;
      });

      const runPromise = runPipeline({
        store,
        runId: run.id,
        pipeline,
        task: run.task,
        abortSignal: abortController.signal
      });

      await stepStarted;
      expect(pauseRun(store, run.id)).toBe(true);
      abortController.abort(createAbortError("Paused by user"));
      await runPromise;

      const updated = store.getRun(run.id);
      expect(updated?.status).toBe("paused");
      expect(updated?.logs.some((line) => line.includes("Run paused"))).toBe(true);
      expect(updated?.logs.some((line) => line.includes("Run stopped"))).toBe(false);
      const stepState = updated?.steps.find((entry) => entry.stepId === step.id);
      expect(stepState?.status).toBe("pending");
      expect(stepState?.attempts).toBe(1);
    } finally {
      executionProbe.started = undefined;
      await cleanup();
    }
  });

  it("cancels run when execution is aborted without pause", async () => {
    const { store, cleanup } = await createTempStore();
    try {
      const basePipeline = store.listPipelines()[0];
      const step = createStep("step-1", "Pipeline Orchestrator");
      const pipeline: Pipeline = {
        ...basePipeline,
        id: `${basePipeline.id}-stop-abort`,
        steps: [step],
        links: [],
        runtime: {
          ...basePipeline.runtime,
          maxLoops: 1,
          maxStepExecutions: 2,
          stageTimeoutMs: 120_000
        }
      };

      const run = store.createRun(pipeline, "Stop abort test");
      const abortController = new AbortController();
      const stepStarted = new Promise<void>((resolve) => {
        executionProbe.started = resolve;
      });

      const runPromise = runPipeline({
        store,
        runId: run.id,
        pipeline,
        task: run.task,
        abortSignal: abortController.signal
      });

      await stepStarted;
      abortController.abort(createAbortError("Stopped by user"));
      await runPromise;

      const updated = store.getRun(run.id);
      expect(updated?.status).toBe("cancelled");
      expect(updated?.logs.some((line) => line.includes("Run stopped: Stopped by user"))).toBe(true);
    } finally {
      executionProbe.started = undefined;
      await cleanup();
    }
  });
});
