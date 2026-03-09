import { beforeEach, describe, expect, it, vi } from "vitest";

const apiMocks = vi.hoisted(() => ({
  updatePipeline: vi.fn()
}));

vi.mock("../../src/lib/api.ts", async () => {
  const actual = await vi.importActual<typeof import("../../src/lib/api.ts")>("../../src/lib/api.ts");
  return {
    ...actual,
    updatePipeline: apiMocks.updatePipeline
  };
});

import { handleSavePipelineAction } from "../../src/app/state/controller/actions/selectionActions.ts";
import { selectIsDirty } from "../../src/app/state/appStateSelectors.ts";
import { createDraftStep, defaultRuntime, defaultSchedule, toDraft } from "../../src/lib/pipelineDraft.ts";
import type { Pipeline, PipelinePayload } from "../../src/lib/types.ts";

function buildCanonicalPipeline(id: string, draft: PipelinePayload): Pipeline {
  return {
    id,
    name: draft.name,
    description: draft.description,
    createdAt: "2026-03-06T08:00:00.000Z",
    updatedAt: "2026-03-06T08:00:01.000Z",
    steps: draft.steps.map((step) => ({ ...step })),
    links: draft.links.map((link, index) => ({
      id: link.id ?? `link-${index + 1}`,
      sourceStepId: link.sourceStepId,
      targetStepId: link.targetStepId,
      condition: link.condition ?? "always",
      ...(typeof link.conditionExpression === "string" && link.conditionExpression.trim().length > 0
        ? { conditionExpression: link.conditionExpression.trim() }
        : {})
    })),
    runtime: {
      ...defaultRuntime(),
      ...draft.runtime
    },
    schedule: {
      ...defaultSchedule(),
      ...draft.schedule
    },
    qualityGates: draft.qualityGates.map((gate, index) => ({
      id: gate.id ?? `gate-${index + 1}`,
      name: gate.name,
      targetStepId: gate.targetStepId,
      kind: gate.kind,
      blocking: gate.blocking,
      pattern: gate.pattern ?? "",
      flags: gate.flags ?? "",
      jsonPath: gate.jsonPath ?? "",
      artifactPath: gate.artifactPath ?? "",
      message: gate.message ?? ""
    }))
  };
}

function createSaveContext(generatedDraft: PipelinePayload) {
  return {
    draft: generatedDraft,
    selectPipelineSaveValidationError: vi.fn(() => ""),
    savingPipelineRef: { current: false },
    setSavingPipeline: vi.fn(),
    setPipelines: vi.fn(),
    selectedPipelineId: "pipeline-1",
    draftWorkflowKey: "draft-pipeline-1",
    isNewDraft: false,
    setSelectedPipelineId: vi.fn(),
    setBaselineDraft: vi.fn(),
    setIsNewDraft: vi.fn(),
    setNotice: vi.fn(),
    selectedPipelineIdRef: { current: "pipeline-1" },
    draftWorkflowKeyRef: { current: "draft-pipeline-1" }
  };
}

describe("handleSavePipelineAction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns the canonical saved draft so AI apply flows can settle autosave state", async () => {
    const baseStep = createDraftStep(0);
    const publishStep = createDraftStep(1);
    const generatedDraft: PipelinePayload = {
      name: "AI Regression Flow v1",
      description: "Saved from AI apply.",
      steps: [
        {
          ...baseStep,
          id: "fetch-step",
          name: "Fetch research",
          policyProfileIds: ["deterministic_fetch"]
        },
        {
          ...publishStep,
          id: "publish-step",
          name: "Publish site patch",
          policyProfileIds: ["deterministic_publish"]
        }
      ],
      links: [
        {
          id: "semantic-link",
          sourceStepId: "fetch-step",
          targetStepId: "publish-step",
          condition: "always",
          conditionExpression: "$.has_changes == true"
        }
      ],
      qualityGates: [],
      runtime: undefined,
      schedule: undefined
    };
    const canonicalPipeline = buildCanonicalPipeline("pipeline-1", generatedDraft);
    const expectedSavedDraft = toDraft(canonicalPipeline);
    const ctx = createSaveContext(generatedDraft);

    apiMocks.updatePipeline.mockResolvedValue({ pipeline: canonicalPipeline });

    const result = await handleSavePipelineAction({ draftSnapshot: generatedDraft }, ctx);

    expect(result.saved).toBe(true);
    expect(result.pipelineId).toBe("pipeline-1");
    expect(result.savedDraft).toEqual(expectedSavedDraft);
    expect(result.savedDraft?.links[0]?.conditionExpression).toBe("$.has_changes == true");
    expect(ctx.setBaselineDraft).toHaveBeenCalledWith(expectedSavedDraft);
    expect(selectIsDirty(generatedDraft, expectedSavedDraft)).toBe(true);
    expect(selectIsDirty(expectedSavedDraft, expectedSavedDraft)).toBe(false);
  });
});
