import { afterEach, describe, expect, it, vi } from "vitest";

const providerMocks = vi.hoisted(() => ({
  executeProviderStep: vi.fn()
}));

vi.mock("../../server/providers.js", () => ({
  executeProviderStep: providerMocks.executeProviderStep
}));

import { generateFlowDraft } from "../../server/flowBuilder.js";
import type { FlowBuilderRequest } from "../../server/flowBuilder.js";
import type { PipelineInput, ProviderConfig } from "../../server/types.js";

function createProviders(): Record<"openai", ProviderConfig> {
  return {
    openai: {
      id: "openai",
      label: "OpenAI",
      authMode: "api_key",
      apiKey: "test-key",
      oauthToken: "",
      baseUrl: "https://api.openai.com/v1",
      defaultModel: "gpt-5.4",
      updatedAt: "2026-03-09T00:00:00.000Z"
    }
  };
}

function createCurrentDraft(): PipelineInput {
  return {
    name: "Existing flow",
    description: "Current draft",
    runtime: {
      maxLoops: 2,
      maxStepExecutions: 18,
      stageTimeoutMs: 420000
    },
    schedule: {
      enabled: true,
      cron: "0 9 * * 1-5",
      timezone: "UTC",
      task: "Weekday sync",
      runMode: "smart",
      inputs: {}
    },
    steps: [
      {
        id: "step-orchestrator",
        name: "Orchestrator",
        role: "orchestrator",
        prompt: "Coordinate the workflow.",
        providerId: "openai",
        model: "gpt-5.4",
        reasoningEffort: "medium",
        fastMode: false,
        use1MContext: false,
        contextWindowTokens: 200000,
        position: { x: 0, y: 0 },
        contextTemplate: "Task:\n{{task}}",
        enableDelegation: false,
        delegationCount: 1,
        enableIsolatedStorage: false,
        enableSharedStorage: true,
        enabledMcpServerIds: [],
        sandboxMode: "secure",
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
    links: [],
    qualityGates: []
  };
}

afterEach(() => {
  providerMocks.executeProviderStep.mockReset();
});

describe("flow builder schedule clarification", () => {
  it("recovers a valid cron from the user request when the model returns an invalid schedule", async () => {
    providerMocks.executeProviderStep.mockResolvedValueOnce(
      JSON.stringify({
        name: "Website sync",
        description: "Sync content from source repos.",
        schedule: {
          enabled: true,
          cron: "0 0 9 * * *",
          timezone: "UTC",
          task: "Sync website content",
          runMode: "smart",
          inputs: {}
        },
        steps: [{ name: "Coordinator", role: "orchestrator", prompt: "Coordinate the repository sync." }],
        links: [],
        qualityGates: []
      })
    );

    const request: FlowBuilderRequest = {
      prompt: "Build this pipeline and run it on cron 0 9 * * 1-5.",
      providerId: "openai",
      model: "gpt-5.4"
    };

    const result = await generateFlowDraft(request, createProviders());

    expect(result.action).toBe("replace_flow");
    expect(result.draft?.schedule).toMatchObject({
      enabled: true,
      cron: "0 9 * * 1-5"
    });
    expect(result.notes).toContain(
      "Recovered schedule.cron from the user request because the model returned an invalid cron expression."
    );
  });

  it("asks a clarification question when scheduling is requested without a valid cron expression", async () => {
    providerMocks.executeProviderStep.mockResolvedValueOnce(
      JSON.stringify({
        name: "Website sync",
        description: "Sync content from source repos.",
        schedule: {
          enabled: true,
          cron: "every day at 2am",
          timezone: "UTC",
          task: "Sync website content",
          runMode: "smart",
          inputs: {}
        },
        steps: [{ name: "Coordinator", role: "orchestrator", prompt: "Coordinate the repository sync." }],
        links: [],
        qualityGates: []
      })
    );

    const request: FlowBuilderRequest = {
      prompt: "Build this pipeline and run it on a schedule via cron.",
      providerId: "openai",
      model: "gpt-5.4"
    };

    const result = await generateFlowDraft(request, createProviders());

    expect(result.action).toBe("answer");
    expect(result.draft).toBeUndefined();
    expect(result.message).toContain("valid 5-field cron expression");
    expect(result.questions).toHaveLength(1);
    expect(result.questions?.[0]).toMatchObject({
      id: "schedule_cron"
    });
  });

  it("preserves the current valid schedule during flow updates when the model emits an invalid cron", async () => {
    providerMocks.executeProviderStep.mockResolvedValueOnce(
      JSON.stringify({
        action: "update_current_flow",
        message: "Updated the sync flow.",
        flow: {
          name: "Website sync",
          description: "Sync content from source repos.",
          schedule: {
            enabled: true,
            cron: "0 0 9 * * *",
            timezone: "UTC",
            task: "Sync website content",
            runMode: "smart",
            inputs: {}
          },
          steps: [{ name: "Coordinator", role: "orchestrator", prompt: "Coordinate the repository sync." }],
          links: [],
          qualityGates: []
        }
      })
    );

    const request: FlowBuilderRequest = {
      prompt: "Add GitLab publish at the end, but keep the current schedule.",
      providerId: "openai",
      model: "gpt-5.4",
      currentDraft: createCurrentDraft()
    };

    const result = await generateFlowDraft(request, createProviders());

    expect(result.action).toBe("update_current_flow");
    expect(result.draft?.schedule).toMatchObject({
      enabled: true,
      cron: "0 9 * * 1-5",
      task: "Weekday sync"
    });
    expect(result.notes).toContain(
      "Preserved the existing valid schedule because the model returned an invalid cron expression."
    );
  });
});
