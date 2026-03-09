import { describe, expect, it } from "vitest";

import { composeContext } from "../../server/runner/context.js";
import type { PipelineLink, PipelineStep } from "../../server/types/contracts.js";

function createStep(id: string, name: string, role: PipelineStep["role"], extra?: Partial<PipelineStep>): PipelineStep {
  return {
    id,
    name,
    role,
    prompt: "prompt",
    providerId: "openai",
    model: "gpt-5.4",
    reasoningEffort: "medium",
    fastMode: false,
    use1MContext: false,
    contextWindowTokens: 128_000,
    position: { x: 0, y: 0 },
    contextTemplate: "",
    enableDelegation: false,
    delegationCount: 1,
    enableIsolatedStorage: false,
    enableSharedStorage: true,
    enabledMcpServerIds: [],
    sandboxMode: "secure",
    outputFormat: "json",
    requiredOutputFields: [],
    requiredOutputFiles: [],
    scenarios: [],
    skipIfArtifacts: [],
    policyProfileIds: [],
    cacheBypassInputKeys: [],
    cacheBypassOrchestratorPromptPatterns: [],
    ...extra
  };
}

describe("composeContext", () => {
  it("passes compressed summaries instead of raw accumulated outputs", () => {
    const upstream = createStep("upstream", "Diff Analyzer", "analysis", {
      requiredOutputFiles: ["{{shared_storage_path}}/diff-summary.json"]
    });
    const downstream = createStep("downstream", "Site Updater", "executor");
    const incomingLinks: PipelineLink[] = [
      {
        id: "link-1",
        sourceStepId: upstream.id,
        targetStepId: downstream.id,
        condition: "always"
      }
    ];
    const longBody = `raw-body-${"x".repeat(6000)}`;
    const timeline = [
      {
        stepId: upstream.id,
        stepName: upstream.name,
        output: longBody
      }
    ];
    const latestOutputByStepId = new Map<string, string>([
      [
        upstream.id,
        JSON.stringify({
          has_changes: true,
          confidence: 0.64,
          summary: "Sections 2 and 4 changed materially."
        })
      ]
    ]);

    const context = composeContext(
      downstream,
      "Update the site",
      timeline,
      latestOutputByStepId,
      incomingLinks,
      new Map([
        [upstream.id, upstream],
        [downstream.id, downstream]
      ]),
      1,
      {
        sharedStoragePath: "/tmp/shared",
        isolatedStoragePath: "DISABLED",
        runStoragePath: "/tmp/run"
      },
      {}
    );

    expect(context).toContain("Summary: summary=\"Sections 2 and 4 changed materially.\"; has_changes=true; confidence=0.64");
    expect(context).toContain("Artifacts: {{shared_storage_path}}/diff-summary.json");
    expect(context).not.toContain("x".repeat(3000));
  });

  it("redacts secret run inputs from composed context", () => {
    const step = createStep("step-1", "Secure Reviewer", "review");

    const context = composeContext(
      step,
      "Review {{input.repo_name}} using {{secret.github_token}}",
      [],
      new Map(),
      [],
      new Map([[step.id, step]]),
      1,
      {
        sharedStoragePath: "/tmp/shared",
        isolatedStoragePath: "DISABLED",
        runStoragePath: "/tmp/run"
      },
      {
        repo_name: "group/project",
        github_token: "ghp-secret"
      }
    );

    expect(context).toContain("Review group/project using {{secret.github_token}}");
    expect(context).toContain("- github_token: [REDACTED]");
    expect(context).not.toContain("ghp-secret");
  });
});
