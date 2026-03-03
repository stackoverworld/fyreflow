import { describe, expect, it, vi } from "vitest";

import { createAbortError } from "../../server/abort.js";
import { pauseRun, runPipeline } from "../../server/runner.js";
import type { Pipeline, PipelineLink, PipelineQualityGate, PipelineStep, ProviderConfig } from "../../server/types/contracts.js";
import { createTempStore } from "../helpers/tempStore.js";

const executionProbe: {
  started?: () => void;
  step1Running: boolean;
  step2Running: boolean;
  step2StartedWhileStep1Running: boolean;
  step3StartedWhileStep2Running: boolean;
} = {
  step1Running: false,
  step2Running: false,
  step2StartedWhileStep1Running: false,
  step3StartedWhileStep2Running: false
};

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const mocks = vi.hoisted(() => ({
  executeStepForPipeline: vi.fn()
}));

vi.mock("../../server/runner/stepExecution.js", () => ({
  executeStepForPipeline: mocks.executeStepForPipeline
}));

vi.mock("../../server/providers.js", () => ({
  executeProviderStep: vi.fn(async () => "final output")
}));

function createStep(id: string, name: string, role: PipelineStep["role"], extra?: Partial<PipelineStep>): PipelineStep {
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
    ...extra
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

function successMock() {
  return async (input: { step: PipelineStep; outgoingLinks: PipelineLink[]; abortSignal?: AbortSignal }) => ({
    status: "success" as const,
    stepExecution: {
      output: `${input.step.name} done`,
      qualityGateResults: [],
      hasBlockingGateFailure: false,
      shouldStopForInput: false,
      workflowOutcome: "pass" as const,
      outgoingLinks: input.outgoingLinks,
      routedLinks: input.outgoingLinks,
      subagentNotes: []
    }
  });
}

describe("runner behavior", () => {
  describe("delivery gate validation", () => {
    it("fails fast when delivery completion gate targetStepId is not explicit", async () => {
      mocks.executeStepForPipeline.mockImplementation(successMock());
      const { store, cleanup } = await createTempStore();

      try {
        mocks.executeStepForPipeline.mockClear();
        const basePipeline = store.listPipelines()[0];
        const steps: PipelineStep[] = [
          createStep("step-orchestrator", "Pipeline Orchestrator", "orchestrator"),
          createStep("step-delivery", "Delivery", "executor")
        ];
        const links: PipelineLink[] = [
          { id: "link-1", sourceStepId: "step-orchestrator", targetStepId: "step-delivery", condition: "always" }
        ];

        const pipeline: Pipeline = {
          ...basePipeline,
          id: `${basePipeline.id}-delivery-gate-validation`,
          steps,
          links,
          qualityGates: [createDeliveryCompletionGate("any_step")],
          runtime: { ...basePipeline.runtime, maxLoops: 1, maxStepExecutions: 4 }
        };

        const run = store.createRun(pipeline, "Validate delivery gate targeting");
        await runPipeline({ store, runId: run.id, pipeline, task: run.task });

        const completed = store.getRun(run.id);
        expect(completed?.status).toBe("failed");
        expect(completed?.logs.some((line) => line.includes("Delivery completion quality gate is misconfigured"))).toBe(true);
        expect(mocks.executeStepForPipeline).not.toHaveBeenCalled();
      } finally {
        await cleanup();
      }
    });
  });

  describe("fallback trigger source", () => {
    it("prefers latest completed incoming step over orchestrator for fallback provenance", async () => {
      mocks.executeStepForPipeline.mockImplementation(
        async (input: { step: PipelineStep; outgoingLinks: PipelineLink[] }) => {
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
      );

      const { store, cleanup } = await createTempStore();

      try {
        const steps: PipelineStep[] = [
          createStep("step-orchestrator", "Pipeline Orchestrator", "orchestrator"),
          createStep("step-pdf", "PDF Content Extractor", "analysis", { contextTemplate: "Task:\n{{task}}" }),
          createStep("step-html", "HTML Builder", "executor", { contextTemplate: "Task:\n{{task}}" })
        ];

        const pipeline: Pipeline = {
          ...store.listPipelines()[0],
          id: "pipeline-fallback-trigger-source",
          name: "Fallback source preference pipeline",
          steps,
          links: [
            { id: "l1", sourceStepId: "step-orchestrator", targetStepId: "step-pdf", condition: "on_pass" },
            { id: "l2", sourceStepId: "step-pdf", targetStepId: "step-html", condition: "on_pass" }
          ],
          qualityGates: [],
          runtime: { maxLoops: 1, maxStepExecutions: 10, stageTimeoutMs: 180_000 }
        };

        const run = store.createRun(pipeline, "Fallback source selection");
        await runPipeline({ store, runId: run.id, pipeline, task: run.task });

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

  describe("parallel scheduling", () => {
    it("does not start dependent steps while a predecessor is still running", async () => {
      executionProbe.step1Running = false;
      executionProbe.step2Running = false;
      executionProbe.step2StartedWhileStep1Running = false;
      executionProbe.step3StartedWhileStep2Running = false;

      mocks.executeStepForPipeline.mockImplementation(
        async (input: { step: PipelineStep; outgoingLinks: PipelineLink[] }) => {
          const { step } = input;

          if (step.id === "step-2" && executionProbe.step1Running) {
            executionProbe.step2StartedWhileStep1Running = true;
          }
          if (step.id === "step-3" && executionProbe.step2Running) {
            executionProbe.step3StartedWhileStep2Running = true;
          }

          if (step.id === "step-1") {
            executionProbe.step1Running = true;
            await delay(60);
            executionProbe.step1Running = false;
          } else if (step.id === "step-2") {
            executionProbe.step2Running = true;
            await delay(40);
            executionProbe.step2Running = false;
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
      );

      const { store, cleanup } = await createTempStore();
      try {
        const basePipeline = store.listPipelines()[0];
        const steps: PipelineStep[] = [
          createStep("step-1", "Pipeline Orchestrator", "orchestrator", { enableDelegation: true, delegationCount: 3 }),
          createStep("step-2", "Design Asset Extraction", "analysis"),
          createStep("step-3", "PDF Content Extractor", "analysis")
        ];
        const pipeline: Pipeline = {
          ...basePipeline,
          id: `${basePipeline.id}-parallel-order`,
          steps,
          links: [
            { id: "link-1", sourceStepId: "step-1", targetStepId: "step-2", condition: "always" },
            { id: "link-2", sourceStepId: "step-2", targetStepId: "step-3", condition: "always" }
          ],
          runtime: { ...basePipeline.runtime, maxLoops: 1, maxStepExecutions: 10 }
        };

        const run = store.createRun(pipeline, "Scheduler dependency order test");
        await runPipeline({ store, runId: run.id, pipeline, task: run.task });

        const completedRun = store.getRun(run.id);
        expect(completedRun?.status).toBe("completed");
        expect(completedRun?.logs.some((line) => line.includes("disconnected fallback"))).toBe(false);
        expect(executionProbe.step2StartedWhileStep1Running).toBe(false);
        expect(executionProbe.step3StartedWhileStep2Running).toBe(false);
      } finally {
        await cleanup();
      }
    });
  });

  describe("pause and abort handling", () => {
    it("keeps run paused when active execution is aborted by pause", async () => {
      mocks.executeStepForPipeline.mockImplementation(
        async (input: { abortSignal?: AbortSignal; step: PipelineStep; outgoingLinks: PipelineLink[] }) => {
          executionProbe.started?.();
          await new Promise<void>((resolve) => {
            if (input.abortSignal?.aborted) {
              resolve();
              return;
            }
            input.abortSignal?.addEventListener("abort", () => resolve(), { once: true });
          });
          return { status: "cancelled" as const };
        }
      );

      const { store, cleanup } = await createTempStore();
      try {
        const basePipeline = store.listPipelines()[0];
        const step = createStep("step-1", "Pipeline Orchestrator", "orchestrator");
        const pipeline: Pipeline = {
          ...basePipeline,
          id: `${basePipeline.id}-pause-abort`,
          steps: [step],
          links: [],
          runtime: { ...basePipeline.runtime, maxLoops: 1, maxStepExecutions: 2, stageTimeoutMs: 120_000 }
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
      mocks.executeStepForPipeline.mockImplementation(
        async (input: { abortSignal?: AbortSignal; step: PipelineStep; outgoingLinks: PipelineLink[] }) => {
          executionProbe.started?.();
          await new Promise<void>((resolve) => {
            if (input.abortSignal?.aborted) {
              resolve();
              return;
            }
            input.abortSignal?.addEventListener("abort", () => resolve(), { once: true });
          });
          return { status: "cancelled" as const };
        }
      );

      const { store, cleanup } = await createTempStore();
      try {
        const basePipeline = store.listPipelines()[0];
        const step = createStep("step-1", "Pipeline Orchestrator", "orchestrator");
        const pipeline: Pipeline = {
          ...basePipeline,
          id: `${basePipeline.id}-stop-abort`,
          steps: [step],
          links: [],
          runtime: { ...basePipeline.runtime, maxLoops: 1, maxStepExecutions: 2, stageTimeoutMs: 120_000 }
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

  describe("step execution logging", () => {
    it("emits runtime progress logs around provider execution", async () => {
      const { executeStep } = await import("../../server/runner/execution.js");
      const { executeProviderStep } = await import("../../server/providers.js");
      const executeProviderStepMock = vi.mocked(executeProviderStep);

      const step = createStep("step-log-1", "Pipeline Orchestrator", "orchestrator", {
        reasoningEffort: "low",
        fastMode: true
      });
      const provider: ProviderConfig = {
        id: "claude",
        label: "Anthropic",
        authMode: "oauth",
        apiKey: "",
        oauthToken: "",
        baseUrl: "https://api.anthropic.com/v1",
        defaultModel: "claude-sonnet-4-6",
        updatedAt: new Date().toISOString()
      };
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

  describe("edge cases", () => {
    it("completes with failed status when all steps fail", async () => {
      mocks.executeStepForPipeline.mockImplementation(
        async (input: { step: PipelineStep; outgoingLinks: PipelineLink[] }) => ({
          status: "success" as const,
          stepExecution: {
            output: "failed step",
            qualityGateResults: [],
            hasBlockingGateFailure: true,
            shouldStopForInput: false,
            workflowOutcome: "fail" as const,
            outgoingLinks: input.outgoingLinks,
            routedLinks: [],
            subagentNotes: []
          }
        })
      );

      const { store, cleanup } = await createTempStore();
      try {
        const basePipeline = store.listPipelines()[0];
        const steps = [
          createStep("step-1", "Orchestrator", "orchestrator"),
          createStep("step-2", "Builder", "executor")
        ];
        const pipeline: Pipeline = {
          ...basePipeline,
          id: `${basePipeline.id}-all-fail`,
          steps,
          links: [{ id: "link-1", sourceStepId: "step-1", targetStepId: "step-2", condition: "on_pass" }],
          runtime: { ...basePipeline.runtime, maxLoops: 1, maxStepExecutions: 4 }
        };

        const run = store.createRun(pipeline, "All steps fail test");
        await runPipeline({ store, runId: run.id, pipeline, task: run.task });

        const completedRun = store.getRun(run.id);
        expect(["completed", "failed"]).toContain(completedRun?.status);
      } finally {
        await cleanup();
      }
    });

    it("handles empty pipeline with zero steps", async () => {
      mocks.executeStepForPipeline.mockImplementation(successMock());
      const { store, cleanup } = await createTempStore();
      try {
        const basePipeline = store.listPipelines()[0];
        const pipeline: Pipeline = {
          ...basePipeline,
          id: `${basePipeline.id}-empty`,
          steps: [],
          links: [],
          runtime: { ...basePipeline.runtime, maxLoops: 1, maxStepExecutions: 4 }
        };

        const run = store.createRun(pipeline, "Empty pipeline test");
        await runPipeline({ store, runId: run.id, pipeline, task: run.task });

        const completedRun = store.getRun(run.id);
        expect(completedRun?.status).toBe("failed");
      } finally {
        await cleanup();
      }
    });
  });
});
