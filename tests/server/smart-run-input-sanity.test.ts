import { describe, expect, it } from "vitest";

import { collectRenderedInputSanityChecks } from "../../server/smart-run/inputSanity.js";
import type { Pipeline, PipelineStep } from "../../server/types.js";

function createStep(partial: Partial<PipelineStep> = {}): PipelineStep {
  return {
    id: partial.id ?? "step-1",
    name: partial.name ?? "Fetcher",
    role: partial.role ?? "executor",
    prompt: partial.prompt ?? "",
    providerId: partial.providerId ?? "openai",
    model: partial.model ?? "gpt-5.4",
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

function createPipeline(step: PipelineStep): Pipeline {
  const now = new Date().toISOString();
  return {
    id: "pipeline-1",
    name: "Pipeline",
    description: "",
    createdAt: now,
    updatedAt: now,
    steps: [step],
    links: [],
    runtime: {
      maxLoops: 3,
      maxStepExecutions: 10,
      stageTimeoutMs: 300_000
    },
    schedule: {
      enabled: false,
      cron: "",
      timezone: "UTC",
      task: "",
      runMode: "smart",
      inputs: {}
    },
    qualityGates: []
  };
}

describe("smart run input sanity checks", () => {
  it("fails when a rendered endpoint contains nested URL scheme in the path", () => {
    const pipeline = createPipeline(
      createStep({
        name: "GitHub Fetcher",
        prompt:
          "GET https://api.github.com/repos/{{input.github_repo}}/contents/{{input.github_file_path}}"
      })
    );

    const checks = collectRenderedInputSanityChecks(pipeline, {
      github_repo: "https://github.com/Lunarbase-Lab/Prop-AMM-RnD",
      github_file_path: "/WHITEPAPER.md"
    });

    expect(checks.some((check) => check.status === "fail" && check.id.includes("url_nested_scheme"))).toBe(true);
  });

  it("warns when a rendered endpoint contains duplicate path separators", () => {
    const pipeline = createPipeline(
      createStep({
        name: "API Fetcher",
        prompt: "GET https://api.example.com/v1//items/{{input.item_id}}"
      })
    );

    const checks = collectRenderedInputSanityChecks(pipeline, {
      item_id: "42"
    });

    expect(checks.some((check) => check.status === "warn" && check.id.includes("url_double_slash_path"))).toBe(true);
  });

  it("does not emit URL sanity checks for valid rendered endpoints", () => {
    const pipeline = createPipeline(
      createStep({
        name: "API Fetcher",
        prompt: "GET https://api.example.com/repos/{{input.repo_slug}}/contents/{{input.file_path}}"
      })
    );

    const checks = collectRenderedInputSanityChecks(pipeline, {
      repo_slug: "org/project",
      file_path: "docs/README.md"
    });

    expect(checks).toEqual([]);
  });
});

