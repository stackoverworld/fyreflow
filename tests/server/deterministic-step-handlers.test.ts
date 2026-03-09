import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { runPipeline } from "../../server/runner.js";
import type { Pipeline, PipelineStep } from "../../server/types/contracts.js";
import { createTempStore } from "../helpers/tempStore.js";

function createStep(
  id: string,
  name: string,
  role: PipelineStep["role"],
  prompt: string,
  extra?: Partial<PipelineStep>
): PipelineStep {
  return {
    id,
    name,
    role,
    prompt,
    providerId: "openai",
    model: "gpt-5.4",
    reasoningEffort: "medium",
    fastMode: false,
    use1MContext: false,
    contextWindowTokens: 128_000,
    position: { x: 0, y: 0 },
    contextTemplate: "",
    enableDelegation: false,
    delegationCount: 1,
    enableIsolatedStorage: false,
    enableSharedStorage: true,
    enabledMcpServerIds: [],
    sandboxMode: "secure",
    outputFormat: "json",
    requiredOutputFields: [],
    requiredOutputFiles: [],
    scenarios: [],
    skipIfArtifacts: [],
    policyProfileIds: [],
    cacheBypassInputKeys: [],
    cacheBypassOrchestratorPromptPatterns: [],
    ...extra
  };
}

describe("deterministic step handlers", () => {
  const tempDirs: string[] = [];

  afterEach(async () => {
    vi.restoreAllMocks();
    while (tempDirs.length > 0) {
      const next = tempDirs.pop();
      if (next) {
        await rm(next, { recursive: true, force: true });
      }
    }
  });

  it("runs fetch, diff, and publish without provider execution", async () => {
    const { store, cleanup } = await createTempStore();
    const workspaceDir = await mkdtemp(path.join(os.tmpdir(), "fyreflow-deterministic-"));
    tempDirs.push(workspaceDir);
    const outputDir = path.join(workspaceDir, "out");
    const researchPath = path.join(workspaceDir, "research.txt");
    const currentPath = path.join(workspaceDir, "current.txt");
    await writeFile(researchPath, "fresh research content", "utf8");
    await writeFile(currentPath, "old site content", "utf8");

    const basePipeline = store.listPipelines()[0];
    const fetchStep = createStep(
      "fetch",
      "Fetch Source",
      "analysis",
      JSON.stringify(
        {
          sources: [
            { from: "{{input.research_path}}", to: "{{shared_storage_path}}/research.txt" },
            { from: "{{input.current_path}}", to: "{{shared_storage_path}}/current.txt" }
          ]
        },
        null,
        2
      ),
      {
        policyProfileIds: ["deterministic_fetch"],
        requiredOutputFields: ["fetched_count", "status"],
        requiredOutputFiles: ["{{shared_storage_path}}/research.txt", "{{shared_storage_path}}/current.txt"]
      }
    );
    const diffStep = createStep(
      "diff",
      "Diff Source",
      "analysis",
      JSON.stringify(
        {
          comparisons: [
            {
              previous: "{{shared_storage_path}}/current.txt",
              next: "{{shared_storage_path}}/research.txt",
              target: "{{shared_storage_path}}/diff-summary.json"
            }
          ]
        },
        null,
        2
      ),
      {
        policyProfileIds: ["deterministic_diff"],
        requiredOutputFields: ["has_changes", "changed_count"],
        requiredOutputFiles: ["{{shared_storage_path}}/diff-summary.json"]
      }
    );
    const publishStep = createStep(
      "publish",
      "Publish Source",
      "executor",
      JSON.stringify(
        {
          actions: [{ from: "{{shared_storage_path}}/research.txt", to: "{{input.output_dir}}/site.txt" }]
        },
        null,
        2
      ),
      {
        policyProfileIds: ["deterministic_publish"],
        requiredOutputFields: ["published_count", "status"]
      }
    );

    const pipeline: Pipeline = {
      ...basePipeline,
      id: `${basePipeline.id}-deterministic-pipeline`,
      steps: [fetchStep, diffStep, publishStep],
      links: [
        { id: "l1", sourceStepId: fetchStep.id, targetStepId: diffStep.id, condition: "always" },
        {
          id: "l2",
          sourceStepId: diffStep.id,
          targetStepId: publishStep.id,
          condition: "always",
          conditionExpression: "$.has_changes == true"
        }
      ],
      runtime: { ...basePipeline.runtime, maxLoops: 1, maxStepExecutions: 6 }
    };

    const run = store.createRun(pipeline, "deterministic pipeline");
    try {
      await runPipeline({
        store,
        runId: run.id,
        pipeline,
        task: run.task,
        runInputs: {
          research_path: researchPath,
          current_path: currentPath,
          output_dir: outputDir
        }
      });

      const published = await readFile(path.join(outputDir, "site.txt"), "utf8");
      expect(published).toBe("fresh research content");

      const completedRun = store.getRun(run.id);
      expect(completedRun?.status).toBe("completed");
      expect(completedRun?.steps.find((step) => step.stepId === diffStep.id)?.output).toContain('"has_changes": true');
      expect(completedRun?.steps.find((step) => step.stepId === publishStep.id)?.output).toContain('"published_count": 1');
    } finally {
      await cleanup();
    }
  });

  it("does not disconnected-fallback into semantic publish branch when diff reports no changes", async () => {
    const { store, cleanup } = await createTempStore();
    const workspaceDir = await mkdtemp(path.join(os.tmpdir(), "fyreflow-deterministic-nochange-"));
    tempDirs.push(workspaceDir);
    const outputDir = path.join(workspaceDir, "out");
    const researchPath = path.join(workspaceDir, "research.txt");
    const currentPath = path.join(workspaceDir, "current.txt");
    await writeFile(researchPath, "same content", "utf8");
    await writeFile(currentPath, "same content", "utf8");

    const basePipeline = store.listPipelines()[0];
    const pipeline: Pipeline = {
      ...basePipeline,
      id: `${basePipeline.id}-deterministic-nochange`,
      steps: [
        createStep(
          "fetch",
          "Fetch Source",
          "analysis",
          JSON.stringify(
            {
              sources: [
                { from: "{{input.research_path}}", to: "{{shared_storage_path}}/research.txt" },
                { from: "{{input.current_path}}", to: "{{shared_storage_path}}/current.txt" }
              ]
            },
            null,
            2
          ),
          {
            policyProfileIds: ["deterministic_fetch"]
          }
        ),
        createStep(
          "diff",
          "Diff Source",
          "analysis",
          JSON.stringify(
            {
              comparisons: [
                {
                  previous: "{{shared_storage_path}}/current.txt",
                  next: "{{shared_storage_path}}/research.txt"
                }
              ]
            },
            null,
            2
          ),
          {
            policyProfileIds: ["deterministic_diff"],
            requiredOutputFields: ["has_changes"]
          }
        ),
        createStep(
          "publish",
          "Publish Source",
          "executor",
          JSON.stringify(
            {
              actions: [{ from: "{{shared_storage_path}}/research.txt", to: "{{input.output_dir}}/site.txt" }]
            },
            null,
            2
          ),
          {
            policyProfileIds: ["deterministic_publish"]
          }
        )
      ],
      links: [
        { id: "l1", sourceStepId: "fetch", targetStepId: "diff", condition: "always" },
        {
          id: "l2",
          sourceStepId: "diff",
          targetStepId: "publish",
          condition: "always",
          conditionExpression: "$.has_changes == true"
        }
      ],
      runtime: { ...basePipeline.runtime, maxLoops: 1, maxStepExecutions: 6 }
    };

    const run = store.createRun(pipeline, "deterministic no-change");
    try {
      await runPipeline({
        store,
        runId: run.id,
        pipeline,
        task: run.task,
        runInputs: {
          research_path: researchPath,
          current_path: currentPath,
          output_dir: outputDir
        }
      });

      await expect(stat(path.join(outputDir, "site.txt"))).rejects.toThrow();
      const completedRun = store.getRun(run.id);
      expect(completedRun?.status).toBe("completed");
      expect(completedRun?.steps.find((step) => step.stepId === "publish")?.attempts ?? 0).toBe(0);
    } finally {
      await cleanup();
    }
  });
});
