import { describe, expect, it } from "vitest";
import { getOptimisticStartingNodeId } from "../../src/components/dashboard/pipeline-editor/state/editorSelectors.ts";
import type { PipelinePayload, PipelineRun } from "../../src/lib/types.ts";

function createDraft(roles: PipelinePayload["steps"][number]["role"][]): PipelinePayload {
  return {
    name: "Test pipeline",
    description: "",
    steps: roles.map((role, index) => ({
      id: `step-${index + 1}`,
      name: `Step ${index + 1}`,
      role,
      prompt: "",
      providerId: "claude",
      model: "claude-sonnet-4-6",
      reasoningEffort: "medium",
      fastMode: false,
      use1MContext: false,
      contextWindowTokens: 128000,
      position: { x: index * 280, y: 100 },
      contextTemplate: "",
      enableDelegation: false,
      delegationCount: 0,
      enableIsolatedStorage: false,
      enableSharedStorage: true,
      enabledMcpServerIds: [],
      outputFormat: "markdown",
      requiredOutputFields: [],
      requiredOutputFiles: [],
      scenarios: [],
      skipIfArtifacts: []
    })),
    links: [],
    qualityGates: []
  };
}

describe("getOptimisticStartingNodeId", () => {
  it("returns orchestrator node while run is starting and no active run exists", () => {
    const draft = createDraft(["analysis", "orchestrator", "executor"]);

    expect(getOptimisticStartingNodeId(draft, null, true)).toBe("step-2");
  });

  it("falls back to first step when orchestrator is absent", () => {
    const draft = createDraft(["analysis", "executor", "review"]);

    expect(getOptimisticStartingNodeId(draft, null, true)).toBe("step-1");
  });

  it("returns null when active run already exists", () => {
    const draft = createDraft(["orchestrator", "executor"]);
    const activeRun = { id: "run-1", status: "running", steps: [] } as PipelineRun;

    expect(getOptimisticStartingNodeId(draft, activeRun, true)).toBeNull();
  });

  it("returns orchestrator while queued run is waiting for first running step", () => {
    const draft = createDraft(["analysis", "orchestrator", "executor"]);
    const activeRun = {
      id: "run-1",
      status: "queued",
      steps: [
        { stepId: "step-2", role: "orchestrator" },
        { stepId: "step-3", role: "executor" }
      ]
    } as PipelineRun;

    expect(getOptimisticStartingNodeId(draft, activeRun, false)).toBe("step-2");
  });

  it("returns null when start flag is false", () => {
    const draft = createDraft(["orchestrator", "executor"]);

    expect(getOptimisticStartingNodeId(draft, null, false)).toBeNull();
  });
});
