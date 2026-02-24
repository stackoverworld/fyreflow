import { describe, expect, it } from "vitest";
import { buildFlowDraft, buildFlowDraftFromExisting } from "../../server/flowBuilder/draftMapping.js";
import type { GeneratedFlowSpec } from "../../server/flowBuilder/schema.js";
import type { PipelineInput, PipelineStep } from "../../server/types/contracts.js";

function createRequest(prompt: string) {
  return {
    prompt,
    providerId: "openai" as const,
    model: "gpt-5.2-codex",
    reasoningEffort: "low" as const,
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
    providerId: "openai",
    model: "gpt-5.3-codex",
    reasoningEffort: "xhigh",
    contextWindowTokens: 272000,
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
    providerId: "openai",
    model: "gpt-5.3-codex",
    reasoningEffort: "xhigh",
    contextWindowTokens: 272000,
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
  it("routes each generated step to the task-appropriate provider/model", () => {
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
        }
      ],
      links: [],
      qualityGates: []
    };

    const draft = buildFlowDraft(spec, createRequest("Create a full pipeline with coding, design, and research."));
    const byName = new Map(draft.steps.map((step) => [step.name, step]));

    expect(byName.get("Architecture Planner")?.providerId).toBe("claude");
    expect(byName.get("Architecture Planner")?.model).toBe("claude-opus-4-6");
    expect(byName.get("Architecture Planner")?.reasoningEffort).toBe("high");

    expect(byName.get("Main Orchestrator")?.providerId).toBe("claude");
    expect(byName.get("Main Orchestrator")?.model).toBe("claude-opus-4-6");
    expect(byName.get("Main Orchestrator")?.reasoningEffort).toBe("high");

    expect(byName.get("API Implementation")?.providerId).toBe("openai");
    expect(byName.get("API Implementation")?.model).toBe("gpt-5.3-codex");
    expect(byName.get("API Implementation")?.reasoningEffort).toBe("xhigh");

    expect(byName.get("Landing Page Builder")?.providerId).toBe("claude");
    expect(byName.get("Landing Page Builder")?.model).toBe("claude-opus-4-6");
    expect(byName.get("Landing Page Builder")?.reasoningEffort).toBe("high");

    expect(byName.get("Web Research Analyst")?.providerId).toBe("claude");
    expect(byName.get("Web Research Analyst")?.model).toBe("claude-opus-4-6");
    expect(byName.get("Web Research Analyst")?.reasoningEffort).toBe("high");
  });

  it("re-routes existing drafts per step intent instead of preserving stale provider choices", () => {
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
    const byName = new Map(draft.steps.map((step) => [step.name, step]));

    expect(byName.get("Architecture Planner")?.providerId).toBe("claude");
    expect(byName.get("Architecture Planner")?.model).toBe("claude-opus-4-6");
    expect(byName.get("Architecture Planner")?.reasoningEffort).toBe("high");

    expect(byName.get("API Implementation")?.providerId).toBe("openai");
    expect(byName.get("API Implementation")?.model).toBe("gpt-5.3-codex");
    expect(byName.get("API Implementation")?.reasoningEffort).toBe("xhigh");

    expect(byName.get("Web Research Analyst")?.providerId).toBe("claude");
    expect(byName.get("Web Research Analyst")?.model).toBe("claude-opus-4-6");
    expect(byName.get("Web Research Analyst")?.reasoningEffort).toBe("high");
  });
});
