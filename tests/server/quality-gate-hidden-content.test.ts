import { mkdtemp, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import { evaluateStepContracts } from "../../server/runner/qualityGates/evaluators.js";
import type { PipelineStep } from "../../server/types/contracts.js";
import type { StepStoragePaths } from "../../server/runner/types.js";

function createStep(): PipelineStep {
  return {
    id: "step-builder",
    name: "HTML Builder",
    role: "executor",
    prompt: "Build HTML.",
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
    enableIsolatedStorage: true,
    enableSharedStorage: true,
    enabledMcpServerIds: [],
    outputFormat: "markdown",
    requiredOutputFields: [],
    requiredOutputFiles: ["{{shared_storage_path}}/investor-deck.html"],
    scenarios: [],
    skipIfArtifacts: []
  };
}

function createStoragePaths(sharedStoragePath: string): StepStoragePaths {
  return {
    sharedStoragePath,
    isolatedStoragePath: path.join(sharedStoragePath, "isolated"),
    runStoragePath: path.join(sharedStoragePath, "run")
  };
}

describe("hidden content contract", () => {
  it("passes when source content is visible", async () => {
    const tempDir = await mkdtemp(path.join(tmpdir(), "fyreflow-hidden-content-"));
    try {
      await writeFile(
        path.join(tempDir, "investor-deck.html"),
        "<!doctype html><html><body><section class=\"slide\"><h1>Revenue +26%</h1><p>Visible content</p></section></body></html>",
        "utf8"
      );

      const result = await evaluateStepContracts(createStep(), "WORKFLOW_STATUS: PASS", createStoragePaths(tempDir), {});
      const gate = result.gateResults.find((entry) => entry.gateName === "Primary content must stay visible");
      expect(gate?.status).toBe("pass");
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it("fails when content is placed in hidden sr-only container", async () => {
    const tempDir = await mkdtemp(path.join(tmpdir(), "fyreflow-hidden-content-"));
    try {
      await writeFile(
        path.join(tempDir, "investor-deck.html"),
        "<!doctype html><html><body><section class=\"slide\"><div class=\"sr-only\">Total value locked reached 4.2 billion dollars this quarter.</div></section></body></html>",
        "utf8"
      );

      const result = await evaluateStepContracts(createStep(), "WORKFLOW_STATUS: PASS", createStoragePaths(tempDir), {});
      const gate = result.gateResults.find((entry) => entry.gateName === "Primary content must stay visible");
      expect(gate?.status).toBe("fail");
      expect(gate?.details ?? "").toContain("sr-only");
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });
});
