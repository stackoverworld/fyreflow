import { describe, expect, it } from "vitest";

import {
  defaultFlowBuilderMessage,
  hasMutationIntent,
  hasReplaceIntent,
  resolveFlowBuilderMessage
} from "../../packages/shared/src/flowBuilder/rules";

describe("shared flow builder rules", () => {
  it("detects mutation and replace intents from one shared source", () => {
    expect(hasMutationIntent("Fix the issues in the flow, please.")).toBe(true);
    expect(hasMutationIntent("Update the flow to add retries.")).toBe(true);
    expect(hasReplaceIntent("Start over and rebuild this flow from scratch.")).toBe(true);
    expect(hasMutationIntent("Explain what is broken here.")).toBe(false);
  });

  it("generates deterministic fallback summaries from shared draft metrics", () => {
    expect(defaultFlowBuilderMessage("update_current_flow", { stepCount: 4, linkCount: 3 })).toBe(
      "Updated current flow: 4 step(s), 3 link(s)."
    );
    expect(defaultFlowBuilderMessage("replace_flow", { stepCount: 2, linkCount: 1 })).toBe(
      "Created a new flow: 2 step(s), 1 link(s)."
    );
  });

  it("sanitizes mutation planner prose and embedded json from one shared source", () => {
    expect(
      resolveFlowBuilderMessage(
        "update_current_flow",
        "Looking at the current flow carefully, here are the issues I need to fix:\n1. Deduplicate.\nApplying all fixes now.",
        { stepCount: 2, linkCount: 1 }
      )
    ).toBe("Updated current flow: 2 step(s), 1 link(s).");

    expect(
      resolveFlowBuilderMessage(
        "replace_flow",
        '{"message":"Flow fixed.","action":"replace_flow"}',
        { stepCount: 3, linkCount: 2 }
      )
    ).toBe("Created a new flow: 3 step(s), 2 link(s).");
  });
});
