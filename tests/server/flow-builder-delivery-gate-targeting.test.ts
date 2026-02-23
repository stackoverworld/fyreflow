import { describe, expect, it } from "vitest";
import { buildQualityGates } from "../../server/flowBuilder/draftMapping/mappers.js";
import type { DraftQualityGateSpec, DraftStepRecord } from "../../server/flowBuilder/draftMapping/contracts.js";

function createStep(id: string, name: string): DraftStepRecord {
  return {
    id,
    name,
    role: "executor",
    prompt: "prompt",
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

describe("buildQualityGates delivery completion target fallback", () => {
  it("maps delivery completion gate with unknown target to delivery step instead of any_step", () => {
    const stepRecords: DraftStepRecord[] = [
      createStep("step-1", "Pipeline Orchestrator"),
      createStep("step-2", "HTML Reviewer"),
      createStep("step-3", "Delivery")
    ];
    const qualityGates: DraftQualityGateSpec[] = [
      {
        name: "Delivery Completion Gate",
        target: "Missing Step Name",
        kind: "regex_must_match",
        pattern: "WORKFLOW_STATUS:\\s*COMPLETE",
        blocking: true
      }
    ];

    const built = buildQualityGates({ qualityGates }, stepRecords);
    expect(built[0]?.targetStepId).toBe("step-3");
  });
});
