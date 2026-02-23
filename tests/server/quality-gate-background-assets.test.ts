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

const MANIFEST_WITH_BG = JSON.stringify({
  frameRenders: {
    "node-1": {
      file: "assets/frame-1.png",
      backgroundImageBase64: "data:image/png;base64,AAAA"
    }
  }
});

const MANIFEST_WITH_FILE_BG_ONLY = JSON.stringify({
  frameRenders: {
    "node-1": {
      file: "assets/frame-1.svg"
    }
  }
});

describe("background asset contract", () => {
  it("passes when HTML embeds valid data-URI backgrounds", async () => {
    const tempDir = await mkdtemp(path.join(tmpdir(), "fyreflow-bg-assets-"));
    try {
      await writeFile(path.join(tempDir, "assets-manifest.json"), MANIFEST_WITH_BG, "utf8");
      await writeFile(
        path.join(tempDir, "investor-deck.html"),
        "<section class=\"slide\" style=\"background-image: url('data:image/png;base64,AAAA')\"></section>",
        "utf8"
      );

      const result = await evaluateStepContracts(createStep(), "WORKFLOW_STATUS: PASS", createStoragePaths(tempDir), {});
      const gate = result.gateResults.find((entry) => entry.gateName === "Background assets are embedded correctly");
      expect(gate?.status).toBe("pass");
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it("fails when HTML contains duplicated data URI prefix", async () => {
    const tempDir = await mkdtemp(path.join(tmpdir(), "fyreflow-bg-assets-"));
    try {
      await writeFile(path.join(tempDir, "assets-manifest.json"), MANIFEST_WITH_BG, "utf8");
      await writeFile(
        path.join(tempDir, "investor-deck.html"),
        "<section class=\"slide\" style=\"background-image: url('data:image/png;base64,data:image/png;base64,AAAA')\"></section>",
        "utf8"
      );

      const result = await evaluateStepContracts(createStep(), "WORKFLOW_STATUS: PASS", createStoragePaths(tempDir), {});
      const gate = result.gateResults.find((entry) => entry.gateName === "Background assets are embedded correctly");
      expect(gate?.status).toBe("fail");
      expect(gate?.message).toContain("duplicated data URI");
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it("fails when manifest has backgrounds but HTML embeds none", async () => {
    const tempDir = await mkdtemp(path.join(tmpdir(), "fyreflow-bg-assets-"));
    try {
      await writeFile(path.join(tempDir, "assets-manifest.json"), MANIFEST_WITH_BG, "utf8");
      await writeFile(path.join(tempDir, "investor-deck.html"), "<section class=\"slide\"></section>", "utf8");

      const result = await evaluateStepContracts(createStep(), "WORKFLOW_STATUS: PASS", createStoragePaths(tempDir), {});
      const gate = result.gateResults.find((entry) => entry.gateName === "Background assets are embedded correctly");
      expect(gate?.status).toBe("fail");
      expect(gate?.message).toContain("does not reference them");
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it("passes when HTML references local file-backed backgrounds", async () => {
    const tempDir = await mkdtemp(path.join(tmpdir(), "fyreflow-bg-assets-"));
    try {
      await writeFile(path.join(tempDir, "assets-manifest.json"), MANIFEST_WITH_BG, "utf8");
      await writeFile(
        path.join(tempDir, "investor-deck.html"),
        "<section class=\"slide\" style=\"background-image: url('assets/frame-1.png')\"></section>",
        "utf8"
      );

      const result = await evaluateStepContracts(createStep(), "WORKFLOW_STATUS: PASS", createStoragePaths(tempDir), {});
      const gate = result.gateResults.find((entry) => entry.gateName === "Background assets are embedded correctly");
      expect(gate?.status).toBe("pass");
      expect(gate?.message).toContain("file-backed");
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it("fails when manifest has file-backed backgrounds but HTML references none", async () => {
    const tempDir = await mkdtemp(path.join(tmpdir(), "fyreflow-bg-assets-"));
    try {
      await writeFile(path.join(tempDir, "assets-manifest.json"), MANIFEST_WITH_FILE_BG_ONLY, "utf8");
      await writeFile(path.join(tempDir, "investor-deck.html"), "<section class=\"slide\"></section>", "utf8");

      const result = await evaluateStepContracts(createStep(), "WORKFLOW_STATUS: PASS", createStoragePaths(tempDir), {});
      const gate = result.gateResults.find((entry) => entry.gateName === "Background assets are embedded correctly");
      expect(gate?.status).toBe("fail");
      expect(gate?.message).toContain("does not reference them");
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it("passes when SVG background is referenced as local file", async () => {
    const tempDir = await mkdtemp(path.join(tmpdir(), "fyreflow-bg-assets-"));
    try {
      await writeFile(path.join(tempDir, "assets-manifest.json"), MANIFEST_WITH_FILE_BG_ONLY, "utf8");
      await writeFile(
        path.join(tempDir, "investor-deck.html"),
        "<section class=\"slide\" style=\"background-image:url('assets/frame-1.svg')\"></section>",
        "utf8"
      );

      const result = await evaluateStepContracts(createStep(), "WORKFLOW_STATUS: PASS", createStoragePaths(tempDir), {});
      const gate = result.gateResults.find((entry) => entry.gateName === "Background assets are embedded correctly");
      expect(gate?.status).toBe("pass");
      expect(gate?.message).toContain("file-backed");
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

});
