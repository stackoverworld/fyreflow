import { afterEach, describe, expect, it, vi } from "vitest";
import type { PipelineQualityGate, PipelineStep } from "../../server/types/contracts.js";
import { evaluatePipelineQualityGates } from "../../server/runner/qualityGates/evaluators.js";
import { inferWorkflowOutcome, normalizeStatusMarkers } from "../../server/runner/qualityGates/normalizers.js";

function createStep(): PipelineStep {
  return {
    id: "html-review-step",
    name: "HTML Reviewer",
    role: "review",
    prompt: "prompt",
    providerId: "claude",
    model: "claude-opus-4-6",
    reasoningEffort: "high",
    fastMode: false,
    use1MContext: false,
    contextWindowTokens: 272_000,
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

function createRegexGate(id: string, name: string, pattern: string): PipelineQualityGate {
  return {
    id,
    name,
    targetStepId: "html-review-step",
    kind: "regex_must_match",
    blocking: true,
    pattern,
    flags: "i",
    jsonPath: "",
    artifactPath: "",
    message: ""
  };
}

describe("status marker normalization", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("normalizes markdown-decorated status markers", () => {
    const output = "HTML_REVIEW_STATUS: **PASS**\nWORKFLOW_STATUS: **PASS**";
    const normalized = normalizeStatusMarkers(output);

    expect(normalized).toContain("HTML_REVIEW_STATUS: PASS");
    expect(normalized).toContain("WORKFLOW_STATUS: PASS");
    expect(inferWorkflowOutcome(output)).toBe("pass");
  });

  it("allows regex quality gates to pass when status value is wrapped with markdown markers", async () => {
    const output = [
      "## Review",
      "HTML_REVIEW_STATUS: **PASS**",
      "WORKFLOW_STATUS: **PASS**"
    ].join("\n");

    const gates = [
      createRegexGate("gate-html", "HTML Review Gate", "HTML_REVIEW_STATUS:\\s*(PASS|FAIL)"),
      createRegexGate("gate-workflow", "Workflow Gate", "WORKFLOW_STATUS\\s*:\\s*(PASS|FAIL|NEUTRAL)")
    ];

    const results = await evaluatePipelineQualityGates(
      createStep(),
      output,
      null,
      gates,
      {
        sharedStoragePath: "",
        isolatedStoragePath: "",
        runStoragePath: ""
      },
      {}
    );

    expect(results).toHaveLength(2);
    expect(results.every((result) => result.status === "pass")).toBe(true);
  });

  it("treats WORKFLOW_STATUS: COMPLETE as pass for legacy workflow-status regex gates", async () => {
    const output = [
      "## PDF Review",
      "PDF_REVIEW_STATUS: PASS",
      "WORKFLOW_STATUS: COMPLETE"
    ].join("\n");

    const gates = [createRegexGate("gate-workflow", "Workflow Gate", "WORKFLOW_STATUS\\s*:\\s*(PASS|FAIL|NEUTRAL)")];

    const results = await evaluatePipelineQualityGates(
      createStep(),
      output,
      null,
      gates,
      {
        sharedStoragePath: "",
        isolatedStoragePath: "",
        runStoragePath: ""
      },
      {}
    );

    expect(results).toHaveLength(1);
    expect(results[0]?.status).toBe("pass");
    expect(inferWorkflowOutcome(output)).toBe("pass");
  });

  it("evaluates regex quality gates by default", async () => {
    const output = "WORKFLOW_STATUS: FAIL";
    const gates = [createRegexGate("gate-workflow", "Workflow Gate", "WORKFLOW_STATUS\\s*:\\s*PASS")];

    const results = await evaluatePipelineQualityGates(
      createStep(),
      output,
      null,
      gates,
      {
        sharedStoragePath: "",
        isolatedStoragePath: "",
        runStoragePath: ""
      },
      {}
    );

    expect(results).toHaveLength(1);
    expect(results[0]?.status).toBe("fail");
  });

  it("allows disabling legacy regex gate evaluation explicitly", async () => {
    vi.stubEnv("FYREFLOW_ENABLE_LEGACY_REGEX_GATES", "0");
    const output = "WORKFLOW_STATUS: FAIL";
    const gates = [createRegexGate("gate-workflow", "Workflow Gate", "WORKFLOW_STATUS\\s*:\\s*PASS")];

    const results = await evaluatePipelineQualityGates(
      createStep(),
      output,
      null,
      gates,
      {
        sharedStoragePath: "",
        isolatedStoragePath: "",
        runStoragePath: ""
      },
      {}
    );

    expect(results).toHaveLength(1);
    expect(results[0]?.status).toBe("pass");
    expect(results[0]?.details).toContain("FYREFLOW_ENABLE_LEGACY_REGEX_GATES=1");
  });
});
