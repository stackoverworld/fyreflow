import { describe, expect, it } from "vitest";
import { buildFlowDraft, buildFlowDraftFromExisting } from "../../server/flowBuilder/draftMapping.js";
import type { GeneratedFlowSpec } from "../../server/flowBuilder/schema.js";
import type { PipelineInput } from "../../server/types/contracts.js";

function createRequest(prompt: string) {
  return {
    prompt,
    providerId: "claude" as const,
    model: "claude-sonnet-4-6",
    reasoningEffort: "medium" as const,
    fastMode: false,
    use1MContext: false
  };
}

function createSpecWithSkipIf(): GeneratedFlowSpec {
  return {
    name: "Strict Pipeline",
    description: "desc",
    steps: [
      {
        name: "Pipeline Orchestrator",
        role: "orchestrator",
        prompt: "orchestrate"
      },
      {
        name: "PDF Content Extractor",
        role: "analysis",
        prompt: "extract",
        skipIfArtifacts: ["{{shared_storage_path}}/pdf-content.json"]
      },
      {
        name: "HTML Builder",
        role: "executor",
        prompt: "build",
        skipIfArtifacts: ["{{shared_storage_path}}/investor-deck.html"]
      }
    ],
    links: [
      { source: "Pipeline Orchestrator", target: "PDF Content Extractor", condition: "always" },
      { source: "PDF Content Extractor", target: "HTML Builder", condition: "always" }
    ],
    qualityGates: []
  };
}

function createCurrentDraft(): PipelineInput {
  return {
    name: "Current",
    description: "Current draft",
    runtime: { maxLoops: 2, maxStepExecutions: 18, stageTimeoutMs: 420000 },
    schedule: {
      enabled: false,
      cron: "",
      timezone: "UTC",
      task: "",
      runMode: "smart",
      inputs: {}
    },
    steps: [
      {
        id: "step-orch",
        name: "Pipeline Orchestrator",
        role: "orchestrator",
        prompt: "orchestrate",
        providerId: "claude",
        model: "claude-sonnet-4-6",
        reasoningEffort: "low",
        fastMode: false,
        use1MContext: false,
        contextWindowTokens: 128000,
        position: { x: 0, y: 0 },
        contextTemplate: "Task:\n{{task}}",
        enableDelegation: true,
        delegationCount: 3,
        enableIsolatedStorage: true,
        enableSharedStorage: true,
        enabledMcpServerIds: [],
        outputFormat: "markdown",
        requiredOutputFields: [],
        requiredOutputFiles: [],
        scenarios: [],
        skipIfArtifacts: []
      },
      {
        id: "step-pdf",
        name: "PDF Content Extractor",
        role: "analysis",
        prompt: "extract",
        providerId: "claude",
        model: "claude-sonnet-4-6",
        reasoningEffort: "medium",
        fastMode: false,
        use1MContext: false,
        contextWindowTokens: 128000,
        position: { x: 100, y: 100 },
        contextTemplate: "Task:\n{{task}}",
        enableDelegation: false,
        delegationCount: 1,
        enableIsolatedStorage: false,
        enableSharedStorage: true,
        enabledMcpServerIds: [],
        outputFormat: "markdown",
        requiredOutputFields: [],
        requiredOutputFiles: ["{{shared_storage_path}}/pdf-content.json"],
        scenarios: [],
        skipIfArtifacts: ["{{shared_storage_path}}/pdf-content.json"]
      }
    ],
    links: [{ id: "link-1", sourceStepId: "step-orch", targetStepId: "step-pdf", condition: "always" }],
    qualityGates: []
  };
}

describe("flow builder skip-if policy for strict runs", () => {
  it("preserves skipIfArtifacts on non-orchestrator steps for strict-order prompts", () => {
    const strictPrompt =
      "Execute stages in strict order. This step runs ALWAYS regardless of whether previous steps were cached.";
    const draft = buildFlowDraft(createSpecWithSkipIf(), createRequest(strictPrompt));

    const extractor = draft.steps.find((step) => step.name === "PDF Content Extractor");
    const builder = draft.steps.find((step) => step.name === "HTML Builder");
    expect(extractor?.skipIfArtifacts).toEqual(["{{shared_storage_path}}/pdf-content.json"]);
    expect(builder?.skipIfArtifacts).toEqual(["{{shared_storage_path}}/investor-deck.html"]);
  });

  it("preserves inherited skipIfArtifacts when updating existing flow under strict-order prompt", () => {
    const strictPrompt = "Strict order pipeline; runs every time; no cache.";
    const spec: GeneratedFlowSpec = {
      name: "Updated",
      description: "Updated",
      steps: [
        {
          name: "Pipeline Orchestrator",
          role: "orchestrator",
          prompt: "orchestrate"
        },
        {
          name: "PDF Content Extractor",
          role: "analysis",
          prompt: "extract"
        }
      ],
      links: [{ source: "Pipeline Orchestrator", target: "PDF Content Extractor", condition: "always" }],
      qualityGates: []
    };

    const draft = buildFlowDraftFromExisting(spec, createRequest(strictPrompt), createCurrentDraft());
    const extractor = draft.steps.find((step) => step.name === "PDF Content Extractor");
    expect(extractor?.skipIfArtifacts).toEqual(["{{shared_storage_path}}/pdf-content.json"]);
  });

  it("drops skipIfArtifacts for explicit full-pipeline cache bypass prompts", () => {
    const noCachePrompt = "Disable cache globally for all steps and run the entire pipeline from scratch.";
    const draft = buildFlowDraft(createSpecWithSkipIf(), createRequest(noCachePrompt));

    const extractor = draft.steps.find((step) => step.name === "PDF Content Extractor");
    const builder = draft.steps.find((step) => step.name === "HTML Builder");
    expect(extractor?.skipIfArtifacts).toEqual([]);
    expect(builder?.skipIfArtifacts).toEqual([]);
  });
});
