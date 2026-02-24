import { describe, expect, it } from "vitest";
import { buildFlowDraft } from "../../server/flowBuilder/draftMapping.js";
import type { GeneratedFlowSpec } from "../../server/flowBuilder/schema.js";

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

describe("flow builder remediation links", () => {
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
        {
          name: "Figma Extractor",
          role: "analysis",
          prompt: "Extract figma assets into shared storage"
        },
        {
          name: "Deck Builder",
          role: "executor",
          prompt: "Build the deck"
        }
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
