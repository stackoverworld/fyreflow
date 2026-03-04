import { describe, expect, it } from "vitest";

import { buildRuntimeInputRequestOutputFromFailure } from "../../server/runner/inputRemediation.js";
import type { PipelineStep } from "../../server/types.js";

function createStep(partial: Partial<PipelineStep> = {}): PipelineStep {
  return {
    id: partial.id ?? "step-1",
    name: partial.name ?? "Fetcher",
    role: partial.role ?? "executor",
    prompt: partial.prompt ?? "",
    providerId: partial.providerId ?? "openai",
    model: partial.model ?? "gpt-5.3-codex",
    reasoningEffort: partial.reasoningEffort ?? "medium",
    fastMode: partial.fastMode ?? false,
    use1MContext: partial.use1MContext ?? false,
    contextWindowTokens: partial.contextWindowTokens ?? 64_000,
    position: partial.position ?? { x: 0, y: 0 },
    contextTemplate: partial.contextTemplate ?? "",
    enableDelegation: partial.enableDelegation ?? false,
    delegationCount: partial.delegationCount ?? 1,
    enableIsolatedStorage: partial.enableIsolatedStorage ?? false,
    enableSharedStorage: partial.enableSharedStorage ?? true,
    enabledMcpServerIds: partial.enabledMcpServerIds ?? [],
    outputFormat: partial.outputFormat ?? "markdown",
    requiredOutputFields: partial.requiredOutputFields ?? [],
    requiredOutputFiles: partial.requiredOutputFiles ?? [],
    scenarios: partial.scenarios ?? [],
    skipIfArtifacts: partial.skipIfArtifacts ?? [],
    policyProfileIds: partial.policyProfileIds ?? [],
    cacheBypassInputKeys: partial.cacheBypassInputKeys ?? [],
    cacheBypassOrchestratorPromptPatterns: partial.cacheBypassOrchestratorPromptPatterns ?? []
  };
}

describe("runtime failure input remediation", () => {
  it("emits needs_input payload for authentication failures", () => {
    const step = createStep({
      name: "GitHub Fetcher",
      prompt:
        "GET https://api.github.com/repos/{{input.github_repo}}/contents/{{input.github_file_path}} with token {{secret.github_token}}"
    });

    const output = buildRuntimeInputRequestOutputFromFailure({
      step,
      errorMessage: "OpenAI request failed (401): token_expired",
      runInputs: {
        github_repo: "Lunarbase-Lab/Prop-AMM-RnD",
        github_file_path: "WHITEPAPER.md",
        github_token: "ghp-old"
      }
    });

    expect(output).not.toBeNull();
    const parsed = JSON.parse(output as string) as {
      status: string;
      input_requests: Array<{ key: string; type: string }>;
    };
    expect(parsed.status).toBe("needs_input");
    expect(parsed.input_requests).toEqual(
      expect.arrayContaining([expect.objectContaining({ key: "github_token", type: "secret" })])
    );
  });

  it("emits needs_input payload for malformed endpoint failures", () => {
    const step = createStep({
      name: "GitHub Fetcher",
      prompt:
        "GET https://api.github.com/repos/{{input.github_repo}}/contents/{{input.github_file_path}} with token {{secret.github_token}}"
    });

    const output = buildRuntimeInputRequestOutputFromFailure({
      step,
      errorMessage:
        "Request failed: malformed endpoint https://api.github.com/repos/https://github.com/org/repo/contents//WHITEPAPER.md",
      runInputs: {
        github_repo: "https://github.com/org/repo",
        github_file_path: "/WHITEPAPER.md"
      }
    });

    expect(output).not.toBeNull();
    const parsed = JSON.parse(output as string) as {
      input_requests: Array<{ key: string; type: string }>;
    };
    expect(parsed.input_requests).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ key: "github_repo", type: "text" }),
        expect.objectContaining({ key: "github_file_path" })
      ])
    );
  });

  it("does not emit remediation payload for unrelated runtime failures", () => {
    const step = createStep({
      name: "Generator",
      prompt: "Generate report from {{input.source_path}}"
    });

    const output = buildRuntimeInputRequestOutputFromFailure({
      step,
      errorMessage: "SyntaxError: Unexpected token at line 4",
      runInputs: {
        source_path: "/tmp/source.md"
      }
    });

    expect(output).toBeNull();
  });
});
