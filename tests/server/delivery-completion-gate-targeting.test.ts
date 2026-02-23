import { describe, expect, it } from "vitest";
import type { PipelineLink, PipelineQualityGate, PipelineStep } from "../../server/types/contracts.js";
import { retargetDeliveryCompletionGates } from "../../server/runner/qualityGateTargeting.js";

function createStep(id: string, name: string, role: PipelineStep["role"] = "executor"): PipelineStep {
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

function createGate(partial: Partial<PipelineQualityGate>): PipelineQualityGate {
  return {
    id: partial.id ?? "gate-1",
    name: partial.name ?? "Gate",
    targetStepId: partial.targetStepId ?? "any_step",
    kind: partial.kind ?? "regex_must_match",
    blocking: partial.blocking ?? true,
    pattern: partial.pattern ?? "",
    flags: partial.flags ?? "",
    jsonPath: partial.jsonPath ?? "",
    artifactPath: partial.artifactPath ?? "",
    message: partial.message ?? ""
  };
}

describe("retargetDeliveryCompletionGates", () => {
  it("retargets COMPLETE workflow gate from any_step to terminal delivery step", () => {
    const steps = [
      createStep("step-orchestrator", "Pipeline Orchestrator"),
      createStep("step-review", "HTML Reviewer"),
      createStep("step-delivery", "Delivery")
    ];
    const links: PipelineLink[] = [
      { id: "l1", sourceStepId: "step-orchestrator", targetStepId: "step-review", condition: "always" },
      { id: "l2", sourceStepId: "step-review", targetStepId: "step-delivery", condition: "always" }
    ];
    const gates = [
      createGate({
        id: "delivery-complete",
        name: "Delivery Completion Gate",
        targetStepId: "any_step",
        pattern: "WORKFLOW_STATUS:\\s*COMPLETE"
      }),
      createGate({
        id: "review-status",
        name: "Review Status Gate",
        targetStepId: "step-review",
        pattern: "WORKFLOW_STATUS\\s*:\\s*(PASS|FAIL)"
      })
    ];

    const retargeted = retargetDeliveryCompletionGates(gates, steps, links);

    expect(retargeted.find((gate) => gate.id === "delivery-complete")?.targetStepId).toBe("step-delivery");
    expect(retargeted.find((gate) => gate.id === "review-status")?.targetStepId).toBe("step-review");
  });

  it("does not retarget non-COMPLETE any_step workflow gates", () => {
    const steps = [createStep("step-a", "A"), createStep("step-b", "B")];
    const links: PipelineLink[] = [{ id: "l1", sourceStepId: "step-a", targetStepId: "step-b", condition: "always" }];
    const gates = [
      createGate({
        id: "status-gate",
        name: "General Status Gate",
        targetStepId: "any_step",
        pattern: "WORKFLOW_STATUS\\s*:\\s*(PASS|FAIL|NEUTRAL)"
      })
    ];

    const retargeted = retargetDeliveryCompletionGates(gates, steps, links);
    expect(retargeted[0]?.targetStepId).toBe("any_step");
  });

  it("retargets misconfigured COMPLETE gate from non-delivery step to delivery step", () => {
    const steps = [
      createStep("step-orchestrator", "Pipeline Orchestrator"),
      createStep("step-review", "PDF Reviewer"),
      createStep("step-delivery", "Delivery")
    ];
    const links: PipelineLink[] = [
      { id: "l1", sourceStepId: "step-orchestrator", targetStepId: "step-review", condition: "always" },
      { id: "l2", sourceStepId: "step-review", targetStepId: "step-delivery", condition: "on_pass" }
    ];
    const gates = [
      createGate({
        id: "delivery-complete-misconfigured",
        name: "Delivery Completion Gate",
        targetStepId: "step-review",
        pattern: "WORKFLOW_STATUS:\\s*COMPLETE"
      })
    ];

    const retargeted = retargetDeliveryCompletionGates(gates, steps, links);
    expect(retargeted[0]?.targetStepId).toBe("step-delivery");
  });

  it("targets terminal step when no terminal executor exists", () => {
    const steps = [
      createStep("step-plan", "Planner", "planner"),
      createStep("step-build", "Builder", "executor"),
      createStep("step-review", "Reviewer", "review")
    ];
    const links: PipelineLink[] = [
      { id: "l1", sourceStepId: "step-plan", targetStepId: "step-build", condition: "always" },
      { id: "l2", sourceStepId: "step-build", targetStepId: "step-review", condition: "always" }
    ];
    const gates = [
      createGate({
        id: "delivery-complete",
        name: "Delivery Completion Gate",
        targetStepId: "any_step",
        pattern: "WORKFLOW_STATUS:\\s*COMPLETE"
      })
    ];

    const retargeted = retargetDeliveryCompletionGates(gates, steps, links);
    expect(retargeted[0]?.targetStepId).toBe("step-review");
  });

  it("does not retarget regex gates that are not workflow COMPLETE checks", () => {
    const steps = [createStep("step-a", "A"), createStep("step-b", "B")];
    const links: PipelineLink[] = [{ id: "l1", sourceStepId: "step-a", targetStepId: "step-b", condition: "always" }];
    const gates = [
      createGate({
        id: "delivery-label-only",
        name: "Delivery Completion Gate",
        targetStepId: "any_step",
        pattern: "HTML_REVIEW_STATUS:\\s*(PASS|FAIL)"
      })
    ];

    const retargeted = retargetDeliveryCompletionGates(gates, steps, links);
    expect(retargeted[0]?.targetStepId).toBe("any_step");
  });
});
