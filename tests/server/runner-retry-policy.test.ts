import { describe, expect, it } from "vitest";

import {
  createStepRetryState,
  dequeueNextStep,
  enqueueStepForExecution,
  findNextUnvisitedStep,
  markStepExecutionSettled,
  recordStepAttempt
} from "../../server/runner/retryPolicy.js";
import type { PipelineStep } from "../../server/types/contracts.js";

function createStep(id: string): PipelineStep {
  return {
    id,
    name: id,
    role: "orchestrator",
    prompt: "prompt",
    providerId: "claude",
    model: "claude-opus-4-1",
    reasoningEffort: "medium",
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

describe("Runner Retry Policy", () => {
  it("does not treat in-flight steps as disconnected fallback candidates", () => {
    const state = createStepRetryState(1);
    const first = createStep("first");
    const second = createStep("second");
    const stepById = new Map<string, PipelineStep>([
      [first.id, first],
      [second.id, second]
    ]);

    expect(enqueueStepForExecution(state, stepById, () => {}, first.id, "entry step")).toBe(true);
    const firstQueued = dequeueNextStep(state);
    expect(firstQueued?.stepId).toBe(first.id);
    expect(firstQueued?.queuedByReason).toBe("route");

    const fallback = findNextUnvisitedStep([first, second], state);
    expect(fallback?.id).toBe(second.id);
  });

  it("keeps completed steps out of disconnected fallback selection", () => {
    const state = createStepRetryState(1);
    const step = createStep("orchestrator");
    const stepById = new Map<string, PipelineStep>([[step.id, step]]);

    expect(enqueueStepForExecution(state, stepById, () => {}, step.id, "entry step")).toBe(true);
    const queued = dequeueNextStep(state);
    expect(queued?.stepId).toBe(step.id);
    expect(queued?.queuedByReason).toBe("route");

    markStepExecutionSettled(state, step.id);
    recordStepAttempt(state, step.id, 1);

    expect(findNextUnvisitedStep([step], state)).toBeUndefined();
  });

  it("updates queued source when a queued step is re-enqueued by another step", () => {
    const state = createStepRetryState(1);
    const orchestrator = createStep("orchestrator");
    const worker = createStep("worker");
    const stepById = new Map<string, PipelineStep>([
      [orchestrator.id, orchestrator],
      [worker.id, worker]
    ]);

    expect(
      enqueueStepForExecution(state, stepById, () => {}, worker.id, "initial queue", "first-source")
    ).toBe(true);
    expect(
      enqueueStepForExecution(state, stepById, () => {}, worker.id, "re-queue by orchestrator", orchestrator.id)
    ).toBe(false);

    const queued = dequeueNextStep(state);
    expect(queued?.stepId).toBe(worker.id);
    expect(queued?.queuedByStepId).toBe(orchestrator.id);
    expect(queued?.queuedByReason).toBe("route");
  });

  it("tracks disconnected fallback enqueue reason", () => {
    const state = createStepRetryState(1);
    const orchestrator = createStep("orchestrator");
    const worker = createStep("worker");
    const stepById = new Map<string, PipelineStep>([
      [orchestrator.id, orchestrator],
      [worker.id, worker]
    ]);

    expect(
      enqueueStepForExecution(
        state,
        stepById,
        () => {},
        worker.id,
        "disconnected fallback",
        orchestrator.id,
        "disconnected_fallback"
      )
    ).toBe(true);

    const queued = dequeueNextStep(state);
    expect(queued?.stepId).toBe(worker.id);
    expect(queued?.queuedByStepId).toBe(orchestrator.id);
    expect(queued?.queuedByReason).toBe("disconnected_fallback");
  });
});
