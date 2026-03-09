import { describe, expect, it } from "vitest";

import { resolveFlowBuilderMessage } from "../../server/flowBuilder/responses.js";
import type { PipelineInput } from "../../server/types.js";

function createDraft(): PipelineInput {
  return {
    name: "Draft",
    description: "desc",
    runtime: {
      maxLoops: 2,
      maxStepExecutions: 18,
      stageTimeoutMs: 420000
    },
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
        id: "step-1",
        name: "Orchestrator",
        role: "orchestrator",
        prompt: "Coordinate",
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

describe("resolveFlowBuilderMessage", () => {
  it("preserves conversational answer text", () => {
    expect(resolveFlowBuilderMessage("answer", "Here is the explanation.", undefined)).toBe("Here is the explanation.");
  });

  it("preserves concise mutation summaries", () => {
    const draft = createDraft();
    expect(resolveFlowBuilderMessage("update_current_flow", "Updated the flow to use JSON validator outputs.", draft)).toBe(
      "Updated the flow to use JSON validator outputs."
    );
  });

  it("replaces mutation planning prose with deterministic fallback text", () => {
    const draft = createDraft();
    const message = `Looking at the current flow, I can identify these issues to fix:\n\n1. Deduplicate gates.\nApplying all fixes now.`;

    expect(resolveFlowBuilderMessage("update_current_flow", message, draft)).toBe("Updated current flow: 1 step(s), 0 link(s).");
  });

  it("replaces mutation messages that contain embedded JSON", () => {
    const draft = createDraft();
    const message = '{"message":"Flow fixed.","action":"update_current_flow"}';

    expect(resolveFlowBuilderMessage("replace_flow", message, draft)).toBe("Created a new flow: 1 step(s), 0 link(s).");
  });
});
