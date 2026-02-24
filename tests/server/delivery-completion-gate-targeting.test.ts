import { describe, expect, it } from "vitest";
import type { PipelineLink, PipelineQualityGate, PipelineStep } from "../../server/types/contracts.js";
import { validateDeliveryCompletionGateTargets } from "../../server/runner/qualityGateTargeting.js";

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

describe("validateDeliveryCompletionGateTargets", () => {
  it("flags any_step target for COMPLETE workflow gates", () => {
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

    const issues = validateDeliveryCompletionGateTargets(gates, steps, links);
    expect(issues).toHaveLength(1);
    expect(issues[0]?.gateId).toBe("delivery-complete");
    expect(issues[0]?.targetStepId).toBe("any_step");
    expect(issues[0]?.expectedStepId).toBe("step-delivery");
  });

  it("ignores non-COMPLETE workflow regex gates", () => {
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

    const issues = validateDeliveryCompletionGateTargets(gates, steps, links);
    expect(issues).toHaveLength(0);
  });

  it("flags COMPLETE gate targeting a non-terminal step", () => {
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

    const issues = validateDeliveryCompletionGateTargets(gates, steps, links);
    expect(issues).toHaveLength(1);
    expect(issues[0]?.gateId).toBe("delivery-complete-misconfigured");
    expect(issues[0]?.targetStepId).toBe("step-review");
    expect(issues[0]?.expectedStepId).toBe("step-delivery");
  });

  it("accepts explicit terminal delivery target", () => {
    const steps = [
      createStep("step-orchestrator", "Pipeline Orchestrator"),
      createStep("step-review", "Reviewer"),
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
        targetStepId: "step-delivery",
        pattern: "WORKFLOW_STATUS:\\s*COMPLETE"
      })
    ];

    const issues = validateDeliveryCompletionGateTargets(gates, steps, links);
    expect(issues).toHaveLength(0);
  });

  it("flags COMPLETE gate targeting a missing step id", () => {
    const steps = [createStep("step-a", "A"), createStep("step-b", "B")];
    const links: PipelineLink[] = [{ id: "l1", sourceStepId: "step-a", targetStepId: "step-b", condition: "always" }];
    const gates = [
      createGate({
        id: "delivery-complete-missing",
        name: "Delivery Completion Gate",
        targetStepId: "step-missing",
        pattern: "WORKFLOW_STATUS:\\s*COMPLETE"
      })
    ];

    const issues = validateDeliveryCompletionGateTargets(gates, steps, links);
    expect(issues).toHaveLength(1);
    expect(issues[0]?.gateId).toBe("delivery-complete-missing");
    expect(issues[0]?.targetStepId).toBe("step-missing");
    expect(issues[0]?.reason).toContain("not present");
  });
});
