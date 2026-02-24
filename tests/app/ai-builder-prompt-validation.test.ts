import { describe, expect, it } from "vitest";

import {
  FLOW_BUILDER_PROMPT_MAX_CHARS,
  FLOW_BUILDER_PROMPT_MIN_CHARS,
  getFlowBuilderPromptLength,
  isFlowBuilderPromptTooLong,
  normalizeFlowBuilderPrompt
} from "../../src/components/dashboard/ai-builder/promptValidation";

describe("AI builder prompt validation", () => {
  it("normalizes prompt by trimming outer whitespace", () => {
    expect(normalizeFlowBuilderPrompt("  hello  ")).toBe("hello");
  });

  it("exposes expected min/max prompt boundaries", () => {
    expect(FLOW_BUILDER_PROMPT_MIN_CHARS).toBe(2);
    expect(FLOW_BUILDER_PROMPT_MAX_CHARS).toBe(64_000);
  });

  it("marks only prompts above max length as too long", () => {
    const maxSized = "a".repeat(FLOW_BUILDER_PROMPT_MAX_CHARS);
    const oversized = "a".repeat(FLOW_BUILDER_PROMPT_MAX_CHARS + 1);
    expect(isFlowBuilderPromptTooLong(maxSized)).toBe(false);
    expect(isFlowBuilderPromptTooLong(oversized)).toBe(true);
    expect(getFlowBuilderPromptLength(maxSized)).toBe(FLOW_BUILDER_PROMPT_MAX_CHARS);
  });
});
