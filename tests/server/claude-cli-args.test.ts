import { describe, expect, it } from "vitest";

import { buildClaudeCliArgs, shouldDisableClaudeStreamJson } from "../../server/providers/clientFactory/cliRunner.js";
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

  it("uses non-interactive permission skipping by default", () => {
    const args = buildClaudeCliArgs(createInput(), {
      selectedModel: "claude-sonnet-4-6",
      prompt: "hello"
    });

    expect(args).toContain("--dangerously-skip-permissions");
    expect(args).not.toContain("--permission-mode");
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

  it("disables tools for AI Flow planner steps to avoid interactive tool permission stalls", () => {
    const input = createInput();
    input.step.role = "planner";
    input.step.name = "AI Flow Copilot";
    input.outputMode = "json";

    const args = buildClaudeCliArgs(input, {
      selectedModel: "claude-sonnet-4-6",
      prompt: "respond in strict JSON"
    });

    const toolsIndex = args.indexOf("--tools");
    expect(toolsIndex).toBeGreaterThan(-1);
    expect(args[toolsIndex + 1]).toBe("");
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
    const outputFormat = args[outputFormatIndex + 1];
    expect(["stream-json", "text"]).toContain(outputFormat);
    if (outputFormat === "stream-json") {
      expect(args).toContain("--include-partial-messages");
    } else {
      expect(args).not.toContain("--include-partial-messages");
    }
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

  it("passes fast mode through --settings when enabled", () => {
    const input = createInput();
    input.step.fastMode = true;

    const args = buildClaudeCliArgs(input, {
      selectedModel: "claude-opus-4-6",
      prompt: "hello"
    });

    const settingsIndex = args.indexOf("--settings");
    expect(settingsIndex).toBeGreaterThan(-1);
    const parsed = JSON.parse(args[settingsIndex + 1]);
    expect(parsed.fastMode).toBe(true);
  });

  it("passes fast mode off through --settings when disabled", () => {
    const input = createInput();
    input.step.fastMode = false;

    const args = buildClaudeCliArgs(input, {
      selectedModel: "claude-sonnet-4-6",
      prompt: "hello"
    });

    const settingsIndex = args.indexOf("--settings");
    expect(settingsIndex).toBeGreaterThan(-1);
    const parsed = JSON.parse(args[settingsIndex + 1]);
    expect(parsed.fastMode).toBe(false);
  });

  it("does not append system prompt workarounds for fast mode or 1M context", () => {
    const input = createInput();
    input.step.fastMode = true;
    input.step.use1MContext = true;

    const args = buildClaudeCliArgs(input, {
      selectedModel: "claude-opus-4-6",
      prompt: "hello"
    });

    const appendPromptArgs = args.filter((_, i) => i > 0 && args[i - 1] === "--append-system-prompt");
    for (const value of appendPromptArgs) {
      expect(value).not.toContain("Fast mode requested");
      expect(value).not.toContain("1M context mode requested");
    }
  });

  it("uses non-stream JSON output for OAuth auth-mode stability", () => {
    const input = createInput();
    input.outputMode = "json";
    input.step.role = "planner";
    input.step.name = "AI Flow Copilot";

    const args = buildClaudeCliArgs(input, {
      selectedModel: "claude-sonnet-4-6",
      prompt: "respond in strict JSON",
      disableStreamJson: true
    });

    const outputFormatIndex = args.indexOf("--output-format");
    expect(outputFormatIndex).toBeGreaterThan(-1);
    expect(args[outputFormatIndex + 1]).toBe("json");
    expect(args).not.toContain("--include-partial-messages");
  });

  it("derives stream-json disablement for OAuth JSON runtime flows", () => {
    const input = createInput();
    input.outputMode = "json";
    input.step.role = "planner";
    input.step.name = "AI Flow Copilot";

    expect(shouldDisableClaudeStreamJson(input)).toBe(true);
  });

  it("keeps stream-json enabled for OAuth markdown runtime flows", () => {
    const input = createInput();
    input.outputMode = "markdown";
    input.step.role = "analysis";

    expect(shouldDisableClaudeStreamJson(input)).toBe(false);
  });

  it("keeps stream-json enabled for API key JSON flows", () => {
    const input = createInput();
    input.provider.authMode = "api_key";
    input.provider.apiKey = "sk-ant-test";
    input.outputMode = "json";

    expect(shouldDisableClaudeStreamJson(input)).toBe(false);
  });
});
