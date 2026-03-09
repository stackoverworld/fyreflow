import { describe, expect, it } from "vitest";

import { isMutationIntent, isReplaceIntent } from "../../server/flowBuilder/intents.js";

describe("flow builder intent detection", () => {
  it("treats fix requests as mutation intent", () => {
    expect(isMutationIntent("Fix the issues in the flow, please.")).toBe(true);
    expect(isMutationIntent("Fix the flow, please.")).toBe(true);
  });

  it("keeps explanatory questions non-mutating", () => {
    expect(isMutationIntent("What issues are in this flow?")).toBe(false);
    expect(isMutationIntent("Explain what this flow does.")).toBe(false);
  });

  it("preserves replace intent detection", () => {
    expect(isReplaceIntent("Start over and rebuild this from scratch.")).toBe(true);
  });
});
