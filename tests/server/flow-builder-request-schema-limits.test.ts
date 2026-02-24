import { describe, expect, it } from "vitest";

import { flowBuilderRequestSchema } from "../../server/http/routes/pipelines/schemas.js";

const MAX_FLOW_BUILDER_PROMPT_CHARS = 64_000;
const MAX_FLOW_BUILDER_HISTORY_MESSAGE_CHARS = 64_000;

function createRequest(overrides: Partial<{
  prompt: string;
  history: Array<{ role: "user" | "assistant"; content: string }>;
}> = {}) {
  return {
    prompt: "Build a robust design flow.",
    providerId: "openai" as const,
    model: "gpt-5.3-codex",
    ...overrides
  };
}

describe("flow builder request schema limits", () => {
  it("accepts max-sized prompt and history messages", () => {
    const prompt = "p".repeat(MAX_FLOW_BUILDER_PROMPT_CHARS);
    const historyMessage = "h".repeat(MAX_FLOW_BUILDER_HISTORY_MESSAGE_CHARS);
    const parsed = flowBuilderRequestSchema.parse(
      createRequest({
        prompt,
        history: [{ role: "user", content: historyMessage }]
      })
    );

    expect(parsed.prompt).toHaveLength(MAX_FLOW_BUILDER_PROMPT_CHARS);
    expect(parsed.history?.[0]?.content).toHaveLength(MAX_FLOW_BUILDER_HISTORY_MESSAGE_CHARS);
  });

  it("rejects prompts above max length", () => {
    const oversizedPrompt = "p".repeat(MAX_FLOW_BUILDER_PROMPT_CHARS + 1);
    const result = flowBuilderRequestSchema.safeParse(
      createRequest({ prompt: oversizedPrompt })
    );

    expect(result.success).toBe(false);
  });

  it("rejects history messages above max length", () => {
    const oversizedHistoryMessage = "h".repeat(MAX_FLOW_BUILDER_HISTORY_MESSAGE_CHARS + 1);
    const result = flowBuilderRequestSchema.safeParse(
      createRequest({
        history: [{ role: "assistant", content: oversizedHistoryMessage }]
      })
    );

    expect(result.success).toBe(false);
  });
});
