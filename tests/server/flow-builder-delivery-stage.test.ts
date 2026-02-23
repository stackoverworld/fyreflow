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

describe("flow builder delivery stage backfill", () => {
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

