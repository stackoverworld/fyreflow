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

async function withTempDir(fn: (dir: string) => Promise<void>): Promise<void> {
  const tempDir = await mkdtemp(path.join(tmpdir(), "fyreflow-qg-html-"));
  try {
    await fn(tempDir);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
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

const LONG_VISIBLE_TEXT =
  "LunarBase market opportunity is projected to exceed one hundred ten billion annual routed volume with explicit growth milestones and operating metrics across every quarter.";

describe("quality gates — HTML contracts", () => {
  describe("background asset contract", () => {
    it("passes when HTML embeds valid data-URI backgrounds", async () => {
      await withTempDir(async (dir) => {
        await writeFile(path.join(dir, "assets-manifest.json"), MANIFEST_WITH_BG, "utf8");
        await writeFile(
          path.join(dir, "investor-deck.html"),
          "<section class=\"slide\" style=\"background-image: url('data:image/png;base64,AAAA')\"></section>",
          "utf8"
        );

        const result = await evaluateStepContracts(createStep(), "WORKFLOW_STATUS: PASS", createStoragePaths(dir), {});
        const gate = result.gateResults.find((entry) => entry.gateName === "Background assets are embedded correctly");
        expect(gate?.status).toBe("pass");
      });
    });

    it("fails when HTML contains duplicated data URI prefix", async () => {
      await withTempDir(async (dir) => {
        await writeFile(path.join(dir, "assets-manifest.json"), MANIFEST_WITH_BG, "utf8");
        await writeFile(
          path.join(dir, "investor-deck.html"),
          "<section class=\"slide\" style=\"background-image: url('data:image/png;base64,data:image/png;base64,AAAA')\"></section>",
          "utf8"
        );

        const result = await evaluateStepContracts(createStep(), "WORKFLOW_STATUS: PASS", createStoragePaths(dir), {});
        const gate = result.gateResults.find((entry) => entry.gateName === "Background assets are embedded correctly");
        expect(gate?.status).toBe("fail");
        expect(gate?.message).toContain("duplicated data URI");
      });
    });

    it("fails when manifest has backgrounds but HTML embeds none", async () => {
      await withTempDir(async (dir) => {
        await writeFile(path.join(dir, "assets-manifest.json"), MANIFEST_WITH_BG, "utf8");
        await writeFile(path.join(dir, "investor-deck.html"), "<section class=\"slide\"></section>", "utf8");

        const result = await evaluateStepContracts(createStep(), "WORKFLOW_STATUS: PASS", createStoragePaths(dir), {});
        const gate = result.gateResults.find((entry) => entry.gateName === "Background assets are embedded correctly");
        expect(gate?.status).toBe("fail");
        expect(gate?.message).toContain("does not reference them");
      });
    });

    it("passes when HTML references local file-backed backgrounds", async () => {
      await withTempDir(async (dir) => {
        await writeFile(path.join(dir, "assets-manifest.json"), MANIFEST_WITH_BG, "utf8");
        await writeFile(
          path.join(dir, "investor-deck.html"),
          "<section class=\"slide\" style=\"background-image: url('assets/frame-1.png')\"></section>",
          "utf8"
        );

        const result = await evaluateStepContracts(createStep(), "WORKFLOW_STATUS: PASS", createStoragePaths(dir), {});
        const gate = result.gateResults.find((entry) => entry.gateName === "Background assets are embedded correctly");
        expect(gate?.status).toBe("pass");
        expect(gate?.message).toContain("file-backed");
      });
    });

    it("fails when manifest has file-backed backgrounds but HTML references none", async () => {
      await withTempDir(async (dir) => {
        await writeFile(path.join(dir, "assets-manifest.json"), MANIFEST_WITH_FILE_BG_ONLY, "utf8");
        await writeFile(path.join(dir, "investor-deck.html"), "<section class=\"slide\"></section>", "utf8");

        const result = await evaluateStepContracts(createStep(), "WORKFLOW_STATUS: PASS", createStoragePaths(dir), {});
        const gate = result.gateResults.find((entry) => entry.gateName === "Background assets are embedded correctly");
        expect(gate?.status).toBe("fail");
        expect(gate?.message).toContain("does not reference them");
      });
    });

    it("passes when SVG background is referenced as local file", async () => {
      await withTempDir(async (dir) => {
        await writeFile(path.join(dir, "assets-manifest.json"), MANIFEST_WITH_FILE_BG_ONLY, "utf8");
        await writeFile(
          path.join(dir, "investor-deck.html"),
          "<section class=\"slide\" style=\"background-image:url('assets/frame-1.svg')\"></section>",
          "utf8"
        );

        const result = await evaluateStepContracts(createStep(), "WORKFLOW_STATUS: PASS", createStoragePaths(dir), {});
        const gate = result.gateResults.find((entry) => entry.gateName === "Background assets are embedded correctly");
        expect(gate?.status).toBe("pass");
        expect(gate?.message).toContain("file-backed");
      });
    });
  });

  describe("hidden content contract", () => {
    it("passes when source content is visible", async () => {
      await withTempDir(async (dir) => {
        await writeFile(
          path.join(dir, "investor-deck.html"),
          "<!doctype html><html><body><section class=\"slide\"><h1>Revenue +26%</h1><p>Visible content</p></section></body></html>",
          "utf8"
        );

        const result = await evaluateStepContracts(createStep(), "WORKFLOW_STATUS: PASS", createStoragePaths(dir), {});
        const gate = result.gateResults.find((entry) => entry.gateName === "Primary content must stay visible");
        expect(gate?.status).toBe("pass");
      });
    });

    it("fails when content is placed in hidden sr-only container", async () => {
      await withTempDir(async (dir) => {
        await writeFile(
          path.join(dir, "investor-deck.html"),
          "<!doctype html><html><body><section class=\"slide\"><div class=\"sr-only\">Total value locked reached 4.2 billion dollars this quarter.</div></section></body></html>",
          "utf8"
        );

        const result = await evaluateStepContracts(createStep(), "WORKFLOW_STATUS: PASS", createStoragePaths(dir), {});
        const gate = result.gateResults.find((entry) => entry.gateName === "Primary content must stay visible");
        expect(gate?.status).toBe("fail");
        expect(gate?.details ?? "").toContain("sr-only");
      });
    });
  });

  describe("overlay-risk background contract", () => {
    it("fails when HTML uses textOverlayRisk backgrounds with visible text", async () => {
      await withTempDir(async (dir) => {
        await writeFile(
          path.join(dir, "assets-manifest.json"),
          JSON.stringify({
            0: { slideIndex: 1, textOverlayRisk: true, background: { file: "assets/frame-1.png" } }
          }),
          "utf8"
        );
        await writeFile(
          path.join(dir, "investor-deck.html"),
          `<!doctype html><html><body><section class="slide" style="background-image:url('assets/frame-1.png')"><h1>${LONG_VISIBLE_TEXT}</h1></section></body></html>`,
          "utf8"
        );

        const result = await evaluateStepContracts(createStep(), "WORKFLOW_STATUS: PASS", createStoragePaths(dir), {});
        const gate = result.gateResults.find(
          (entry) => entry.gateName === "Overlay-risk backgrounds are not reused for visible text"
        );
        expect(gate?.status).toBe("fail");
        expect(gate?.details ?? "").toContain("assets/frame-1.png");
      });
    });

    it("passes when HTML avoids risky background files", async () => {
      await withTempDir(async (dir) => {
        await writeFile(
          path.join(dir, "assets-manifest.json"),
          JSON.stringify({
            0: { slideIndex: 1, textOverlayRisk: true, background: { file: "assets/frame-1.png" } }
          }),
          "utf8"
        );
        await writeFile(
          path.join(dir, "investor-deck.html"),
          `<!doctype html><html><body><section class="slide" style="background-image:url('assets/slide-1-bg.png')"><h1>${LONG_VISIBLE_TEXT}</h1></section></body></html>`,
          "utf8"
        );

        const result = await evaluateStepContracts(createStep(), "WORKFLOW_STATUS: PASS", createStoragePaths(dir), {});
        const gate = result.gateResults.find(
          (entry) => entry.gateName === "Overlay-risk backgrounds are not reused for visible text"
        );
        expect(gate?.status).toBe("pass");
      });
    });

    it("passes when manifest does not flag overlay risk", async () => {
      await withTempDir(async (dir) => {
        await writeFile(
          path.join(dir, "assets-manifest.json"),
          JSON.stringify({
            0: { slideIndex: 1, textOverlayRisk: false, background: { file: "assets/frame-1.png" } }
          }),
          "utf8"
        );
        await writeFile(
          path.join(dir, "investor-deck.html"),
          `<!doctype html><html><body><section class="slide" style="background-image:url('assets/frame-1.png')"><h1>${LONG_VISIBLE_TEXT}</h1></section></body></html>`,
          "utf8"
        );

        const result = await evaluateStepContracts(createStep(), "WORKFLOW_STATUS: PASS", createStoragePaths(dir), {});
        const gate = result.gateResults.find(
          (entry) => entry.gateName === "Overlay-risk backgrounds are not reused for visible text"
        );
        expect(gate?.status).toBe("pass");
      });
    });
  });

  describe("edge cases", () => {
    it("handles completely empty HTML body without crashing", async () => {
      await withTempDir(async (dir) => {
        await writeFile(path.join(dir, "investor-deck.html"), "<!doctype html><html><body></body></html>", "utf8");

        const result = await evaluateStepContracts(createStep(), "WORKFLOW_STATUS: PASS", createStoragePaths(dir), {});
        expect(result.gateResults).toBeDefined();
        const hiddenGate = result.gateResults.find((entry) => entry.gateName === "Primary content must stay visible");
        if (hiddenGate) {
          expect(hiddenGate.status).toBe("pass");
        }
      });
    });

    it("handles malformed HTML with unclosed tags", async () => {
      await withTempDir(async (dir) => {
        await writeFile(
          path.join(dir, "investor-deck.html"),
          "<html><body><section class=\"slide\"><h1>Unclosed heading<p>Orphaned paragraph</section>",
          "utf8"
        );

        const result = await evaluateStepContracts(createStep(), "WORKFLOW_STATUS: PASS", createStoragePaths(dir), {});
        expect(result.gateResults).toBeDefined();
      });
    });

    it("handles large HTML without excessive evaluation time", async () => {
      await withTempDir(async (dir) => {
        const slides = Array.from({ length: 200 }, (_, i) =>
          `<section class="slide"><h1>Slide ${i}</h1><p>${"Content ".repeat(100)}</p></section>`
        ).join("\n");
        const html = `<!doctype html><html><body>${slides}</body></html>`;
        await writeFile(path.join(dir, "investor-deck.html"), html, "utf8");

        const start = performance.now();
        const result = await evaluateStepContracts(createStep(), "WORKFLOW_STATUS: PASS", createStoragePaths(dir), {});
        const elapsed = performance.now() - start;

        expect(result.gateResults).toBeDefined();
        expect(elapsed).toBeLessThan(5_000);
      });
    });
  });
});
