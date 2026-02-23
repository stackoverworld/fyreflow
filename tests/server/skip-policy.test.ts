import { describe, expect, it } from "vitest";
import { shouldBypassSkipIfArtifacts } from "../../server/runner/skipPolicy.js";
import type { PipelineStep } from "../../server/types/contracts.js";

function createStep(partial: Partial<PipelineStep> = {}): PipelineStep {
  return {
    id: "step-1",
    name: "HTML Builder",
    role: "executor",
    prompt: "Build HTML output",
    providerId: "claude",
    model: "claude-sonnet-4-6",
    reasoningEffort: "medium",
    fastMode: false,
    use1MContext: false,
    contextWindowTokens: 128_000,
    position: { x: 0, y: 0 },
    contextTemplate: "Task:\n{{task}}",
    enableDelegation: false,
    delegationCount: 1,
    enableIsolatedStorage: false,
    enableSharedStorage: true,
    enabledMcpServerIds: [],
    outputFormat: "markdown",
    requiredOutputFields: [],
    requiredOutputFiles: [],
    scenarios: [],
    skipIfArtifacts: [],
    policyProfileIds: [],
    cacheBypassInputKeys: [],
    cacheBypassOrchestratorPromptPatterns: [],
    ...partial
  };
}

describe("shouldBypassSkipIfArtifacts", () => {
  it("bypasses skip-if when force_rebuild input is enabled", () => {
    const step = createStep();
    expect(shouldBypassSkipIfArtifacts(step, { force_rebuild: "true" })).toBe(true);
  });

  it("does not bypass skip-if for strict-order orchestrator prompts on non-orchestrator steps", () => {
    const step = createStep();
    const orchestratorPrompt = "Execute stages in strict order.";
    expect(shouldBypassSkipIfArtifacts(step, {}, orchestratorPrompt)).toBe(false);
  });

  it("bypasses skip-if when orchestrator prompt matches step bypass patterns", () => {
    const step = createStep({
      name: "PDF Content Extractor",
      role: "analysis",
      skipIfArtifacts: ["{{shared_storage_path}}/pdf-content.json"],
      cacheBypassOrchestratorPromptPatterns: [
        "pdf\\s+content\\s+extract(?:ion|or)[\\s\\S]{0,280}(?:runs?\\s+always|always\\s+regardless|must\\s+run\\s+always)"
      ]
    });
    const orchestratorPrompt =
      "2) PDF CONTENT EXTRACTION — delegate to PDF Content Extractor. This step runs ALWAYS regardless of whether Design Asset Extraction was skipped.";
    expect(shouldBypassSkipIfArtifacts(step, {}, orchestratorPrompt)).toBe(true);
  });

  it("does not bypass when step does not define orchestrator bypass patterns", () => {
    const step = createStep({ name: "HTML Builder" });
    const orchestratorPrompt =
      "2) PDF CONTENT EXTRACTION — delegate to PDF Content Extractor. This step runs ALWAYS regardless of whether Design Asset Extraction was skipped.";
    expect(shouldBypassSkipIfArtifacts(step, {}, orchestratorPrompt)).toBe(false);
  });

  it("bypasses skip-if when step prompt explicitly says it runs every time", () => {
    const step = createStep({
      prompt: "This step runs every time regardless of whether previous steps were cached."
    });
    expect(shouldBypassSkipIfArtifacts(step, {})).toBe(true);
  });

  it("keeps skip-if enabled when no bypass policy is set", () => {
    const step = createStep();
    expect(shouldBypassSkipIfArtifacts(step, {})).toBe(false);
  });
});
