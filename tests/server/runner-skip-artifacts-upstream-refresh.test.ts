import fs from "node:fs/promises";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";

import { runPipeline } from "../../server/runner.js";
import type { Pipeline, PipelineLink, PipelineStep } from "../../server/types/contracts.js";
import { createTempStore } from "../helpers/tempStore.js";

const executedStepIds: string[] = [];

vi.mock("../../server/runner/stepExecution.js", () => ({
  executeStepForPipeline: async (input: { step: PipelineStep; outgoingLinks: PipelineLink[] }) => {
    executedStepIds.push(input.step.id);
    return {
      status: "success",
      stepExecution: {
        output: `${input.step.name} executed`,
        qualityGateResults: [],
        hasBlockingGateFailure: false,
        shouldStopForInput: false,
        workflowOutcome: "pass",
        outgoingLinks: input.outgoingLinks,
        routedLinks: input.outgoingLinks,
        subagentNotes: []
      }
    };
  }
}));

function createStep(
  id: string,
  name: string,
  role: PipelineStep["role"],
  prompt: string,
  skipIfArtifacts: string[],
  requiredOutputFiles: string[],
  overrides: Partial<PipelineStep> = {}
): PipelineStep {
  return {
    id,
    name,
    role,
    prompt,
    providerId: "claude",
    model: "claude-sonnet-4-6",
    reasoningEffort: "medium",
    fastMode: false,
    use1MContext: false,
    contextWindowTokens: 128_000,
    position: { x: 0, y: 0 },
    contextTemplate: "Task:\n{{task}}",
    enableDelegation: role === "orchestrator",
    delegationCount: role === "orchestrator" ? 3 : 1,
    enableIsolatedStorage: false,
    enableSharedStorage: true,
    enabledMcpServerIds: [],
    outputFormat: "markdown",
    requiredOutputFields: [],
    requiredOutputFiles,
    scenarios: [],
    skipIfArtifacts,
    policyProfileIds: [],
    cacheBypassInputKeys: [],
    cacheBypassOrchestratorPromptPatterns: [],
    ...overrides
  };
}

describe("Runner skip-if artifact invalidation", () => {
  it("keeps design extraction cached, forces PDF content extraction, and invalidates downstream HTML cache in the same run", async () => {
    executedStepIds.length = 0;
    const { store, cleanup } = await createTempStore();
    const tempStorageRoot = await mkdtemp(path.join(tmpdir(), "fyreflow-storage-"));

    try {
      store.updateStorageConfig({ rootPath: tempStorageRoot });
      const storage = store.getState().storage;

      const orchestratorPrompt = [
        "You manage the full design->HTML->PDF pipeline.",
        "2) PDF CONTENT EXTRACTION — delegate to PDF Content Extractor.",
        "This step runs ALWAYS regardless of whether Design Asset Extraction was skipped."
      ].join("\n");

      const pipelineId = "pipeline-skip-policy";
      const steps: PipelineStep[] = [
        createStep("step-orchestrator", "Pipeline Orchestrator", "orchestrator", orchestratorPrompt, [], []),
        createStep(
          "step-design-assets",
          "Design Asset Extraction",
          "analysis",
          "Extract reusable design assets.",
          [
            "{{shared_storage_path}}/ui-kit.json",
            "{{shared_storage_path}}/dev-code.json",
            "{{shared_storage_path}}/assets-manifest.json",
            "{{shared_storage_path}}/frame-map.json"
          ],
          [
            "{{shared_storage_path}}/ui-kit.json",
            "{{shared_storage_path}}/dev-code.json",
            "{{shared_storage_path}}/assets-manifest.json",
            "{{shared_storage_path}}/frame-map.json"
          ],
          {
            policyProfileIds: ["design_deck_assets"]
          }
        ),
        createStep(
          "step-pdf",
          "PDF Content Extractor",
          "analysis",
          "Extract source content from source.pdf into pdf-content.json.",
          ["{{shared_storage_path}}/pdf-content.json"],
          ["{{shared_storage_path}}/pdf-content.json"],
          {
            cacheBypassOrchestratorPromptPatterns: [
              "pdf\\s+content\\s+extract(?:ion|or)[\\s\\S]{0,280}(?:runs?\\s+always|always\\s+regardless|must\\s+run\\s+always)",
              "(?:runs?\\s+always|always\\s+regardless|must\\s+run\\s+always)[\\s\\S]{0,280}pdf\\s+content\\s+extract(?:ion|or)"
            ]
          }
        ),
        createStep(
          "step-html",
          "HTML Builder",
          "executor",
          "Build investor-deck.html from ui-kit.json and pdf-content.json.",
          ["{{shared_storage_path}}/investor-deck.html"],
          ["{{shared_storage_path}}/investor-deck.html"]
        )
      ];

      const pipeline: Pipeline = {
        ...store.listPipelines()[0],
        id: pipelineId,
        name: "Skip Policy Pipeline",
        steps,
        links: [
          { id: "l1", sourceStepId: "step-orchestrator", targetStepId: "step-design-assets", condition: "always" },
          { id: "l2", sourceStepId: "step-design-assets", targetStepId: "step-pdf", condition: "always" },
          { id: "l3", sourceStepId: "step-pdf", targetStepId: "step-html", condition: "always" }
        ],
        qualityGates: [],
        runtime: {
          maxLoops: 1,
          maxStepExecutions: 10,
          stageTimeoutMs: 180_000
        }
      };

      const sharedRoot = path.join(storage.rootPath, storage.sharedFolder, pipelineId);
      await fs.mkdir(sharedRoot, { recursive: true });
      await fs.writeFile(path.join(sharedRoot, "ui-kit.json"), "{}\n");
      await fs.writeFile(path.join(sharedRoot, "dev-code.json"), "{}\n");
      const assetsManifestPayload = {
        frameRenders: {
          "node-1": { file: "assets/frame-1.png", width: 1440, height: 900 }
        },
        imageFills: {}
      };
      await fs.writeFile(
        path.join(sharedRoot, "assets-manifest.json"),
        `${JSON.stringify(assetsManifestPayload, null, 2)}\n`
      );
      const frameMapPayload = {
        totalFrames: 12,
        frames: Array.from({ length: 12 }, (_, index) => ({
          id: `frame-${index + 1}`,
          name: `Frame ${index + 1}`,
          nodeId: `node-${index + 1}`,
          width: 1440,
          height: 900
        }))
      };
      await fs.writeFile(path.join(sharedRoot, "frame-map.json"), `${JSON.stringify(frameMapPayload, null, 2)}\n`);
      await fs.writeFile(path.join(sharedRoot, "pdf-content.json"), "{}\n");
      await fs.writeFile(path.join(sharedRoot, "investor-deck.html"), "<html></html>\n");

      const run = store.createRun(pipeline, "Skip policy validation");
      await runPipeline({
        store,
        runId: run.id,
        pipeline,
        task: run.task
      });

      const completedRun = store.getRun(run.id);
      expect(completedRun?.status).toBe("completed");
      expect(executedStepIds).toContain("step-orchestrator");
      expect(executedStepIds).not.toContain("step-design-assets");
      expect(executedStepIds).toContain("step-pdf");
      expect(executedStepIds).toContain("step-html");
      const designStepRun = completedRun?.steps.find((step) => step.stepId === "step-design-assets");
      expect(designStepRun?.output).toContain("STEP_STATUS: SKIPPED");
      expect(designStepRun?.triggeredByStepId).toBe("step-orchestrator");
      expect(designStepRun?.triggeredByReason).toBe("route");
      expect(
        completedRun?.logs.some((line) =>
          line.includes("Skip-if disabled for PDF Content Extractor") &&
          line.includes("orchestrator prompt matched step cache-bypass pattern")
        )
      ).toBe(true);
      expect(
        completedRun?.logs.some((line) =>
          line.includes("Skip-if disabled for HTML Builder") &&
          line.includes("upstream steps produced fresh artifacts in this run (PDF Content Extractor)")
        )
      ).toBe(true);
      expect(
        completedRun?.logs.some((line) => line.includes("Skipped Design Asset Extraction: all skip-if artifacts already exist"))
      ).toBe(true);
    } finally {
      await rm(tempStorageRoot, { recursive: true, force: true });
      await cleanup();
    }
  });
});
