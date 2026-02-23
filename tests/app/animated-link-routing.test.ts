import { describe, expect, it } from "vitest";
import {
  getAnimatedLinkIds,
  getDebugPreviewDispatchAnimation
} from "../../src/components/dashboard/pipeline-editor/state/editorSelectors.ts";
import { buildPotentialDispatchRouteId } from "../../src/components/dashboard/pipeline-canvas/potentialDispatchRouteId.ts";
import type {
  PipelineEditorCanvasLink,
  PipelineEditorCanvasNode
} from "../../src/components/dashboard/pipeline-editor/types.ts";
import type { PipelineRun, StepRun } from "../../src/lib/types.ts";

function createStepRun(partial: Partial<StepRun> & Pick<StepRun, "stepId" | "stepName" | "role" | "status">): StepRun {
  return {
    attempts: 1,
    workflowOutcome: "neutral",
    inputContext: "",
    output: "",
    subagentNotes: [],
    qualityGateResults: [],
    ...partial
  };
}

function createRun(steps: StepRun[]): PipelineRun {
  return {
    id: "run-1",
    pipelineId: "pipeline-1",
    pipelineName: "Pipeline 1",
    task: "task",
    inputs: {},
    status: "running",
    startedAt: "2026-02-22T00:00:00.000Z",
    logs: [],
    approvals: [],
    steps
  };
}

function createCanvasNode(
  id: string,
  role: PipelineEditorCanvasNode["role"]
): PipelineEditorCanvasNode {
  return {
    id,
    name: id,
    role,
    providerId: "openai",
    model: "gpt-5",
    position: { x: 0, y: 0 }
  };
}

describe("getAnimatedLinkIds", () => {
  it("prefers the explicit runtime trigger source over timestamp heuristics", () => {
    const links: PipelineEditorCanvasLink[] = [
      { id: "a-to-t", sourceStepId: "step-a", targetStepId: "step-t", condition: "always" },
      { id: "b-to-t", sourceStepId: "step-b", targetStepId: "step-t", condition: "always" }
    ];
    const run = createRun([
      createStepRun({
        stepId: "step-a",
        stepName: "A",
        role: "orchestrator",
        status: "completed",
        workflowOutcome: "pass",
        finishedAt: "2026-02-22T00:00:10.000Z"
      }),
      createStepRun({
        stepId: "step-b",
        stepName: "B",
        role: "executor",
        status: "completed",
        workflowOutcome: "pass",
        finishedAt: "2026-02-22T00:00:20.000Z"
      }),
      createStepRun({
        stepId: "step-t",
        stepName: "Target",
        role: "review",
        status: "running",
        triggeredByStepId: "step-a"
      })
    ]);

    expect(getAnimatedLinkIds(run, links)).toEqual(["a-to-t"]);
  });

  it("animates potential orchestrator route when runtime trigger has no direct edge", () => {
    const links: PipelineEditorCanvasLink[] = [
      { id: "b-to-t", sourceStepId: "step-b", targetStepId: "step-t", condition: "always" }
    ];
    const run = createRun([
      createStepRun({
        stepId: "step-a",
        stepName: "A",
        role: "orchestrator",
        status: "completed",
        workflowOutcome: "pass",
        finishedAt: "2026-02-22T00:00:10.000Z"
      }),
      createStepRun({
        stepId: "step-b",
        stepName: "B",
        role: "executor",
        status: "completed",
        workflowOutcome: "pass",
        finishedAt: "2026-02-22T00:00:20.000Z"
      }),
      createStepRun({
        stepId: "step-t",
        stepName: "Target",
        role: "review",
        status: "running",
        triggeredByStepId: "step-a"
      })
    ]);

    expect(getAnimatedLinkIds(run, links)).toEqual(["potential-dispatch:step-a:step-t"]);
  });

  it("prefers a fresh incoming edge over potential orchestrator route for fallback starts", () => {
    const links: PipelineEditorCanvasLink[] = [
      { id: "pdf-to-html", sourceStepId: "step-pdf", targetStepId: "step-html", condition: "on_pass" }
    ];
    const run = createRun([
      createStepRun({
        stepId: "step-a",
        stepName: "Orchestrator",
        role: "orchestrator",
        status: "completed",
        workflowOutcome: "pass",
        finishedAt: "2026-02-22T00:00:10.000Z"
      }),
      createStepRun({
        stepId: "step-pdf",
        stepName: "PDF",
        role: "analysis",
        status: "completed",
        workflowOutcome: "neutral",
        finishedAt: "2026-02-22T00:00:20.000Z"
      }),
      createStepRun({
        stepId: "step-html",
        stepName: "HTML",
        role: "executor",
        status: "running",
        startedAt: "2026-02-22T00:00:20.900Z",
        triggeredByStepId: "step-a"
      })
    ]);

    expect(getAnimatedLinkIds(run, links)).toEqual(["pdf-to-html"]);
  });

  it("keeps potential orchestrator route when the only fresh incoming source was skipped", () => {
    const links: PipelineEditorCanvasLink[] = [
      { id: "design-to-pdf", sourceStepId: "step-design", targetStepId: "step-pdf", condition: "always" }
    ];
    const run = createRun([
      createStepRun({
        stepId: "step-orch",
        stepName: "Orchestrator",
        role: "orchestrator",
        status: "completed",
        workflowOutcome: "pass",
        finishedAt: "2026-02-22T00:00:10.000Z"
      }),
      createStepRun({
        stepId: "step-design",
        stepName: "Design Assets",
        role: "analysis",
        status: "completed",
        workflowOutcome: "neutral",
        finishedAt: "2026-02-22T00:00:20.000Z",
        output: "STEP_STATUS: SKIPPED\nSKIP_REASON: required artifacts already exist"
      }),
      createStepRun({
        stepId: "step-pdf",
        stepName: "PDF",
        role: "analysis",
        status: "running",
        startedAt: "2026-02-22T00:00:20.800Z",
        triggeredByStepId: "step-orch"
      })
    ]);

    expect(getAnimatedLinkIds(run, links)).toEqual(["potential-dispatch:step-orch:step-pdf"]);
  });

  it("walks through skipped trigger source and animates orchestrator dispatch", () => {
    const links: PipelineEditorCanvasLink[] = [
      { id: "orch-to-design", sourceStepId: "step-orch", targetStepId: "step-design", condition: "always" },
      { id: "design-to-pdf", sourceStepId: "step-design", targetStepId: "step-pdf", condition: "always" }
    ];
    const run = createRun([
      createStepRun({
        stepId: "step-orch",
        stepName: "Orchestrator",
        role: "orchestrator",
        status: "completed",
        workflowOutcome: "pass",
        finishedAt: "2026-02-22T00:00:10.000Z"
      }),
      createStepRun({
        stepId: "step-design",
        stepName: "Design Assets",
        role: "analysis",
        status: "completed",
        workflowOutcome: "neutral",
        triggeredByStepId: "step-orch",
        finishedAt: "2026-02-22T00:00:20.000Z",
        output: "STEP_STATUS: SKIPPED\nSKIP_REASON: required artifacts already exist"
      }),
      createStepRun({
        stepId: "step-pdf",
        stepName: "PDF",
        role: "analysis",
        status: "running",
        startedAt: "2026-02-22T00:00:20.800Z",
        triggeredByStepId: "step-design"
      })
    ]);

    expect(getAnimatedLinkIds(run, links)).toEqual(["potential-dispatch:step-orch:step-pdf"]);
  });

  it("uses disconnected fallback reason as authoritative source for orchestrator dispatch", () => {
    const links: PipelineEditorCanvasLink[] = [
      { id: "design-to-pdf", sourceStepId: "step-design", targetStepId: "step-pdf", condition: "always" }
    ];
    const run = createRun([
      createStepRun({
        stepId: "step-orch",
        stepName: "Orchestrator",
        role: "orchestrator",
        status: "completed",
        workflowOutcome: "pass",
        finishedAt: "2026-02-22T00:00:10.000Z"
      }),
      createStepRun({
        stepId: "step-design",
        stepName: "Design Assets",
        role: "analysis",
        status: "completed",
        workflowOutcome: "pass",
        finishedAt: "2026-02-22T00:00:20.000Z"
      }),
      createStepRun({
        stepId: "step-pdf",
        stepName: "PDF",
        role: "analysis",
        status: "running",
        startedAt: "2026-02-22T00:00:20.800Z",
        triggeredByStepId: "step-orch",
        triggeredByReason: "disconnected_fallback"
      })
    ]);

    expect(getAnimatedLinkIds(run, links)).toEqual(["potential-dispatch:step-orch:step-pdf"]);
  });

  it("does not invent potential route when non-orchestrator triggered without direct edge", () => {
    const links: PipelineEditorCanvasLink[] = [
      { id: "a-to-t", sourceStepId: "step-a", targetStepId: "step-t", condition: "always" }
    ];
    const run = createRun([
      createStepRun({
        stepId: "step-b",
        stepName: "B",
        role: "executor",
        status: "completed",
        workflowOutcome: "pass",
        finishedAt: "2026-02-22T00:00:20.000Z"
      }),
      createStepRun({
        stepId: "step-t",
        stepName: "Target",
        role: "review",
        status: "running",
        triggeredByStepId: "step-b"
      })
    ]);

    expect(getAnimatedLinkIds(run, links)).toEqual([]);
  });

  it("keeps legacy timestamp-based behavior when runtime trigger is absent", () => {
    const links: PipelineEditorCanvasLink[] = [
      { id: "a-to-t", sourceStepId: "step-a", targetStepId: "step-t", condition: "always" },
      { id: "b-to-t", sourceStepId: "step-b", targetStepId: "step-t", condition: "always" }
    ];
    const run = createRun([
      createStepRun({
        stepId: "step-a",
        stepName: "A",
        role: "analysis",
        status: "completed",
        workflowOutcome: "pass",
        finishedAt: "2026-02-22T00:00:10.000Z"
      }),
      createStepRun({
        stepId: "step-b",
        stepName: "B",
        role: "executor",
        status: "completed",
        workflowOutcome: "pass",
        finishedAt: "2026-02-22T00:00:20.000Z"
      }),
      createStepRun({
        stepId: "step-t",
        stepName: "Target",
        role: "review",
        status: "running"
      })
    ]);

    expect(getAnimatedLinkIds(run, links)).toEqual(["b-to-t"]);
  });
});

describe("getDebugPreviewDispatchAnimation", () => {
  it("returns route + node ids for a valid orchestrator dispatch preview", () => {
    const canvasNodes: PipelineEditorCanvasNode[] = [
      createCanvasNode("orch", "orchestrator"),
      createCanvasNode("worker", "executor")
    ];
    const routeId = buildPotentialDispatchRouteId("orch", "worker");

    expect(getDebugPreviewDispatchAnimation(routeId, canvasNodes)).toEqual({
      routeId,
      nodeIds: ["orch", "worker"]
    });
  });

  it("returns no preview animation for invalid source/target roles", () => {
    const canvasNodes: PipelineEditorCanvasNode[] = [
      createCanvasNode("analysis", "analysis"),
      createCanvasNode("orch-2", "orchestrator")
    ];
    const routeId = buildPotentialDispatchRouteId("analysis", "orch-2");

    expect(getDebugPreviewDispatchAnimation(routeId, canvasNodes)).toEqual({
      routeId: null,
      nodeIds: []
    });
  });
});
