import { describe, expect, it } from "vitest";

import { buildCodexCliArgs } from "../../server/providers/clientFactory/cliRunner.js";
import type { ProviderExecutionInput } from "../../server/providers/types.js";

function createInput(): ProviderExecutionInput {
  return {
    provider: {
      id: "openai",
      label: "OpenAI / Codex",
      authMode: "oauth",
      apiKey: "",
      oauthToken: "",
      baseUrl: "https://api.openai.com/v1",
      defaultModel: "gpt-5.4",
      updatedAt: new Date().toISOString()
    },
    step: {
      id: "step-1",
      name: "OpenAI Step",
      role: "executor",
      prompt: "Run step.",
      providerId: "openai",
      model: "gpt-5.4",
      reasoningEffort: "medium",
      fastMode: false,
      use1MContext: false,
      contextWindowTokens: 272_000,
      position: { x: 0, y: 0 },
      contextTemplate: "Task:\n{{task}}",
      enableDelegation: false,
      delegationCount: 1,
      enableIsolatedStorage: true,
      enableSharedStorage: true,
      enabledMcpServerIds: [],
      sandboxMode: "auto",
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

describe("Codex CLI args", () => {
  it('passes `service_tier="fast"` when fast mode is enabled', () => {
    const input = createInput();
    input.step.fastMode = true;

    const args = buildCodexCliArgs(input, {
      jsonMode: true,
      sandboxMode: "workspace-write",
      selectedModel: "gpt-5.4",
      outputPath: "/tmp/codex-last-message.txt"
    });

    expect(args).toContain("--json");
    expect(args).toContain("--config");
    expect(args).toContain('service_tier="fast"');
    expect(args).toContain('model_reasoning_effort="medium"');
  });

  it("omits fast service tier override when fast mode is disabled", () => {
    const args = buildCodexCliArgs(createInput(), {
      jsonMode: false,
      sandboxMode: "read-only",
      selectedModel: "gpt-5.4",
      outputPath: "/tmp/codex-last-message.txt"
    });

    expect(args).not.toContain("--json");
    expect(args).not.toContain('service_tier="fast"');
    expect(args).toContain('model_reasoning_effort="medium"');
  });

  it("passes Codex CLI 1M context overrides for large-window OpenAI steps", () => {
    const input = createInput();
    input.step.use1MContext = true;
    input.step.contextWindowTokens = 1_050_000;

    const args = buildCodexCliArgs(input, {
      jsonMode: false,
      sandboxMode: "workspace-write",
      selectedModel: "gpt-5.4",
      outputPath: "/tmp/codex-last-message.txt"
    });

    expect(args).toContain("--config");
    expect(args).toContain("model_context_window=1050000");
    expect(args).toContain("model_auto_compact_token_limit=950000");
  });
});
