import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import {
  buildProfileArtifactContractResults,
  buildUnexpectedScriptMutationResults,
  buildImmutableArtifactMutationResults,
  buildRequiredArtifactFreshnessResults,
  resolveImmutableArtifactTemplatesForStep
} from "../../server/runner/execution.js";
import type { PipelineStep } from "../../server/types/contracts.js";
import type { ArtifactStateCheck } from "../../server/runner/artifacts.js";
import type { ScriptArtifactSnapshot } from "../../server/runner/execution.js";

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
    skipIfArtifacts: [],
    policyProfileIds: [],
    cacheBypassInputKeys: [],
    cacheBypassOrchestratorPromptPatterns: []
  };
}

function createSnapshot(partial: Partial<ArtifactStateCheck> = {}): ArtifactStateCheck {
  return {
    template: "{{shared_storage_path}}/investor-deck.html",
    disabledStorage: false,
    paths: ["/tmp/investor-deck.html"],
    foundPath: "/tmp/investor-deck.html",
    exists: true,
    mtimeMs: 1000,
    sizeBytes: 100,
    ...partial
  };
}

function createScriptSnapshot(partial: Partial<ScriptArtifactSnapshot> = {}): ScriptArtifactSnapshot {
  return {
    normalizedPath: "/tmp/build-deck.py",
    basename: "build-deck.py",
    mtimeMs: 1000,
    sizeBytes: 120,
    ...partial
  };
}

describe("required artifact freshness gates", () => {
  it("passes when artifact exists and is already up-to-date", () => {
    const step = createStep();
    const before = [createSnapshot({ mtimeMs: 1000, sizeBytes: 100 })];
    const after = [createSnapshot({ mtimeMs: 1000, sizeBytes: 100 })];

    const results = buildRequiredArtifactFreshnessResults(step, before, after);
    expect(results).toHaveLength(1);
    expect(results[0]?.status).toBe("pass");
    expect(results[0]?.message).toContain("already up-to-date");
  });

  it("passes when artifact mtime changes in the attempt", () => {
    const step = createStep();
    const before = [createSnapshot({ mtimeMs: 1000, sizeBytes: 100 })];
    const after = [createSnapshot({ mtimeMs: 2000, sizeBytes: 100 })];

    const results = buildRequiredArtifactFreshnessResults(step, before, after);
    expect(results).toHaveLength(1);
    expect(results[0]?.status).toBe("pass");
  });
});

describe("immutable artifact guards", () => {
  const createStructuralStep = (): PipelineStep => ({
    ...createStep(),
    id: "step-design-assets",
    name: "Design Asset Extraction",
    role: "analysis",
    requiredOutputFiles: [
      "{{shared_storage_path}}/ui-kit.json",
      "{{shared_storage_path}}/assets-manifest.json",
      "{{shared_storage_path}}/frame-map.json",
      "{{shared_storage_path}}/pdf-content.json"
    ]
  });

  const createRemediatorStep = (): PipelineStep => ({
    ...createStep(),
    id: "step-remediator",
    name: "HTML Remediator",
    role: "executor",
    requiredOutputFiles: ["{{shared_storage_path}}/investor-deck.html"]
  });

  it("monitors structural artifacts for downstream non-owner steps", () => {
    const designExtractor = createStructuralStep();
    const remediator = createRemediatorStep();
    const stepById = new Map<string, PipelineStep>([
      [designExtractor.id, designExtractor],
      [remediator.id, remediator]
    ]);

    const templates = resolveImmutableArtifactTemplatesForStep(stepById, remediator);
    expect(templates).toContain("{{shared_storage_path}}/frame-map.json");
    expect(templates).toContain("{{shared_storage_path}}/ui-kit.json");
    expect(templates).not.toContain("{{shared_storage_path}}/investor-deck.html");
  });

  it("does not monitor structural artifact writes for the owner step", () => {
    const designExtractor = createStructuralStep();
    const remediator = createRemediatorStep();
    const stepById = new Map<string, PipelineStep>([
      [designExtractor.id, designExtractor],
      [remediator.id, remediator]
    ]);

    const templates = resolveImmutableArtifactTemplatesForStep(stepById, designExtractor);
    expect(templates).toEqual([]);
  });

  it("fails when a downstream step mutates a protected artifact", () => {
    const remediator = createRemediatorStep();
    const before: ArtifactStateCheck[] = [
      {
        template: "{{shared_storage_path}}/frame-map.json",
        disabledStorage: false,
        paths: ["/tmp/frame-map.json"],
        foundPath: "/tmp/frame-map.json",
        exists: true,
        mtimeMs: 10,
        sizeBytes: 500
      }
    ];
    const after: ArtifactStateCheck[] = [
      {
        template: "{{shared_storage_path}}/frame-map.json",
        disabledStorage: false,
        paths: ["/tmp/frame-map.json"],
        foundPath: "/tmp/frame-map.json",
        exists: true,
        mtimeMs: 40,
        sizeBytes: 700
      }
    ];

    const results = buildImmutableArtifactMutationResults(remediator, before, after);
    expect(results).toHaveLength(1);
    expect(results[0]?.status).toBe("fail");
    expect(results[0]?.message).toContain("frame-map.json");
  });
});

describe("unexpected helper script guard", () => {
  it("fails when a non-declared script file is created", () => {
    const step = createStep();
    const results = buildUnexpectedScriptMutationResults(step, [], [createScriptSnapshot()]);
    expect(results).toHaveLength(1);
    expect(results[0]?.status).toBe("fail");
    expect(results[0]?.message).toContain("helper script files");
  });

  it("passes when script output is explicitly declared", () => {
    const step: PipelineStep = {
      ...createStep(),
      requiredOutputFiles: ["{{shared_storage_path}}/build-deck.py"]
    };

    const results = buildUnexpectedScriptMutationResults(step, [], [createScriptSnapshot()]);
    expect(results).toHaveLength(0);
  });

  it("passes when non-declared script is unchanged", () => {
    const step = createStep();
    const before = [createScriptSnapshot({ mtimeMs: 1000, sizeBytes: 120 })];
    const after = [createScriptSnapshot({ mtimeMs: 1000, sizeBytes: 120 })];
    const results = buildUnexpectedScriptMutationResults(step, before, after);
    expect(results).toHaveLength(0);
  });
});

describe("design asset manifest contract guard", () => {
  const createDesignAssetStep = (): PipelineStep => ({
    ...createStep(),
    id: "step-design-assets",
    name: "Design Asset Extraction",
    role: "analysis",
    requiredOutputFiles: [
      "{{shared_storage_path}}/ui-kit.json",
      "{{shared_storage_path}}/assets-manifest.json",
      "{{shared_storage_path}}/frame-map.json"
    ],
    policyProfileIds: ["design_deck_assets"]
  });

  const createManifestSnapshot = (foundPath: string, sizeBytes: number): ArtifactStateCheck => ({
    template: "{{shared_storage_path}}/assets-manifest.json",
    disabledStorage: false,
    paths: [foundPath],
    foundPath,
    exists: true,
    mtimeMs: Date.now(),
    sizeBytes
  });

  const createFrameMapSnapshot = (foundPath: string, sizeBytes: number): ArtifactStateCheck => ({
    template: "{{shared_storage_path}}/frame-map.json",
    disabledStorage: false,
    paths: [foundPath],
    foundPath,
    exists: true,
    mtimeMs: Date.now(),
    sizeBytes
  });

  it("fails when assets-manifest is oversized", async () => {
    const step = createDesignAssetStep();
    const tempDir = await mkdtemp(path.join(tmpdir(), "fyreflow-design-manifest-"));
    const manifestPath = path.join(tempDir, "assets-manifest.json");
    const oversized = JSON.stringify({ padding: "A".repeat(9 * 1024 * 1024) });
    try {
      await writeFile(manifestPath, oversized, "utf8");
      const results = await buildProfileArtifactContractResults(step, [
        createManifestSnapshot(manifestPath, Buffer.byteLength(oversized))
      ]);
      expect(results).toHaveLength(1);
      expect(results[0]?.status).toBe("fail");
      expect(results[0]?.message).toContain("too large");
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it("normalizes inline base64 manifest payloads into file-backed assets", async () => {
    const step = createDesignAssetStep();
    const tempDir = await mkdtemp(path.join(tmpdir(), "fyreflow-design-manifest-"));
    const manifestPath = path.join(tempDir, "assets-manifest.json");
    const inlineManifest = JSON.stringify({
      frames: [{ frameId: "frame-1", backgroundImageBase64: "data:image/png;base64,AAAA" }]
    });
    try {
      await writeFile(manifestPath, inlineManifest, "utf8");
      const results = await buildProfileArtifactContractResults(step, [
        createManifestSnapshot(manifestPath, Buffer.byteLength(inlineManifest))
      ]);
      expect(results).toHaveLength(0);
      const normalizedManifest = await readFile(manifestPath, "utf8");
      expect(normalizedManifest).not.toContain("backgroundImageBase64");
      expect(normalizedManifest).toContain("\"file\": \"assets/frame-inline-1.png\"");
      const writtenAsset = await stat(path.join(tempDir, "assets", "frame-inline-1.png"));
      expect(writtenAsset.size).toBeGreaterThan(0);
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it("fails when frame-map still has no recoverable frame count", async () => {
    const step = createDesignAssetStep();
    const tempDir = await mkdtemp(path.join(tmpdir(), "fyreflow-design-manifest-"));
    const manifestPath = path.join(tempDir, "assets-manifest.json");
    const frameMapPath = path.join(tempDir, "frame-map.json");
    const manifest = JSON.stringify({
      frames: [{ frameId: "frame-1", background: { file: "assets/frame-1.png", mime: "image/png" } }]
    });
    const frameMap = JSON.stringify({ metadata: { source: "figma" } });
    try {
      await Promise.all([writeFile(manifestPath, manifest, "utf8"), writeFile(frameMapPath, frameMap, "utf8")]);
      const results = await buildProfileArtifactContractResults(step, [
        createManifestSnapshot(manifestPath, Buffer.byteLength(manifest)),
        createFrameMapSnapshot(frameMapPath, Buffer.byteLength(frameMap))
      ]);
      expect(results.some((result) => result.gateName === "Design frame map includes frame count")).toBe(true);
      expect(results.some((result) => result.status === "fail")).toBe(true);
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it("fails when manifest has no reusable file references", async () => {
    const step = createDesignAssetStep();
    const tempDir = await mkdtemp(path.join(tmpdir(), "fyreflow-design-manifest-"));
    const manifestPath = path.join(tempDir, "assets-manifest.json");
    const manifest = JSON.stringify({
      frames: [{ frameId: "frame-1", background: { mime: "image/png" } }]
    });
    try {
      await writeFile(manifestPath, manifest, "utf8");
      const results = await buildProfileArtifactContractResults(step, [
        createManifestSnapshot(manifestPath, Buffer.byteLength(manifest))
      ]);
      expect(results).toHaveLength(1);
      expect(results[0]?.status).toBe("fail");
      expect(results[0]?.message).toContain("file references");
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it("passes for compact file-based manifest", async () => {
    const step = createDesignAssetStep();
    const tempDir = await mkdtemp(path.join(tmpdir(), "fyreflow-design-manifest-"));
    const manifestPath = path.join(tempDir, "assets-manifest.json");
    const manifest = JSON.stringify({
      frames: [{ frameId: "frame-1", background: { file: "assets/frame-1.png", mime: "image/png" } }]
    });
    try {
      await writeFile(manifestPath, manifest, "utf8");
      const results = await buildProfileArtifactContractResults(step, [
        createManifestSnapshot(manifestPath, Buffer.byteLength(manifest))
      ]);
      expect(results).toHaveLength(0);
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });
});
