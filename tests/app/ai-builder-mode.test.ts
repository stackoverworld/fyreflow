import { describe, expect, it } from "vitest";

import {
  ASK_MODE_MUTATION_BLOCK_MESSAGE,
  DEFAULT_AI_BUILDER_MODE,
  canSendPromptToFlowMutationEndpoint,
  hasMutationIntent,
  hasReplaceIntent,
  resolveAiBuilderMode
} from "../../src/components/dashboard/ai-builder/mode.ts";
import { shouldStartSyntheticStreaming } from "../../src/components/dashboard/ai-builder/PlanPreview";
import {
  resolveCommittedAssistantContent,
  resolveCompletedAssistantMessage,
  resolveDisplayedAssistantMessage,
  shouldRevealAssistantTextDuringGeneration
} from "../../src/components/dashboard/ai-builder/resultVisibility";

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
    expect(hasMutationIntent("Fix the flow, please.")).toBe(true);
    expect(hasReplaceIntent("Start over and rebuild this from scratch.")).toBe(true);
    expect(hasMutationIntent("Explain what this flow does.")).toBe(false);
  });

  it("blocks ask-mode mutation prompts from flow mutation endpoint", () => {
    expect(canSendPromptToFlowMutationEndpoint("ask", "Create a new flow for onboarding.")).toBe(false);
    expect(canSendPromptToFlowMutationEndpoint("ask", "Fix the flow, please.")).toBe(false);
    expect(canSendPromptToFlowMutationEndpoint("ask", "What does step 2 currently do?")).toBe(true);
    expect(canSendPromptToFlowMutationEndpoint("agent", "Create a new flow for onboarding.")).toBe(true);
  });

  it("exposes a deterministic ask-mode block message", () => {
    expect(ASK_MODE_MUTATION_BLOCK_MESSAGE).toBe("Ask mode is read-only. Switch to Agent mode to request flow changes.");
  });

  it("only reveals assistant text during generation for ask mode", () => {
    expect(shouldRevealAssistantTextDuringGeneration("ask")).toBe(true);
    expect(shouldRevealAssistantTextDuringGeneration("agent")).toBe(false);
  });

  it("sanitizes mutation replies that contain planning/progress prose", () => {
    expect(
      resolveDisplayedAssistantMessage(
        "update_current_flow",
        "Looking at the current flow carefully, here are the issues I need to fix:\n\n1. Deduplicate gates.\nApplying all fixes now.",
        {
          name: "Draft",
          description: "",
          steps: [],
          links: [],
          qualityGates: []
        }
      )
    ).toBe("Updated current flow: 0 step(s), 0 link(s).");
  });

  it("summarizes ask-mode suppressed mutations instead of persisting raw planner prose", () => {
    expect(
      resolveCompletedAssistantMessage(
        "update_current_flow",
        "answer",
        '{"message":"Flow fully fixed and consolidated.","action":"update_current_flow"}',
        {
          intendedDraft: {
            name: "Draft",
            description: "",
            steps: [],
            links: [],
            qualityGates: []
          },
          mutationSuppressedByAskMode: true
        }
      )
    ).toBe("Updated current flow: 0 step(s), 0 link(s).\n\nAsk mode kept this response read-only; no flow changes were applied.");
  });

  it("replaces revealed streamed content with the final sanitized assistant message", () => {
    expect(
      resolveCommittedAssistantContent(
        "Looking at the current flow carefully...",
        "Updated current flow: 0 step(s), 0 link(s)."
      )
    ).toBe("Updated current flow: 0 step(s), 0 link(s).");
  });

  describe("synthetic streaming behavior", () => {
    it("always returns false because synthetic streaming is disabled in favor of native SSE streaming", () => {
      expect(
        shouldStartSyntheticStreaming({
          wasGenerating: true,
          generating: false,
          hasNativeStreaming: false,
          sawNativeStreamingInCurrentRun: false
        })
      ).toBe(false);

      expect(
        shouldStartSyntheticStreaming({
          wasGenerating: true,
          generating: false,
          hasNativeStreaming: false,
          sawNativeStreamingInCurrentRun: true
        })
      ).toBe(false);

      expect(
        shouldStartSyntheticStreaming({
          wasGenerating: true,
          generating: true,
          hasNativeStreaming: false,
          sawNativeStreamingInCurrentRun: false
        })
      ).toBe(false);
    });
  });
});
