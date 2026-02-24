import { afterEach, describe, expect, it, vi } from "vitest";

import { evaluatePipelineQualityGates, evaluateStepContracts } from "../../server/runner/qualityGates/evaluators.js";
import { parseJsonOutput } from "../../server/runner/qualityGates/normalizers.js";
import type { PipelineQualityGate, PipelineStep } from "../../server/types/contracts.js";

function createReviewStep(): PipelineStep {
  return {
    id: "step-review",
    name: "HTML Reviewer",
    role: "review",
    prompt: "Review output quality.",
    providerId: "claude",
    model: "claude-sonnet-4-6",
    reasoningEffort: "high",
    fastMode: false,
    use1MContext: false,
    contextWindowTokens: 200_000,
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

function createDeliveryStep(): PipelineStep {
  return {
    ...createReviewStep(),
    id: "step-delivery",
    name: "Delivery",
    role: "executor"
  };
}

function createRegexGate(pattern: string): PipelineQualityGate {
  return {
    id: "gate-1",
    name: "Status Gate",
    targetStepId: "step-review",
    kind: "regex_must_match",
    pattern,
    flags: "i",
    blocking: true,
    jsonPath: "",
    artifactPath: "",
    message: ""
  };
}

const storagePaths = {
  sharedStoragePath: "/tmp",
  isolatedStoragePath: "/tmp",
  runStoragePath: "/tmp"
};

describe("Quality gate JSON status contract", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("accepts strict GateResult JSON contract on review steps", async () => {
    const step = createReviewStep();
    const output = JSON.stringify({
      workflow_status: "PASS",
      next_action: "continue",
      summary: "no blocking issues",
      reasons: [{ code: "ok", message: "All checks passed.", severity: "low" }]
    });

    const contract = await evaluateStepContracts(step, output, storagePaths, {});
    const gate = contract.gateResults.find((result) => result.gateName === "Step emits GateResult contract");
    expect(gate?.status).toBe("pass");
    expect(gate?.details).toContain("source=json");
  });

  it("rejects legacy text markers on strict GateResult steps", async () => {
    const step = createReviewStep();
    const output = "HTML_REVIEW_STATUS: PASS\nWORKFLOW_STATUS: PASS";

    const contract = await evaluateStepContracts(step, output, storagePaths, {});
    const gate = contract.gateResults.find((result) => result.gateName === "Step emits GateResult contract");
    expect(gate?.status).toBe("fail");
    expect(gate?.details).toContain("source=legacy_text");
  });

  it("enforces strict GateResult JSON contract for delivery-style steps", async () => {
    const step = createDeliveryStep();
    const output = JSON.stringify({
      workflow_status: "COMPLETE",
      next_action: "stop",
      summary: "Delivery artifacts copied.",
      reasons: [{ code: "delivery_complete", message: "All outputs delivered.", severity: "low" }]
    });

    const contract = await evaluateStepContracts(step, output, storagePaths, {});
    const gate = contract.gateResults.find((result) => result.gateName === "Step emits GateResult contract");
    expect(gate?.status).toBe("pass");
    expect(gate?.details).toContain("source=json");
  });

  it("matches regex status gates from JSON-only outputs via derived status signals", async () => {
    const step = createReviewStep();
    const output = JSON.stringify({
      workflow_status: "PASS",
      html_review_status: "PASS",
      next_action: "continue",
      reasons: [{ code: "ok", message: "All checks passed." }]
    });

    const gates = [
      createRegexGate("HTML_REVIEW_STATUS:\\s*(PASS|FAIL)"),
      createRegexGate("WORKFLOW_STATUS:\\s*(PASS|FAIL|NEUTRAL|COMPLETE)")
    ];

    const results = await evaluatePipelineQualityGates(step, output, parseJsonOutput(output), gates, storagePaths, {});
    expect(results.every((result) => result.status === "pass")).toBe(true);
  });
});
