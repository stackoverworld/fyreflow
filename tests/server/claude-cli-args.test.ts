import { describe, expect, it } from "vitest";

import { buildClaudeCliArgs } from "../../server/providers/clientFactory/cliRunner.js";
import type { ProviderExecutionInput } from "../../server/providers/types.js";

function createInput(): ProviderExecutionInput {
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
      id: "step-orchestrator",
      name: "Pipeline Orchestrator",
      role: "orchestrator",
      prompt: "Route work to downstream stages.",
      providerId: "claude",
      model: "claude-sonnet-4-6",
      reasoningEffort: "low",
      fastMode: false,
      use1MContext: false,
      contextWindowTokens: 200_000,
      position: { x: 0, y: 0 },
      contextTemplate: "",
      enableDelegation: true,
      delegationCount: 3,
      enableIsolatedStorage: false,
      enableSharedStorage: true,
      enabledMcpServerIds: [],
      outputFormat: "markdown",
      requiredOutputFields: [],
      requiredOutputFiles: [],
      scenarios: [],
      skipIfArtifacts: []
    },
    context: "context",
    task: "task"
  };
}

describe("Claude CLI args", () => {
  it("disables built-in tools for orchestrator steps", () => {
    const args = buildClaudeCliArgs(createInput(), {
      selectedModel: "claude-sonnet-4-6",
      prompt: "hello"
    });

    const toolsIndex = args.indexOf("--tools");
    expect(toolsIndex).toBeGreaterThan(-1);
    expect(args[toolsIndex + 1]).toBe("");
    expect(args).toContain("--settings");
  });

  it("keeps tools enabled for review/tester steps so they can inspect artifacts", () => {
    const reviewInput = createInput();
    reviewInput.step.role = "review";
    reviewInput.outputMode = "json";

    const reviewArgs = buildClaudeCliArgs(reviewInput, {
      selectedModel: "claude-sonnet-4-6",
      prompt: "review artifact"
    });

    const testerInput = createInput();
    testerInput.step.role = "tester";
    testerInput.outputMode = "json";

    const testerArgs = buildClaudeCliArgs(testerInput, {
      selectedModel: "claude-sonnet-4-6",
      prompt: "test artifact"
    });

    expect(reviewArgs).not.toContain("--tools");
    expect(testerArgs).not.toContain("--tools");
    expect(reviewArgs).toContain("--json-schema");
    expect(testerArgs).toContain("--json-schema");
  });

  it("keeps tools enabled for executor steps that must write artifacts", () => {
    const input = createInput();
    input.step.role = "executor";
    input.step.requiredOutputFiles = ["{{shared_storage_path}}/investor-deck.html"];

    const args = buildClaudeCliArgs(input, {
      selectedModel: "claude-sonnet-4-6",
      prompt: "build artifact"
    });

    expect(args).not.toContain("--tools");
  });

  it("uses stream-json output for markdown steps to surface live activity", () => {
    const input = createInput();
    input.step.role = "analysis";
    input.outputMode = "markdown";

    const args = buildClaudeCliArgs(input, {
      selectedModel: "claude-sonnet-4-6",
      prompt: "extract source content"
    });

    const outputFormatIndex = args.indexOf("--output-format");
    expect(outputFormatIndex).toBeGreaterThan(-1);
    expect(["stream-json", "text"]).toContain(args[outputFormatIndex + 1]);
  });

  it("uses compatibility profile without effort flag when requested", () => {
    const args = buildClaudeCliArgs(createInput(), {
      selectedModel: "claude-sonnet-4-6",
      prompt: "hello",
      compatibilityMode: true,
      disableDiagnostics: true
    });

    expect(args).not.toContain("--effort");
  });

  it("uses JSON output with schema for review/tester status contracts", () => {
    const input = createInput();
    input.outputMode = "json";
    input.step.role = "review";
    input.step.name = "HTML Reviewer";

    const args = buildClaudeCliArgs(input, {
      selectedModel: "claude-sonnet-4-6",
      prompt: "hello"
    });

    const outputFormatIndex = args.indexOf("--output-format");
    expect(outputFormatIndex).toBeGreaterThan(-1);
    expect(["json", "stream-json"]).toContain(args[outputFormatIndex + 1]);
    expect(args).toContain("--json-schema");
  });
});
