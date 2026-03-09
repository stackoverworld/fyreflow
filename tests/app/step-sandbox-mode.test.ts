import { describe, expect, it } from "vitest";

import {
  analyzeStepSandboxRequirement,
  normalizeStepSandboxMode,
  resolvePreferredSandboxMode
} from "../../src/lib/stepSandboxMode";
import type { PipelinePayload } from "../../src/lib/types";

function createStep(overrides: Partial<PipelinePayload["steps"][number]> = {}): PipelinePayload["steps"][number] {
  return {
    id: "step-1",
    name: "Step",
    role: "executor",
    prompt: "Process local markdown files.",
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
    enableIsolatedStorage: false,
    enableSharedStorage: true,
    enabledMcpServerIds: [],
    sandboxMode: "auto",
    outputFormat: "markdown",
    requiredOutputFields: [],
    requiredOutputFiles: [],
    scenarios: [],
    skipIfArtifacts: [],
    policyProfileIds: [],
    cacheBypassInputKeys: [],
    cacheBypassOrchestratorPromptPatterns: [],
    ...overrides
  };
}

describe("step sandbox mode helpers", () => {
  it("normalizes unknown values to auto", () => {
    expect(normalizeStepSandboxMode("unexpected")).toBe("auto");
  });

  it("flags remote publish prompts as requiring full access", () => {
    const requirement = analyzeStepSandboxRequirement(
      createStep({
        prompt: "Publish files with curl https://gitlab.com/api/v4/projects/{{input.project_id}}"
      })
    );
    expect(requirement.requiresFullAccess).toBe(true);
    expect(requirement.reasons.length).toBeGreaterThan(0);
  });

  it("keeps local-only steps in secure mode", () => {
    const step = createStep({
      prompt: "Read {{shared_storage_path}}/source.md and write normalized result."
    });
    expect(resolvePreferredSandboxMode(step)).toBe("secure");
  });

  it("keeps secure mode when the prompt suggests network access", () => {
    const step = createStep({
      sandboxMode: "secure",
      prompt: "Deploy via https://github.com/org/repo and push release tags."
    });
    expect(resolvePreferredSandboxMode(step)).toBe("secure");
  });
});
