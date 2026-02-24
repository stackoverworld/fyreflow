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

function createHtml(slideCount: number): string {
  const slides = Array.from({ length: slideCount }, (_, index) => {
    const slideNumber = index + 1;
    return `<section class="slide" id="slide-${slideNumber}">Slide ${slideNumber}</section>`;
  }).join("\n");
  return `<!doctype html><html><body>${slides}</body></html>`;
}

function createDivHtml(slideCount: number): string {
  const slides = Array.from({ length: slideCount }, (_, index) => {
    const slideNumber = index + 1;
    return `<div class="slide" id="slide-${slideNumber}">Slide ${slideNumber}</div>`;
  }).join("\n");
  return `<!doctype html><html><body>${slides}</body></html>`;
}

describe("slide count contract", () => {
  it("passes when html slide count matches frame-map totalFrames", async () => {
    const tempDir = await mkdtemp(path.join(tmpdir(), "fyreflow-slide-count-"));
    try {
      await writeFile(path.join(tempDir, "frame-map.json"), JSON.stringify({ totalFrames: 2 }), "utf8");
      await writeFile(path.join(tempDir, "investor-deck.html"), createHtml(2), "utf8");

      const result = await evaluateStepContracts(createStep(), "WORKFLOW_STATUS: PASS", createStoragePaths(tempDir), {});
      const gate = result.gateResults.find((entry) => entry.gateName === "Slide count matches frame map");
      expect(gate?.status).toBe("pass");
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it("fails when html slide count does not match frame-map", async () => {
    const tempDir = await mkdtemp(path.join(tmpdir(), "fyreflow-slide-count-"));
    try {
      await writeFile(path.join(tempDir, "frame-map.json"), JSON.stringify({ totalFrames: 2 }), "utf8");
      await writeFile(path.join(tempDir, "investor-deck.html"), createHtml(3), "utf8");

      const result = await evaluateStepContracts(createStep(), "WORKFLOW_STATUS: PASS", createStoragePaths(tempDir), {});
      const gate = result.gateResults.find((entry) => entry.gateName === "Slide count matches frame map");
      expect(gate?.status).toBe("fail");
      expect(gate?.message).toContain("does not match");
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it("passes when slide containers are div elements", async () => {
    const tempDir = await mkdtemp(path.join(tmpdir(), "fyreflow-slide-count-"));
    try {
      await writeFile(path.join(tempDir, "frame-map.json"), JSON.stringify({ totalFrames: 2 }), "utf8");
      await writeFile(path.join(tempDir, "investor-deck.html"), createDivHtml(2), "utf8");

      const result = await evaluateStepContracts(createStep(), "WORKFLOW_STATUS: PASS", createStoragePaths(tempDir), {});
      const gate = result.gateResults.find((entry) => entry.gateName === "Slide count matches frame map");
      expect(gate?.status).toBe("pass");
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it("passes when frame-map uses slideCount/slides format", async () => {
    const tempDir = await mkdtemp(path.join(tmpdir(), "fyreflow-slide-count-"));
    try {
      await writeFile(
        path.join(tempDir, "frame-map.json"),
        JSON.stringify({
          slideCount: 2,
          slides: [
            { slideIndex: 1, frameId: "6883:4842" },
            { slideIndex: 2, frameId: "6883:4850" }
          ]
        }),
        "utf8"
      );
      await writeFile(path.join(tempDir, "investor-deck.html"), createDivHtml(2), "utf8");

      const result = await evaluateStepContracts(createStep(), "WORKFLOW_STATUS: PASS", createStoragePaths(tempDir), {});
      const gate = result.gateResults.find((entry) => entry.gateName === "Slide count matches frame map");
      expect(gate?.status).toBe("pass");
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it("passes when frame-map is a numeric-keyed object map", async () => {
    const tempDir = await mkdtemp(path.join(tmpdir(), "fyreflow-slide-count-"));
    try {
      await writeFile(
        path.join(tempDir, "frame-map.json"),
        JSON.stringify({
          0: { frameId: "6883:4842", name: "Slide 1" },
          1: { frameId: "6883:4850", name: "Slide 2" }
        }),
        "utf8"
      );
      await writeFile(path.join(tempDir, "investor-deck.html"), createDivHtml(2), "utf8");

      const result = await evaluateStepContracts(createStep(), "WORKFLOW_STATUS: PASS", createStoragePaths(tempDir), {});
      const gate = result.gateResults.find((entry) => entry.gateName === "Slide count matches frame map");
      expect(gate?.status).toBe("pass");
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });
});
