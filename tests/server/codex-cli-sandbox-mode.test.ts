import { describe, expect, it } from "vitest";

import { resolveCodexCliSandboxMode } from "../../server/providers/clientFactory/cliRunner.js";
import type { ProviderExecutionInput } from "../../server/providers/types.js";

function createInput(role: ProviderExecutionInput["step"]["role"]): ProviderExecutionInput {
  return {
    provider: {
      id: "openai",
      label: "OpenAI",
      authMode: "oauth",
      apiKey: "",
      oauthToken: "",
      baseUrl: "https://api.openai.com/v1",
      defaultModel: "gpt-5.3-codex",
      updatedAt: new Date().toISOString()
    },
    step: {
      id: "step-1",
      name: "Step",
      role,
      prompt: "Run step.",
      providerId: "openai",
      model: "gpt-5.3-codex",
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

describe("resolveCodexCliSandboxMode", () => {
  it("keeps orchestrator steps in read-only sandbox", () => {
    const mode = resolveCodexCliSandboxMode(createInput("orchestrator"));
    expect(mode).toBe("read-only");
  });

  it("enables workspace-write sandbox for non-orchestrator steps", () => {
    const mode = resolveCodexCliSandboxMode(createInput("executor"));
    expect(mode).toBe("workspace-write");
  });
});
