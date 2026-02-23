import { describe, expect, it } from "vitest";

import {
  ASK_MODE_MUTATION_BLOCK_MESSAGE,
  DEFAULT_AI_BUILDER_MODE,
  canSendPromptToFlowMutationEndpoint,
  hasMutationIntent,
  hasReplaceIntent,
  resolveAiBuilderMode
} from "../../src/components/dashboard/ai-builder/mode.ts";

describe("AI builder mode behavior", () => {
  it("defaults to agent mode when unlocked", () => {
    expect(DEFAULT_AI_BUILDER_MODE).toBe("agent");
    expect(resolveAiBuilderMode("agent", false)).toBe("agent");
    expect(resolveAiBuilderMode("ask", false)).toBe("ask");
  });

  it("forces ask mode while flow mutations are locked", () => {
    expect(resolveAiBuilderMode("agent", true)).toBe("ask");
    expect(resolveAiBuilderMode("ask", true)).toBe("ask");
  });

  it("detects mutation and replacement intents deterministically", () => {
    expect(hasMutationIntent("Please update this flow and add retries.")).toBe(true);
    expect(hasReplaceIntent("Start over and rebuild this from scratch.")).toBe(true);
    expect(hasMutationIntent("Explain what this flow does.")).toBe(false);
  });

  it("blocks ask-mode mutation prompts from flow mutation endpoint", () => {
    expect(canSendPromptToFlowMutationEndpoint("ask", "Create a new flow for onboarding.")).toBe(false);
    expect(canSendPromptToFlowMutationEndpoint("ask", "What does step 2 currently do?")).toBe(true);
    expect(canSendPromptToFlowMutationEndpoint("agent", "Create a new flow for onboarding.")).toBe(true);
  });

  it("exposes a deterministic ask-mode block message", () => {
    expect(ASK_MODE_MUTATION_BLOCK_MESSAGE).toBe("Ask mode is read-only. Switch to Agent mode to request flow changes.");
  });
});
