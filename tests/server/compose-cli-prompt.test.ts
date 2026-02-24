import { describe, expect, it } from "vitest";

import { composeCliPrompt } from "../../server/providers/normalizers.js";
import type { ProviderExecutionInput } from "../../server/providers/types.js";

function createInput(role: ProviderExecutionInput["step"]["role"]): ProviderExecutionInput {
  return {
    provider: {
      id: "claude",
      label: "Anthropic",
      authMode: "oauth",
      apiKey: "",
      oauthToken: "",
      baseUrl: "https://api.anthropic.com/v1",
      defaultModel: "claude-sonnet-4-6",
      updatedAt: new Date().toISOString()
    },
    step: {
      id: "step-1",
      name: "Step",
      role,
      prompt: "Do the task.",
      providerId: "claude",
      model: "claude-sonnet-4-6",
      reasoningEffort: "high",
      fastMode: false,
      use1MContext: false,
      contextWindowTokens: 200_000,
      position: { x: 0, y: 0 },
      contextTemplate: "Task:\n{{task}}",
      enableDelegation: false,
      delegationCount: 1,
      enableIsolatedStorage: true,
      enableSharedStorage: true,
      enabledMcpServerIds: [],
      outputFormat: "markdown",
      requiredOutputFields: [],
      requiredOutputFiles: [],
      scenarios: [],
      skipIfArtifacts: []
    },
    context: "Context body",
    task: "Task body",
    outputMode: "markdown"
  };
}

describe("composeCliPrompt", () => {
  it("adds strict no-shell-write discipline for analysis/review-like roles", () => {
    const prompt = composeCliPrompt(createInput("analysis"));

    expect(prompt).toContain("Runtime safety policy in this prompt overrides conflicting task wording");
    expect(prompt).toContain("Execution discipline:");
    expect(prompt).toContain("Do NOT write/copy artifacts via shell redirection");
    expect(prompt).toContain("Do NOT create or run ad-hoc scripts for artifact transformation");
    expect(prompt).toContain("Never repeat the same write/copy action after success");
    expect(prompt).toContain("Language requirement: any summary or status summary text must be written in English.");
  });

  it("applies strict discipline for executor role as well", () => {
    const prompt = composeCliPrompt(createInput("executor"));

    expect(prompt).toContain("Execution discipline:");
    expect(prompt).toContain("Do NOT write/copy artifacts via shell redirection");
    expect(prompt).toContain("Do NOT create or run ad-hoc scripts for artifact transformation");
  });

  it("injects deck synthesis contract when HTML synthesis context is detected", () => {
    const input = createInput("executor");
    input.step.requiredOutputFiles = ["{{shared_storage_path}}/investor-deck.html"];
    input.context = "Use frame-map.json, ui-kit.json, assets-manifest.json and pdf-content.json.";

    const prompt = composeCliPrompt(input);

    expect(prompt).toContain("Execution discipline:");
    expect(prompt).toContain("Artifact contract:");
    expect(prompt).toContain("Deck synthesis contract:");
    expect(prompt).toContain("Prefer assets-manifest file references");
  });

  it("requires English summary fields in JSON mode", () => {
    const input = createInput("review");
    input.outputMode = "json";

    const prompt = composeCliPrompt(input);

    expect(prompt).toContain("All human-readable summary fields must be in English.");
  });
});
