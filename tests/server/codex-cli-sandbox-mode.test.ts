import { afterEach, describe, expect, it, vi } from "vitest";

import {
  isUnsupportedCodexSandboxModeError,
  resolveCodexCliSandboxMode
} from "../../server/providers/clientFactory/cliRunner.js";
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
      defaultModel: "gpt-5.4",
      updatedAt: new Date().toISOString()
    },
    step: {
      id: "step-1",
      name: "Step",
      role,
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

describe("resolveCodexCliSandboxMode", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("keeps orchestrator steps in read-only sandbox", () => {
    const mode = resolveCodexCliSandboxMode(createInput("orchestrator"));
    expect(mode).toBe("read-only");
  });

  it("enables workspace-write sandbox for non-orchestrator steps", () => {
    const mode = resolveCodexCliSandboxMode(createInput("executor"));
    expect(mode).toBe("workspace-write");
  });

  it("keeps networked non-orchestrator prompts in workspace-write by default", () => {
    const input = createInput("executor");
    input.step.prompt = "Publish using curl https://gitlab.com/api/v4/projects";
    const mode = resolveCodexCliSandboxMode(input);
    expect(mode).toBe("workspace-write");
  });

  it("respects explicit sandbox mode override env", () => {
    vi.stubEnv("FYREFLOW_CODEX_SANDBOX_MODE", "workspace-write");
    const input = createInput("executor");
    input.step.prompt = "Fetch from https://api.github.com/repos/org/repo";
    const mode = resolveCodexCliSandboxMode(input);
    expect(mode).toBe("workspace-write");
  });

  it("uses full access when step sandbox mode is explicitly full", () => {
    const input = createInput("executor");
    input.step.sandboxMode = "full";
    const mode = resolveCodexCliSandboxMode(input);
    expect(mode).toBe("danger-full-access");
  });

  it("keeps secure mode sandboxed when the prompt suggests network access", () => {
    const input = createInput("executor");
    input.step.sandboxMode = "secure";
    input.step.prompt = "Publish updates with curl https://gitlab.com/api/v4/projects";
    const mode = resolveCodexCliSandboxMode(input);
    expect(mode).toBe("workspace-write");
  });
});

describe("isUnsupportedCodexSandboxModeError", () => {
  it("matches explicit invalid --sandbox value parse errors", () => {
    const error = new Error(
      "error: invalid value 'danger-full-access' for '--sandbox <SANDBOX>' [possible values: read-only, workspace-write]"
    );
    expect(isUnsupportedCodexSandboxModeError(error)).toBe(true);
  });

  it("matches unknown --sandbox option parse errors", () => {
    const error = new Error("error: unexpected argument '--sandbox' found");
    expect(isUnsupportedCodexSandboxModeError(error)).toBe(true);
  });

  it("ignores generic invalid value errors without --sandbox context", () => {
    const error = new Error("request rejected: invalid value in payload");
    expect(isUnsupportedCodexSandboxModeError(error)).toBe(false);
  });

  it("ignores runtime failures that merely mention sandbox", () => {
    const error = new Error("Sandbox execution failed: network timeout");
    expect(isUnsupportedCodexSandboxModeError(error)).toBe(false);
  });
});
