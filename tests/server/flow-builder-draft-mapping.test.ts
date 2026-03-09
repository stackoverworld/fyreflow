import { describe, expect, it } from "vitest";
import { buildFlowDraft, buildFlowDraftFromExisting } from "../../server/flowBuilder/draftMapping.js";
import { buildQualityGates } from "../../server/flowBuilder/draftMapping/mappers.js";
import type { DraftQualityGateSpec, DraftStepRecord } from "../../server/flowBuilder/draftMapping/contracts.js";
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

function createDraftStep(id: string, name: string, extra?: Partial<DraftStepRecord>): DraftStepRecord {
  return {
    id,
    name,
    role: "executor",
    prompt: "prompt",
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
    enableIsolatedStorage: false,
    enableSharedStorage: true,
    enabledMcpServerIds: [],
    outputFormat: "markdown",
    requiredOutputFields: [],
    requiredOutputFiles: [],
    scenarios: [],
    skipIfArtifacts: [],
    ...extra
  };
}

describe("flow builder draft mapping", () => {
  describe("delivery gate targeting", () => {
    it("keeps any_step when delivery completion gate target cannot be resolved", () => {
      const stepRecords: DraftStepRecord[] = [
        createDraftStep("step-1", "Pipeline Orchestrator"),
        createDraftStep("step-2", "HTML Reviewer"),
        createDraftStep("step-3", "Delivery")
      ];
      const qualityGates: DraftQualityGateSpec[] = [
        {
          name: "Delivery Completion Gate",
          target: "Missing Step Name",
          kind: "regex_must_match",
          pattern: "WORKFLOW_STATUS:\\s*COMPLETE",
          blocking: true
        }
      ];

      const built = buildQualityGates({ qualityGates }, stepRecords);
      expect(built[0]?.targetStepId).toBe("any_step");
    });
  });

  describe("delivery stage backfill", () => {
    it("adds Delivery step and routes completion gate when delivery stage is missing", () => {
      const spec: GeneratedFlowSpec = {
        name: "Investor Deck Pipeline",
        description: "desc",
        steps: [
          { name: "Pipeline Orchestrator", role: "orchestrator", prompt: "orchestrate" },
          { name: "HTML Reviewer", role: "review", prompt: "review html" },
          { name: "PDF Reviewer", role: "review", prompt: "review pdf" }
        ],
        links: [
          { source: "Pipeline Orchestrator", target: "HTML Reviewer", condition: "always" },
          { source: "HTML Reviewer", target: "PDF Reviewer", condition: "on_pass" }
        ],
        qualityGates: [
          {
            name: "Delivery Completion Gate",
            target: "PDF Reviewer",
            kind: "regex_must_match",
            pattern: "WORKFLOW_STATUS:\\s*COMPLETE",
            blocking: true
          }
        ]
      };

      const draft = buildFlowDraft(spec, createRequest("Build full pipeline with delivery"));
      const deliveryStep = draft.steps.find((step) => step.name === "Delivery");
      expect(deliveryStep).toBeDefined();

      const deliveryGate = draft.qualityGates?.find((gate) => gate.name === "Delivery Completion Gate");
      expect(deliveryGate?.targetStepId).toBe(deliveryStep?.id);

      const inboundDeliveryLink = draft.links.find(
        (link) => link.targetStepId === deliveryStep?.id && link.condition === "on_pass"
      );
      expect(inboundDeliveryLink).toBeDefined();
    });

    it("does not duplicate Delivery when step already exists", () => {
      const spec: GeneratedFlowSpec = {
        name: "Investor Deck Pipeline",
        description: "desc",
        steps: [
          { name: "Pipeline Orchestrator", role: "orchestrator", prompt: "orchestrate" },
          { name: "PDF Reviewer", role: "review", prompt: "review pdf" },
          { name: "Delivery", role: "executor", prompt: "deliver artifacts" }
        ],
        links: [
          { source: "Pipeline Orchestrator", target: "PDF Reviewer", condition: "always" },
          { source: "PDF Reviewer", target: "Delivery", condition: "on_pass" }
        ],
        qualityGates: [
          {
            name: "Delivery Completion Gate",
            target: "any_step",
            kind: "regex_must_match",
            pattern: "WORKFLOW_STATUS:\\s*COMPLETE",
            blocking: true
          }
        ]
      };

      const draft = buildFlowDraft(spec, createRequest("Delivery already exists"));
      const deliverySteps = draft.steps.filter((step) => step.name === "Delivery");
      expect(deliverySteps).toHaveLength(1);
    });
  });

  describe("remediation links", () => {
    it("adds self on_fail remediation routes for artifact-producing non-review steps", () => {
      const spec: GeneratedFlowSpec = {
        name: "Design Pipeline",
        description: "desc",
        steps: [
          { name: "Pipeline Orchestrator", role: "orchestrator", prompt: "route work" },
          {
            name: "Design Asset Extraction",
            role: "analysis",
            prompt: "extract assets",
            requiredOutputFiles: ["{{shared_storage_path}}/assets-manifest.json", "{{shared_storage_path}}/frame-map.json"]
          },
          {
            name: "HTML Builder",
            role: "executor",
            prompt: "build html",
            requiredOutputFiles: ["{{shared_storage_path}}/investor-deck.html"]
          }
        ],
        links: [
          { source: "Pipeline Orchestrator", target: "Design Asset Extraction", condition: "always" },
          { source: "Design Asset Extraction", target: "HTML Builder", condition: "always" }
        ],
        qualityGates: []
      };

      const draft = buildFlowDraft(spec, createRequest("build the pipeline"));
      const byName = new Map(draft.steps.map((step) => [step.name, step.id]));
      const extractorId = byName.get("Design Asset Extraction");
      const builderId = byName.get("HTML Builder");
      const orchestratorId = byName.get("Pipeline Orchestrator");

      expect(
        draft.links.some(
          (link) => link.sourceStepId === extractorId && link.targetStepId === extractorId && link.condition === "on_fail"
        )
      ).toBe(true);
      expect(
        draft.links.some(
          (link) => link.sourceStepId === builderId && link.targetStepId === builderId && link.condition === "on_fail"
        )
      ).toBe(true);
      expect(
        draft.links.some(
          (link) =>
            link.sourceStepId === orchestratorId &&
            link.targetStepId === orchestratorId &&
            link.condition === "on_fail"
        )
      ).toBe(false);
    });

    it("does not add a duplicate self-loop when an explicit on_fail route exists", () => {
      const spec: GeneratedFlowSpec = {
        name: "Design Pipeline",
        description: "desc",
        steps: [
          {
            name: "Design Asset Extraction",
            role: "analysis",
            prompt: "extract assets",
            requiredOutputFiles: ["{{shared_storage_path}}/assets-manifest.json"]
          },
          {
            name: "HTML Builder",
            role: "executor",
            prompt: "build html",
            requiredOutputFiles: ["{{shared_storage_path}}/investor-deck.html"]
          }
        ],
        links: [
          { source: "Design Asset Extraction", target: "HTML Builder", condition: "always" },
          { source: "HTML Builder", target: "Design Asset Extraction", condition: "on_fail" }
        ],
        qualityGates: []
      };

      const draft = buildFlowDraft(spec, createRequest("build the pipeline"));
      const byName = new Map(draft.steps.map((step) => [step.name, step.id]));
      const builderId = byName.get("HTML Builder");
      const extractorId = byName.get("Design Asset Extraction");
      const builderOnFailLinks = draft.links.filter((link) => link.sourceStepId === builderId && link.condition === "on_fail");

      expect(builderOnFailLinks).toHaveLength(1);
      expect(builderOnFailLinks[0]?.targetStepId).toBe(extractorId);
    });

    it("adds self on_fail remediation when blocking quality gates target a step without explicit output contracts", () => {
      const spec: GeneratedFlowSpec = {
        name: "Targeted gate pipeline",
        description: "desc",
        steps: [
          { name: "Figma Extractor", role: "analysis", prompt: "Extract figma assets into shared storage" },
          { name: "Deck Builder", role: "executor", prompt: "Build the deck" }
        ],
        links: [{ source: "Figma Extractor", target: "Deck Builder", condition: "always" }],
        qualityGates: [
          {
            name: "Figma Artifact Gate assets-manifest.json",
            target: "Figma Extractor",
            kind: "artifact_exists",
            artifactPath: "{{shared_storage_path}}/assets-manifest.json",
            blocking: true
          }
        ]
      };

      const draft = buildFlowDraft(spec, createRequest("build figma deck pipeline"));
      const byName = new Map(draft.steps.map((step) => [step.name, step.id]));
      const extractorId = byName.get("Figma Extractor");

      expect(
        draft.links.some(
          (link) => link.sourceStepId === extractorId && link.targetStepId === extractorId && link.condition === "on_fail"
        )
      ).toBe(true);
    });
  });

  describe("skip-if artifacts policy", () => {
    function createSpecWithSkipIf(): GeneratedFlowSpec {
      return {
        name: "Strict Pipeline",
        description: "desc",
        steps: [
          { name: "Pipeline Orchestrator", role: "orchestrator", prompt: "orchestrate" },
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
          { name: "Pipeline Orchestrator", role: "orchestrator", prompt: "orchestrate" },
          { name: "PDF Content Extractor", role: "analysis", prompt: "extract" }
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

  describe("semantic routing preservation", () => {
    it("preserves semantic link expressions from the current draft when links are omitted in an AI update", () => {
      const currentDraft: PipelineInput = {
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
            id: "step-fetch",
            name: "Fetch Research",
            role: "executor",
            prompt: "fetch",
            providerId: "claude",
            model: "claude-sonnet-4-6",
            reasoningEffort: "medium",
            fastMode: false,
            use1MContext: false,
            contextWindowTokens: 128000,
            position: { x: 0, y: 0 },
            contextTemplate: "Task:\n{{task}}",
            enableDelegation: false,
            delegationCount: 1,
            enableIsolatedStorage: false,
            enableSharedStorage: true,
            enabledMcpServerIds: [],
            outputFormat: "json",
            requiredOutputFields: ["status"],
            requiredOutputFiles: [],
            scenarios: [],
            skipIfArtifacts: [],
            policyProfileIds: ["deterministic_fetch"],
            cacheBypassInputKeys: [],
            cacheBypassOrchestratorPromptPatterns: []
          },
          {
            id: "step-rewrite",
            name: "Rewrite Content",
            role: "executor",
            prompt: "rewrite",
            providerId: "claude",
            model: "claude-sonnet-4-6",
            reasoningEffort: "medium",
            fastMode: false,
            use1MContext: false,
            contextWindowTokens: 128000,
            position: { x: 300, y: 0 },
            contextTemplate: "Task:\n{{task}}",
            enableDelegation: false,
            delegationCount: 1,
            enableIsolatedStorage: false,
            enableSharedStorage: true,
            enabledMcpServerIds: [],
            outputFormat: "markdown",
            requiredOutputFields: [],
            requiredOutputFiles: [],
            scenarios: [],
            skipIfArtifacts: [],
            policyProfileIds: [],
            cacheBypassInputKeys: [],
            cacheBypassOrchestratorPromptPatterns: []
          }
        ],
        links: [
          {
            id: "semantic-link",
            sourceStepId: "step-fetch",
            targetStepId: "step-rewrite",
            condition: "always",
            conditionExpression: "$.has_changes == true"
          }
        ],
        qualityGates: []
      };

      const spec: GeneratedFlowSpec = {
        name: "Updated",
        description: "Updated",
        steps: [
          { name: "Fetch Research", role: "executor", prompt: "fetch latest research" },
          { name: "Rewrite Content", role: "executor", prompt: "rewrite content" }
        ],
        qualityGates: []
      };

      const draft = buildFlowDraftFromExisting(spec, createRequest("Update the current flow."), currentDraft);
      const semanticLink = draft.links.find(
        (link) =>
          link.sourceStepId === "step-fetch" &&
          link.targetStepId === "step-rewrite" &&
          link.conditionExpression === "$.has_changes == true"
      );

      expect(semanticLink).toBeDefined();
    });
  });

  describe("sandbox mode inference", () => {
    it("keeps publish/network steps in secure mode unless full access is explicit", () => {
      const spec: GeneratedFlowSpec = {
        name: "Publish pipeline",
        description: "desc",
        steps: [
          {
            name: "GitLab Publisher",
            role: "executor",
            prompt: "Publish artifacts with curl https://gitlab.com/api/v4/projects/{{input.gitlab_project_id}}"
          }
        ],
        links: [],
        qualityGates: []
      };

      const draft = buildFlowDraft(spec, createRequest("publish site updates"));
      expect(draft.steps[0]?.sandboxMode).toBe("secure");
    });

    it("defaults local-only executor steps to secure mode", () => {
      const spec: GeneratedFlowSpec = {
        name: "Local pipeline",
        description: "desc",
        steps: [
          {
            name: "Markdown Formatter",
            role: "executor",
            prompt: "Normalize markdown sections and write {{shared_storage_path}}/source.md"
          }
        ],
        links: [],
        qualityGates: []
      };

      const draft = buildFlowDraft(spec, createRequest("format local markdown"));
      expect(draft.steps[0]?.sandboxMode).toBe("secure");
    });
  });

  describe("edge cases", () => {
    it("handles spec with zero steps gracefully", () => {
      const spec: GeneratedFlowSpec = {
        name: "Empty Pipeline",
        description: "desc",
        steps: [],
        links: [],
        qualityGates: []
      };

      const draft = buildFlowDraft(spec, createRequest("empty pipeline"));
      expect(draft.steps).toBeDefined();
      expect(draft.links).toBeDefined();
    });

    it("handles delivery gate targeting a nonexistent step ID", () => {
      const stepRecords: DraftStepRecord[] = [
        createDraftStep("step-1", "Orchestrator"),
        createDraftStep("step-2", "Builder")
      ];
      const qualityGates: DraftQualityGateSpec[] = [
        {
          name: "Delivery Completion Gate",
          target: "nonexistent-step-that-does-not-exist",
          kind: "regex_must_match",
          pattern: "WORKFLOW_STATUS:\\s*COMPLETE",
          blocking: true
        }
      ];

      const built = buildQualityGates({ qualityGates }, stepRecords);
      expect(built[0]?.targetStepId).toBe("any_step");
    });

    it("handles steps with conflicting link targets", () => {
      const spec: GeneratedFlowSpec = {
        name: "Conflict Pipeline",
        description: "desc",
        steps: [
          { name: "Step A", role: "executor", prompt: "do A" },
          { name: "Step B", role: "executor", prompt: "do B" }
        ],
        links: [
          { source: "Step A", target: "Step B", condition: "on_pass" },
          { source: "Step A", target: "Step B", condition: "on_fail" }
        ],
        qualityGates: []
      };

      const draft = buildFlowDraft(spec, createRequest("conflicting links"));
      const aToB = draft.links.filter(
        (link) => {
          const sourceStep = draft.steps.find((s) => s.id === link.sourceStepId);
          const targetStep = draft.steps.find((s) => s.id === link.targetStepId);
          return sourceStep?.name === "Step A" && targetStep?.name === "Step B";
        }
      );
      expect(aToB.length).toBeGreaterThanOrEqual(2);
    });
  });
});
