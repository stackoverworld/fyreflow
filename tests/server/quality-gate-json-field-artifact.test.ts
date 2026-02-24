import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { evaluatePipelineQualityGates } from "../../server/runner/qualityGates/evaluators.js";
import type { PipelineQualityGate, PipelineStep } from "../../server/types/contracts.js";

function createStep(): PipelineStep {
  return {
    id: "step-extractor",
    name: "Figma Extractor",
    role: "analysis",
    prompt: "Extract assets.",
    providerId: "openai",
    model: "gpt-5.3-codex",
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
    skipIfArtifacts: []
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

const runInputs = {};

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
      createStep(),
      "EXTRACTION_STATUS: COMPLETE",
      null,
      [createJsonFieldGate("{{shared_storage_path}}/frame-map.json")],
      {
        sharedStoragePath: tempDir,
        isolatedStoragePath: tempDir,
        runStoragePath: tempDir
      },
      runInputs
    );

    expect(results).toHaveLength(1);
    expect(results[0]?.status).toBe("pass");
    expect(results[0]?.details).toContain("source=artifact");
  });

  it("falls back to step output JSON when artifactPath is empty", async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), "fyreflow-json-gate-"));

    const results = await evaluatePipelineQualityGates(
      createStep(),
      JSON.stringify({ frameCount: 7 }),
      null,
      [createJsonFieldGate("")],
      {
        sharedStoragePath: tempDir,
        isolatedStoragePath: tempDir,
        runStoragePath: tempDir
      },
      runInputs
    );

    expect(results).toHaveLength(1);
    expect(results[0]?.status).toBe("pass");
    expect(results[0]?.details).toContain("source=output");
  });
});
