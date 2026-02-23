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

const LONG_VISIBLE_TEXT =
  "LunarBase market opportunity is projected to exceed one hundred ten billion annual routed volume with explicit growth milestones and operating metrics across every quarter.";

describe("overlay-risk background contract", () => {
  it("fails when HTML uses textOverlayRisk backgrounds with visible text", async () => {
    const tempDir = await mkdtemp(path.join(tmpdir(), "fyreflow-overlay-risk-"));
    try {
      await writeFile(
        path.join(tempDir, "assets-manifest.json"),
        JSON.stringify({
          0: {
            slideIndex: 1,
            textOverlayRisk: true,
            background: { file: "assets/frame-1.png" }
          }
        }),
        "utf8"
      );
      await writeFile(
        path.join(tempDir, "investor-deck.html"),
        `<!doctype html><html><body><section class="slide" style="background-image:url('assets/frame-1.png')"><h1>${LONG_VISIBLE_TEXT}</h1></section></body></html>`,
        "utf8"
      );

      const result = await evaluateStepContracts(createStep(), "WORKFLOW_STATUS: PASS", createStoragePaths(tempDir), {});
      const gate = result.gateResults.find(
        (entry) => entry.gateName === "Overlay-risk backgrounds are not reused for visible text"
      );
      expect(gate?.status).toBe("fail");
      expect(gate?.details ?? "").toContain("assets/frame-1.png");
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it("passes when HTML avoids risky background files", async () => {
    const tempDir = await mkdtemp(path.join(tmpdir(), "fyreflow-overlay-risk-"));
    try {
      await writeFile(
        path.join(tempDir, "assets-manifest.json"),
        JSON.stringify({
          0: {
            slideIndex: 1,
            textOverlayRisk: true,
            background: { file: "assets/frame-1.png" }
          }
        }),
        "utf8"
      );
      await writeFile(
        path.join(tempDir, "investor-deck.html"),
        `<!doctype html><html><body><section class="slide" style="background-image:url('assets/slide-1-bg.png')"><h1>${LONG_VISIBLE_TEXT}</h1></section></body></html>`,
        "utf8"
      );

      const result = await evaluateStepContracts(createStep(), "WORKFLOW_STATUS: PASS", createStoragePaths(tempDir), {});
      const gate = result.gateResults.find(
        (entry) => entry.gateName === "Overlay-risk backgrounds are not reused for visible text"
      );
      expect(gate?.status).toBe("pass");
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it("passes when manifest does not flag overlay risk", async () => {
    const tempDir = await mkdtemp(path.join(tmpdir(), "fyreflow-overlay-risk-"));
    try {
      await writeFile(
        path.join(tempDir, "assets-manifest.json"),
        JSON.stringify({
          0: {
            slideIndex: 1,
            textOverlayRisk: false,
            background: { file: "assets/frame-1.png" }
          }
        }),
        "utf8"
      );
      await writeFile(
        path.join(tempDir, "investor-deck.html"),
        `<!doctype html><html><body><section class="slide" style="background-image:url('assets/frame-1.png')"><h1>${LONG_VISIBLE_TEXT}</h1></section></body></html>`,
        "utf8"
      );

      const result = await evaluateStepContracts(createStep(), "WORKFLOW_STATUS: PASS", createStoragePaths(tempDir), {});
      const gate = result.gateResults.find(
        (entry) => entry.gateName === "Overlay-risk backgrounds are not reused for visible text"
      );
      expect(gate?.status).toBe("pass");
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });
});
