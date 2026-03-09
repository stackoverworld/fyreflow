import { describe, expect, it } from "vitest";
import { buildFlowDraft, buildFlowDraftFromExisting } from "../../server/flowBuilder/draftMapping.js";
import type { GeneratedFlowSpec } from "../../server/flowBuilder/schema.js";
import type { PipelineInput, PipelineStep } from "../../server/types/contracts.js";

function createRequest(prompt: string) {
  return {
    prompt,
    providerId: "openai" as const,
    model: "gpt-5.4",
    reasoningEffort: "medium" as const,
    fastMode: false,
    use1MContext: false
  };
}

function createStep(overrides: Partial<PipelineStep>): PipelineStep {
  return {
    id: overrides.id ?? "step-id",
    name: overrides.name ?? "Step",
    role: overrides.role ?? "executor",
    prompt: overrides.prompt ?? "Execute task",
    providerId: overrides.providerId ?? "claude",
    model: overrides.model ?? "claude-sonnet-4-6",
    reasoningEffort: overrides.reasoningEffort ?? "medium",
    fastMode: overrides.fastMode ?? false,
    use1MContext: overrides.use1MContext ?? false,
    contextWindowTokens: overrides.contextWindowTokens ?? 200000,
    position: overrides.position ?? { x: 80, y: 120 },
    contextTemplate: overrides.contextTemplate ?? "Task:\n{{task}}",
    enableDelegation: overrides.enableDelegation ?? false,
    delegationCount: overrides.delegationCount ?? 1,
    enableIsolatedStorage: overrides.enableIsolatedStorage ?? false,
    enableSharedStorage: overrides.enableSharedStorage ?? true,
    enabledMcpServerIds: overrides.enabledMcpServerIds ?? [],
    outputFormat: overrides.outputFormat ?? "markdown",
    requiredOutputFields: overrides.requiredOutputFields ?? [],
    requiredOutputFiles: overrides.requiredOutputFiles ?? [],
    scenarios: overrides.scenarios ?? [],
    skipIfArtifacts: overrides.skipIfArtifacts ?? [],
    policyProfileIds: overrides.policyProfileIds ?? [],
    cacheBypassInputKeys: overrides.cacheBypassInputKeys ?? [],
    cacheBypassOrchestratorPromptPatterns: overrides.cacheBypassOrchestratorPromptPatterns ?? []
  };
}

function createCurrentDraft(): PipelineInput {
  const planner = createStep({
    id: "planner-1",
    name: "Architecture Planner",
    role: "planner",
    prompt: "Plan the roadmap and milestones",
    providerId: "claude",
    model: "claude-opus-4-6",
    reasoningEffort: "high",
    contextWindowTokens: 200000,
    position: { x: 80, y: 120 }
  });
  const api = createStep({
    id: "api-1",
    name: "API Implementation",
    role: "executor",
    prompt: "Implement the TypeScript API endpoint logic",
    providerId: "claude",
    model: "claude-opus-4-6",
    reasoningEffort: "high",
    contextWindowTokens: 200000,
    position: { x: 360, y: 120 }
  });
  const research = createStep({
    id: "research-1",
    name: "Web Research Analyst",
    role: "analysis",
    prompt: "Research competitive products and gather sources",
    providerId: "claude",
    model: "claude-opus-4-6",
    reasoningEffort: "high",
    contextWindowTokens: 200000,
    position: { x: 640, y: 120 }
  });

  return {
    name: "Current mixed draft",
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
    steps: [planner, api, research],
    links: [
      {
        id: "link-1",
        sourceStepId: planner.id,
        targetStepId: api.id,
        condition: "always"
      }
    ],
    qualityGates: []
  };
}

describe("flow builder smart step model routing", () => {
  it("keeps generic generated steps on the OpenAI-first route and utility classifiers on Haiku", () => {
    const spec: GeneratedFlowSpec = {
      name: "Task-Routed Pipeline",
      description: "desc",
      steps: [
        { name: "Architecture Planner", role: "planner", prompt: "Plan scope, milestones, and roadmap." },
        { name: "Main Orchestrator", role: "orchestrator", prompt: "Coordinate and route work across agents." },
        {
          name: "API Implementation",
          role: "executor",
          prompt: "Implement backend TypeScript code for API handlers and tests."
        },
        {
          name: "Landing Page Builder",
          role: "executor",
          prompt: "Build a landing page UI using React and Tailwind CSS."
        },
        {
          name: "Web Research Analyst",
          role: "analysis",
          prompt: "Run web research, collect sources, and summarize findings."
        },
        {
          name: "Issue Classifier",
          role: "executor",
          prompt: "Classify support tickets into a small set of labels and tag severity."
        }
      ],
      links: [],
      qualityGates: []
    };

    const draft = buildFlowDraft(spec, createRequest("Create a full pipeline with coding, design, and research."));

    for (const step of draft.steps.filter((entry) => entry.name !== "Issue Classifier")) {
      expect(step.providerId).toBe("openai");
      expect(step.model).toBe("gpt-5.4");
      expect(step.reasoningEffort).toBe("medium");
      expect(step.fastMode).toBe(false);
    }

    expect(draft.steps.find((step) => step.name === "Issue Classifier")?.providerId).toBe("claude");
    expect(draft.steps.find((step) => step.name === "Issue Classifier")?.model).toBe("claude-haiku-4-5");
  });

  it("re-routes existing drafts back to the OpenAI-first route for generic work", () => {
    const spec: GeneratedFlowSpec = {
      name: "Updated Task-Routed Pipeline",
      description: "desc",
      steps: [
        { name: "Architecture Planner", role: "planner", prompt: "Plan milestones and execution strategy." },
        { name: "API Implementation", role: "executor", prompt: "Implement backend TypeScript service code." },
        {
          name: "Web Research Analyst",
          role: "analysis",
          prompt: "Perform web research and collect source references."
        }
      ],
      links: [],
      qualityGates: []
    };

    const draft = buildFlowDraftFromExisting(
      spec,
      createRequest("Keep pipeline updated for implementation, planning, and research."),
      createCurrentDraft()
    );

    for (const step of draft.steps) {
      expect(step.providerId).toBe("openai");
      expect(step.model).toBe("gpt-5.4");
      expect(step.reasoningEffort).toBe("medium");
    }
  });

  it("uses GPT-5.4 Pro for review only when premium review routing is enabled and OpenAI API access exists", () => {
    const spec: GeneratedFlowSpec = {
      name: "Mixed Provider Pipeline",
      description: "desc",
      steps: [
        {
          name: "Executive Reviewer",
          role: "review",
          prompt: "Review the final strategy and produce approval notes for the executive team."
        }
      ],
      links: [],
      qualityGates: []
    };

    const draft = buildFlowDraft(
      spec,
      {
        ...createRequest("Create a strong review stage for the final auditor."),
        generatedStepPolicy: {
          strategy: "openai-first",
          allowPremiumModes: true,
          openAiApiCapable: true
        }
      }
    );

    expect(draft.steps[0]?.providerId).toBe("openai");
    expect(draft.steps[0]?.model).toBe("gpt-5.4-pro");
  });

  it("still honors explicit Anthropic provider cues when requested", () => {
    const spec: GeneratedFlowSpec = {
      name: "Anthropic Review Pipeline",
      description: "desc",
      steps: [
        {
          name: "Executive Reviewer",
          role: "review",
          prompt: "Use Claude Opus 4.6 to review the final strategy and produce approval notes."
        }
      ],
      links: [],
      qualityGates: []
    };

    const draft = buildFlowDraft(
      spec,
      createRequest("Keep OpenAI first overall, but use Claude Opus 4.6 for the executive review.")
    );

    expect(draft.steps[0]?.providerId).toBe("claude");
    expect(draft.steps[0]?.model).toBe("claude-opus-4-6");
  });
});
