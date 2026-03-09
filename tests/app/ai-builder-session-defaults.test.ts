import { describe, expect, it } from "vitest";

import {
  DEFAULT_AI_BUILDER_SETTINGS,
  normalizeAiBuilderSettings
} from "../../src/components/dashboard/ai-builder/useAiBuilderSession.ts";

describe("AI builder session defaults", () => {
  it("defaults to the OpenAI-first builder settings and openai-first generated-step routing", () => {
    expect(DEFAULT_AI_BUILDER_SETTINGS).toMatchObject({
      providerId: "openai",
      model: "gpt-5.4",
      reasoningEffort: "medium",
      fastMode: false,
      use1MContext: false,
      generatedStepStrategy: "openai-first",
      allowPremiumModes: false
    });
  });

  it("keeps the explicit OpenAI default when normalizing saved settings", () => {
    expect(
      normalizeAiBuilderSettings({
        providerId: "openai",
        model: "gpt-5.4",
        reasoningEffort: "medium",
        fastMode: false,
        use1MContext: false,
        generatedStepStrategy: "openai-first",
        allowPremiumModes: false,
        mode: "agent"
      })
    ).toMatchObject(DEFAULT_AI_BUILDER_SETTINGS);
  });

  it("preserves deliberate generated-step routing overrides", () => {
    expect(
      normalizeAiBuilderSettings({
        providerId: "claude",
        model: "claude-opus-4-6",
        reasoningEffort: "high",
        fastMode: true,
        use1MContext: true,
        generatedStepStrategy: "balanced",
        allowPremiumModes: true,
        mode: "agent"
      })
    ).toMatchObject({
      providerId: "claude",
      model: "claude-opus-4-6",
      reasoningEffort: "high",
      fastMode: true,
      use1MContext: true,
      generatedStepStrategy: "balanced",
      allowPremiumModes: true,
      mode: "agent"
    });
  });
});
