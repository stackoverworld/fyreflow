import { describe, expect, it } from "vitest";

import { buildRecoverableInputRequestsFromSmartPlan } from "../../server/startupCheck.js";
import type { Pipeline, PipelineStep, SmartRunPlan } from "../../server/types.js";

function createStep(partial: Partial<PipelineStep> = {}): PipelineStep {
  return {
    id: partial.id ?? "step-1",
    name: partial.name ?? "GitHub Fetcher",
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

describe("startup check recoverable input requests", () => {
  it("builds targeted recovery requests for nested URL composition failures", () => {
    const step = createStep({
      id: "step-github",
      name: "GitHub Fetcher",
      prompt: "GET https://api.github.com/repos/{{input.github_repo}}/contents/{{input.github_file_path}}"
    });
    const pipeline = createPipeline(step);

    const smartPlan: SmartRunPlan = {
      fields: [
        {
          key: "github_repo",
          label: "GitHub Repo",
          type: "url",
          required: true,
          description: "",
          placeholder: "https://github.com/org/repo",
          sources: ["GitHub Fetcher.prompt"]
        },
        {
          key: "github_file_path",
          label: "GitHub File Path",
          type: "path",
          required: true,
          description: "",
          placeholder: "/WHITEPAPER.md",
          sources: ["GitHub Fetcher.prompt"]
        }
      ],
      checks: [
        {
          id: "input:url_nested_scheme:step-github:prompt",
          title: "Input URL composition (GitHub Fetcher)",
          status: "fail",
          message: "Rendered prompt contains a nested URL in endpoint path."
        }
      ],
      canRun: false
    };

    const requests = buildRecoverableInputRequestsFromSmartPlan(pipeline, smartPlan, {
      github_repo: "https://github.com/Lunarbase-Lab/Prop-AMM-RnD",
      github_file_path: "/WHITEPAPER.md"
    });

    expect(requests).toEqual([
      expect.objectContaining({
        key: "github_repo",
        type: "text",
        reason: expect.stringContaining("owner/repo format without protocol"),
        defaultValue: "https://github.com/Lunarbase-Lab/Prop-AMM-RnD"
      })
    ]);
  });

  it("falls back to url-like placeholder keys for nested URL failures when fields are unavailable", () => {
    const step = createStep({
      id: "step-github",
      name: "GitHub Fetcher",
      prompt: "GET https://api.github.com/repos/{{input.github_repo}}/contents/{{input.github_file_path}}"
    });
    const pipeline = createPipeline(step);

    const smartPlan: SmartRunPlan = {
      fields: [],
      checks: [
        {
          id: "input:url_nested_scheme:step-github:prompt",
          title: "Input URL composition (GitHub Fetcher)",
          status: "fail",
          message: "Rendered prompt contains a nested URL in endpoint path."
        }
      ],
      canRun: false
    };

    const requests = buildRecoverableInputRequestsFromSmartPlan(pipeline, smartPlan, {
      github_repo: "https://github.com/org/repo",
      github_file_path: "/README.md"
    });

    expect(requests.map((request) => request.key)).toEqual(["github_repo"]);
  });

  it("targets path-like fields for duplicate slash path failures", () => {
    const step = createStep({
      id: "step-github",
      name: "GitHub Fetcher",
      prompt: "GET https://api.github.com/repos/{{input.github_repo}}/contents/{{input.github_file_path}}"
    });
    const pipeline = createPipeline(step);

    const smartPlan: SmartRunPlan = {
      fields: [
        {
          key: "github_repo",
          label: "GitHub Repo",
          type: "url",
          required: true,
          description: "",
          placeholder: "owner/repo",
          sources: ["GitHub Fetcher.prompt"]
        },
        {
          key: "github_file_path",
          label: "GitHub File Path",
          type: "path",
          required: true,
          description: "",
          placeholder: "WHITEPAPER.md",
          sources: ["GitHub Fetcher.prompt"]
        }
      ],
      checks: [
        {
          id: "input:url_double_slash_path:step-github:prompt",
          title: "Input URL composition (GitHub Fetcher)",
          status: "fail",
          message: 'Rendered prompt contains duplicate "/" path separators.'
        }
      ],
      canRun: false
    };

    const requests = buildRecoverableInputRequestsFromSmartPlan(pipeline, smartPlan, {
      github_repo: "Lunarbase-Lab/Prop-AMM-RnD",
      github_file_path: "/WHITEPAPER.md"
    });

    expect(requests).toEqual([
      expect.objectContaining({
        key: "github_file_path",
        type: "path",
        defaultValue: "/WHITEPAPER.md"
      })
    ]);
  });

  it("ignores unrelated failed checks", () => {
    const step = createStep({
      id: "step-1",
      name: "Fetcher",
      prompt: "fetch data"
    });
    const pipeline = createPipeline(step);

    const smartPlan: SmartRunPlan = {
      fields: [],
      checks: [
        {
          id: "provider:openai",
          title: "Provider OpenAI",
          status: "fail",
          message: "Authentication is missing."
        }
      ],
      canRun: false
    };

    const requests = buildRecoverableInputRequestsFromSmartPlan(pipeline, smartPlan, {});

    expect(requests).toEqual([]);
  });
});
