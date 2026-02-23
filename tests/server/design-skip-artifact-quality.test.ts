import { mkdtemp, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import { validateStepSkipArtifactsQuality } from "../../server/runner.js";
import type { PipelineStep } from "../../server/types/contracts.js";
import type { ArtifactStateCheck } from "../../server/runner/artifacts.js";

function createState(template: string, foundPath: string, sizeBytes: number): ArtifactStateCheck {
  return {
    template,
    disabledStorage: false,
    paths: [foundPath],
    foundPath,
    exists: true,
    mtimeMs: Date.now(),
    sizeBytes
  };
}

function createExtractionStep(): PipelineStep {
  return {
    id: "step-design-assets",
    name: "Design Asset Extraction",
    role: "analysis",
    prompt: "Extract design assets.",
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
    outputFormat: "json",
    requiredOutputFields: [],
    requiredOutputFiles: [
      "{{shared_storage_path}}/ui-kit.json",
      "{{shared_storage_path}}/assets-manifest.json",
      "{{shared_storage_path}}/frame-map.json"
    ],
    scenarios: ["design_deck"],
    skipIfArtifacts: [
      "{{shared_storage_path}}/ui-kit.json",
      "{{shared_storage_path}}/assets-manifest.json",
      "{{shared_storage_path}}/frame-map.json"
    ],
    policyProfileIds: ["design_deck_assets"],
    cacheBypassInputKeys: [],
    cacheBypassOrchestratorPromptPatterns: []
  };
}

describe("design asset skip artifact quality", () => {
  it("passes with compact file-backed assets manifest", async () => {
    const tempDir = await mkdtemp(path.join(tmpdir(), "fyreflow-design-quality-"));
    try {
      const frameMapPath = path.join(tempDir, "frame-map.json");
      const manifestPath = path.join(tempDir, "assets-manifest.json");
      const frameMap = JSON.stringify(
        {
          totalFrames: 2,
          frames: [
            { id: "frame-1", name: "Slide 1", nodeId: "node-1", width: 1920, height: 1080 },
            { id: "frame-2", name: "Slide 2", nodeId: "node-2", width: 1920, height: 1080 }
          ]
        },
        null,
        2
      );
      const manifest = JSON.stringify({
        frameRenders: {
          "node-1": { file: "assets/frame-1.png", width: 1920, height: 1080 },
          "node-2": { file: "assets/frame-2.svg", width: 1920, height: 1080 }
        },
        imageFills: {}
      });
      await Promise.all([writeFile(frameMapPath, frameMap, "utf8"), writeFile(manifestPath, manifest, "utf8")]);

      const result = await validateStepSkipArtifactsQuality(createExtractionStep(), [
        createState("{{shared_storage_path}}/frame-map.json", frameMapPath, Buffer.byteLength(frameMap)),
        createState("{{shared_storage_path}}/assets-manifest.json", manifestPath, Buffer.byteLength(manifest))
      ]);
      expect(result.ok).toBe(true);
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it("fails when manifest is legacy base64-only", async () => {
    const tempDir = await mkdtemp(path.join(tmpdir(), "fyreflow-design-quality-"));
    try {
      const frameMapPath = path.join(tempDir, "frame-map.json");
      const manifestPath = path.join(tempDir, "assets-manifest.json");
      const frameMap = JSON.stringify({ totalFrames: 2 });
      const manifest = JSON.stringify({
        frameRenders: {
          "node-1": { backgroundImageBase64: "data:image/png;base64,AAAA" }
        }
      });
      await Promise.all([writeFile(frameMapPath, frameMap, "utf8"), writeFile(manifestPath, manifest, "utf8")]);

      const result = await validateStepSkipArtifactsQuality(createExtractionStep(), [
        createState("{{shared_storage_path}}/frame-map.json", frameMapPath, Buffer.byteLength(frameMap)),
        createState("{{shared_storage_path}}/assets-manifest.json", manifestPath, Buffer.byteLength(manifest))
      ]);
      expect(result.ok).toBe(false);
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it("fails when manifest is too large for skip-cache reuse", async () => {
    const tempDir = await mkdtemp(path.join(tmpdir(), "fyreflow-design-quality-"));
    try {
      const frameMapPath = path.join(tempDir, "frame-map.json");
      const manifestPath = path.join(tempDir, "assets-manifest.json");
      const frameMap = JSON.stringify({ totalFrames: 2 });
      const oversizedPayload = "A".repeat(9 * 1024 * 1024);
      const manifest = JSON.stringify({
        frameRenders: {
          "node-1": { file: "assets/frame-1.png", width: 1920, height: 1080 }
        },
        padding: oversizedPayload
      });
      await Promise.all([writeFile(frameMapPath, frameMap, "utf8"), writeFile(manifestPath, manifest, "utf8")]);

      const result = await validateStepSkipArtifactsQuality(createExtractionStep(), [
        createState("{{shared_storage_path}}/frame-map.json", frameMapPath, Buffer.byteLength(frameMap)),
        createState("{{shared_storage_path}}/assets-manifest.json", manifestPath, Buffer.byteLength(manifest))
      ]);
      expect(result.ok).toBe(false);
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });
});
