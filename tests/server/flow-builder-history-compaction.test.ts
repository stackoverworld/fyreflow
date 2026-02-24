import { describe, expect, it } from "vitest";

import { buildChatPlannerContext } from "../../server/flowBuilder/contexts.js";

describe("Flow Builder history compaction", () => {
  it("compacts older history into a summary when context budget is exceeded", () => {
    const history = Array.from({ length: 120 }, (_, index) => ({
      role: index % 2 === 0 ? ("user" as const) : ("assistant" as const),
      content: `message-${index} ${"x".repeat(1_400)}`
    }));

    const context = buildChatPlannerContext({
      prompt: "latest-user-prompt",
      history
    });

    expect(context).toContain("Earlier conversation was compacted");
    expect(context).toContain("latest-user-prompt");
    expect(context).toContain("message-119");
    expect(context.length).toBeLessThan(220_000);
  });

  it("keeps short history intact without compaction marker", () => {
    const context = buildChatPlannerContext({
      prompt: "prompt",
      history: [
        { role: "user", content: "first question" },
        { role: "assistant", content: "first answer" }
      ]
    });

    expect(context).toContain("first question");
    expect(context).toContain("first answer");
    expect(context).not.toContain("Earlier conversation was compacted");
  });

  it("keeps long prompt tails in chat context", () => {
    const marker = `TAIL-${"z".repeat(2000)}`;
    const prompt = `long-thought ${"x".repeat(20_000)} ${marker}`;

    const context = buildChatPlannerContext({
      prompt,
      history: []
    });

    expect(context).toContain(marker);
  });
});
