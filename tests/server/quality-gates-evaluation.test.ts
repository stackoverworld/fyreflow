import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import { evaluatePipelineQualityGates, evaluateStepContracts } from "../../server/runner/qualityGates/evaluators.js";
import { inferWorkflowOutcome, normalizeStatusMarkers, parseJsonOutput } from "../../server/runner/qualityGates/normalizers.js";
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
    skipIfArtifacts: [],
    policyProfileIds: [],
    cacheBypassInputKeys: [],
    cacheBypassOrchestratorPromptPatterns: []
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

function createAnalysisStep(): PipelineStep {
  return {
    id: "step-extractor",
    name: "Figma Extractor",
    role: "analysis",
    prompt: "Extract assets.",
    providerId: "openai",
    model: "gpt-5.4",
    reasoningEffort: "high",
    fastMode: false,
    use1MContext: false,
    contextWindowTokens: 272_000,
    position: { x: 0, y: 0 },
    contextTemplate: "Task:\n{{task}}",
    enableDelegation: false,
    delegationCount: 1,
    enableIsolatedStorage: true,
    enableSharedStorage: true,
    enabledMcpServerIds: [],
    outputFormat: "markdown",
    requiredOutputFields: [],
    requiredOutputFiles: [],
    scenarios: [],
    skipIfArtifacts: [],
    policyProfileIds: [],
    cacheBypassInputKeys: [],
    cacheBypassOrchestratorPromptPatterns: []
  };
}

function createSiteGeneratorStep(): PipelineStep {
  return {
    ...createAnalysisStep(),
    id: "step-site-generator",
    name: "Site Content Generator",
    requiredOutputFiles: ["{{shared_storage_path}}/site-updated.json"]
  };
}

function createRegexGate(pattern: string, overrides?: Partial<PipelineQualityGate>): PipelineQualityGate {
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
    message: "",
    ...overrides
  };
}

function createJsonFieldGate(artifactPath: string): PipelineQualityGate {
  return {
    id: "gate-frame-count",
    name: "Frame Count Field Gate",
    targetStepId: "step-extractor",
    kind: "json_field_exists",
    blocking: true,
    pattern: "",
    flags: "",
    jsonPath: "$.frameCount",
    artifactPath,
    message: ""
  };
}

const emptyStoragePaths = {
  sharedStoragePath: "",
  isolatedStoragePath: "",
  runStoragePath: ""
};

const tmpStoragePaths = {
  sharedStoragePath: "/tmp",
  isolatedStoragePath: "/tmp",
  runStoragePath: "/tmp"
};

describe("quality gates — evaluation", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  describe("JSON status contract", () => {
    it("accepts strict GateResult JSON contract on review steps", async () => {
      const step = createReviewStep();
      const output = JSON.stringify({
        workflow_status: "PASS",
        next_action: "continue",
        summary: "no blocking issues",
        reasons: [{ code: "ok", message: "All checks passed.", severity: "low" }]
      });

      const contract = await evaluateStepContracts(step, output, tmpStoragePaths, {});
      const gate = contract.gateResults.find((result) => result.gateName === "Step emits GateResult contract");
      expect(gate?.status).toBe("pass");
      expect(gate?.details).toContain("source=json");
    });

    it("rejects legacy text markers on strict GateResult steps", async () => {
      const step = createReviewStep();
      const output = "HTML_REVIEW_STATUS: PASS\nWORKFLOW_STATUS: PASS";

      const contract = await evaluateStepContracts(step, output, tmpStoragePaths, {});
      const gate = contract.gateResults.find((result) => result.gateName === "Step emits GateResult contract");
      expect(gate?.status).toBe("fail");
      expect(gate?.details).toContain("source=legacy_text");
    });

    it("allows explicit JSON reviewer contracts without forcing GateResult fields", async () => {
      const step = {
        ...createReviewStep(),
        outputFormat: "json" as const,
        requiredOutputFields: ["review_result", "issues_found", "status"]
      };
      const output = JSON.stringify({
        review_result: "pass",
        issues_found: [],
        status: "completed"
      });

      const contract = await evaluateStepContracts(step, output, tmpStoragePaths, {});
      const strictGate = contract.gateResults.find((result) => result.gateName === "Step emits GateResult contract");

      expect(strictGate).toBeUndefined();
      expect(contract.gateResults.filter((result) => result.status === "fail")).toHaveLength(0);
    });

    it("enforces strict GateResult JSON contract for delivery-style steps", async () => {
      const step = createDeliveryStep();
      const output = JSON.stringify({
        workflow_status: "COMPLETE",
        next_action: "stop",
        summary: "Delivery artifacts copied.",
        reasons: [{ code: "delivery_complete", message: "All outputs delivered.", severity: "low" }]
      });

      const contract = await evaluateStepContracts(step, output, tmpStoragePaths, {});
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

      const results = await evaluatePipelineQualityGates(step, output, parseJsonOutput(output), gates, tmpStoragePaths, {});
      expect(results.every((result) => result.status === "pass")).toBe(true);
    });
  });

  describe("json_field_exists artifact evaluation", () => {
    let tempDir = "";

    afterEach(async () => {
      if (tempDir.length > 0) {
        await rm(tempDir, { recursive: true, force: true });
        tempDir = "";
      }
    });

    it("reads jsonPath from artifactPath when configured", async () => {
      tempDir = await mkdtemp(path.join(os.tmpdir(), "fyreflow-json-gate-"));
      await writeFile(path.join(tempDir, "frame-map.json"), JSON.stringify({ frameCount: 12 }), "utf8");

      const results = await evaluatePipelineQualityGates(
        createAnalysisStep(),
        "EXTRACTION_STATUS: COMPLETE",
        null,
        [createJsonFieldGate("{{shared_storage_path}}/frame-map.json")],
        { sharedStoragePath: tempDir, isolatedStoragePath: tempDir, runStoragePath: tempDir },
        {}
      );

      expect(results).toHaveLength(1);
      expect(results[0]?.status).toBe("pass");
      expect(results[0]?.details).toContain("source=artifact");
    });

    it("falls back to step output JSON when artifactPath is empty", async () => {
      tempDir = await mkdtemp(path.join(os.tmpdir(), "fyreflow-json-gate-"));

      const results = await evaluatePipelineQualityGates(
        createAnalysisStep(),
        JSON.stringify({ frameCount: 7 }),
        null,
        [createJsonFieldGate("")],
        { sharedStoragePath: tempDir, isolatedStoragePath: tempDir, runStoragePath: tempDir },
        {}
      );

      expect(results).toHaveLength(1);
      expect(results[0]?.status).toBe("pass");
      expect(results[0]?.details).toContain("source=output");
    });
  });

  describe("status marker normalization", () => {
    it("normalizes markdown-decorated status markers", () => {
      const output = "HTML_REVIEW_STATUS: **PASS**\nWORKFLOW_STATUS: **PASS**";
      const normalized = normalizeStatusMarkers(output);

      expect(normalized).toContain("HTML_REVIEW_STATUS: PASS");
      expect(normalized).toContain("WORKFLOW_STATUS: PASS");
      expect(inferWorkflowOutcome(output)).toBe("pass");
    });

    it("allows regex quality gates to pass when status value is wrapped with markdown markers", async () => {
      const output = ["## Review", "HTML_REVIEW_STATUS: **PASS**", "WORKFLOW_STATUS: **PASS**"].join("\n");

      const gates = [
        createRegexGate("HTML_REVIEW_STATUS:\\s*(PASS|FAIL)", { id: "gate-html", name: "HTML Review Gate", targetStepId: "html-review-step" }),
        createRegexGate("WORKFLOW_STATUS\\s*:\\s*(PASS|FAIL|NEUTRAL)", { id: "gate-workflow", name: "Workflow Gate", targetStepId: "html-review-step" })
      ];

      const step = { ...createReviewStep(), id: "html-review-step" };
      const results = await evaluatePipelineQualityGates(step, output, null, gates, emptyStoragePaths, {});

      expect(results).toHaveLength(2);
      expect(results.every((result) => result.status === "pass")).toBe(true);
    });

    it("treats WORKFLOW_STATUS: COMPLETE as pass for legacy workflow-status regex gates", async () => {
      const output = ["## PDF Review", "PDF_REVIEW_STATUS: PASS", "WORKFLOW_STATUS: COMPLETE"].join("\n");

      const gates = [
        createRegexGate("WORKFLOW_STATUS\\s*:\\s*(PASS|FAIL|NEUTRAL)", { id: "gate-workflow", name: "Workflow Gate", targetStepId: "html-review-step" })
      ];

      const step = { ...createReviewStep(), id: "html-review-step" };
      const results = await evaluatePipelineQualityGates(step, output, null, gates, emptyStoragePaths, {});

      expect(results).toHaveLength(1);
      expect(results[0]?.status).toBe("pass");
      expect(inferWorkflowOutcome(output)).toBe("pass");
    });

    it("evaluates regex quality gates by default", async () => {
      const output = "WORKFLOW_STATUS: FAIL";
      const gates = [
        createRegexGate("WORKFLOW_STATUS\\s*:\\s*PASS", { id: "gate-workflow", name: "Workflow Gate", targetStepId: "html-review-step" })
      ];

      const step = { ...createReviewStep(), id: "html-review-step" };
      const results = await evaluatePipelineQualityGates(step, output, null, gates, emptyStoragePaths, {});

      expect(results).toHaveLength(1);
      expect(results[0]?.status).toBe("fail");
    });

    it("allows disabling legacy regex gate evaluation explicitly", async () => {
      vi.stubEnv("FYREFLOW_ENABLE_LEGACY_REGEX_GATES", "0");
      const output = "WORKFLOW_STATUS: FAIL";
      const gates = [
        createRegexGate("WORKFLOW_STATUS\\s*:\\s*PASS", { id: "gate-workflow", name: "Workflow Gate", targetStepId: "html-review-step" })
      ];

      const step = { ...createReviewStep(), id: "html-review-step" };
      const results = await evaluatePipelineQualityGates(step, output, null, gates, emptyStoragePaths, {});

      expect(results).toHaveLength(1);
      expect(results[0]?.status).toBe("pass");
      expect(results[0]?.details).toContain("FYREFLOW_ENABLE_LEGACY_REGEX_GATES=1");
    });
  });

  describe("edge cases", () => {
    it("handles invalid JSON output gracefully", async () => {
      const step = createReviewStep();
      const output = "{ broken json: true, missing }";

      const contract = await evaluateStepContracts(step, output, tmpStoragePaths, {});
      expect(contract.gateResults).toBeDefined();
      const gate = contract.gateResults.find((result) => result.gateName === "Step emits GateResult contract");
      if (gate) {
        expect(gate.status).toBe("fail");
      }
    });

    it("handles missing required workflow_status field in JSON output", async () => {
      const step = createReviewStep();
      const output = JSON.stringify({
        next_action: "continue",
        summary: "no status field"
      });

      const contract = await evaluateStepContracts(step, output, tmpStoragePaths, {});
      const gate = contract.gateResults.find((result) => result.gateName === "Step emits GateResult contract");
      if (gate) {
        expect(gate.status).toBe("fail");
      }
    });

    it("does not false-positive on extra unexpected fields in JSON output", async () => {
      const step = createReviewStep();
      const output = JSON.stringify({
        workflow_status: "PASS",
        next_action: "continue",
        summary: "all good",
        reasons: [{ code: "ok", message: "Passed.", severity: "low" }],
        extra_field: "should be ignored",
        another_extra: 42
      });

      const contract = await evaluateStepContracts(step, output, tmpStoragePaths, {});
      const gate = contract.gateResults.find((result) => result.gateName === "Step emits GateResult contract");
      expect(gate?.status).toBe("pass");
    });

    it("classifies transport failures as fail outcome", () => {
      const output = [
        "Successfully committed files: 0",
        "HTTP status: 000",
        "Error: curl: (6) Could not resolve host: gitlab.com"
      ].join("\n");

      expect(inferWorkflowOutcome(output)).toBe("fail");
    });

    it("keeps hard transport failure as fail even when workflow marker says PASS", () => {
      const output = [
        "WORKFLOW_STATUS: PASS",
        "Successfully committed files: 0",
        "All commits failed with HTTP status: 000",
        "Error: curl: (6) Could not resolve host: gitlab.com"
      ].join("\n");

      expect(inferWorkflowOutcome(output)).toBe("fail");
    });

    it("treats markdown-formatted transport failures as fail outcome", () => {
      const output = [
        "WORKFLOW_STATUS: COMPLETE",
        "Successfully committed files: `0`",
        "All commits failed with:",
        "- HTTP status: `000`",
        "- Error: `curl: (6) Could not resolve host: gitlab.com`"
      ].join("\n");

      expect(inferWorkflowOutcome(output)).toBe("fail");
    });

    it("maps JSON status=completed to pass outcome", () => {
      const output = JSON.stringify({
        status: "completed",
        summary: "finished"
      });

      expect(inferWorkflowOutcome(output)).toBe("pass");
    });
  });

  describe("site artifact import integrity contract", () => {
    let tempDir = "";

    afterEach(async () => {
      if (tempDir.length > 0) {
        await rm(tempDir, { recursive: true, force: true });
        tempDir = "";
      }
    });

    it("fails when site-updated.json introduces unresolved local imports", async () => {
      tempDir = await mkdtemp(path.join(os.tmpdir(), "fyreflow-site-import-contract-"));

      await writeFile(
        path.join(tempDir, "site-updated.json"),
        JSON.stringify(
          {
            files: {
              "src/app/whitepaper/page.tsx": {
                content: "import { WhitepaperLayout } from '@/features/whitepaper/WhitepaperLayout';\nexport default function Page(){return <WhitepaperLayout />;}"
              }
            }
          },
          null,
          2
        ),
        "utf8"
      );
      await writeFile(
        path.join(tempDir, "site-current.json"),
        JSON.stringify(
          {
            repositoryTree: ["src/app/whitepaper/page.tsx", "src/features/whitepaper/WhitepaperPage.tsx"]
          },
          null,
          2
        ),
        "utf8"
      );

      const contract = await evaluateStepContracts(
        createSiteGeneratorStep(),
        "WORKFLOW_STATUS: PASS",
        { sharedStoragePath: tempDir, isolatedStoragePath: tempDir, runStoragePath: tempDir },
        {}
      );
      const gate = contract.gateResults.find((result) => result.gateName === "Site bundle import integrity");
      expect(gate?.status).toBe("fail");
      expect(gate?.message).toContain("unresolved local imports");
      expect(gate?.details).toContain("WhitepaperLayout");
    });

    it("passes when imports resolve using site-updated/site-current file inventories", async () => {
      tempDir = await mkdtemp(path.join(os.tmpdir(), "fyreflow-site-import-contract-"));

      await writeFile(
        path.join(tempDir, "site-updated.json"),
        JSON.stringify(
          {
            files: {
              "src/app/whitepaper/page.tsx": {
                content: "import { WhitepaperPage } from '@/features/whitepaper/WhitepaperPage';\nexport default function Page(){return <WhitepaperPage />;}"
              }
            }
          },
          null,
          2
        ),
        "utf8"
      );
      await writeFile(
        path.join(tempDir, "site-current.json"),
        JSON.stringify(
          {
            repositoryTree: ["src/features/whitepaper/WhitepaperPage.tsx"]
          },
          null,
          2
        ),
        "utf8"
      );

      const contract = await evaluateStepContracts(
        createSiteGeneratorStep(),
        "WORKFLOW_STATUS: PASS",
        { sharedStoragePath: tempDir, isolatedStoragePath: tempDir, runStoragePath: tempDir },
        {}
      );
      const gate = contract.gateResults.find((result) => result.gateName === "Site bundle import integrity");
      expect(gate?.status).toBe("pass");
    });
  });
});
