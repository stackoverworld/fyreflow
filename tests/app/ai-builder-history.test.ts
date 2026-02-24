import { describe, expect, it } from "vitest";

import type { AiChatMessage } from "../../src/lib/types";
import {
  FLOW_BUILDER_HISTORY_MESSAGE_MAX_CHARS,
  clipFlowBuilderHistoryContent,
  toFlowBuilderHistoryMessage
} from "../../src/components/dashboard/ai-builder/history";

function createMessage(partial: Partial<AiChatMessage>): AiChatMessage {
  return {
    id: partial.id ?? "msg-1",
    role: partial.role ?? "assistant",
    content: partial.content ?? "ok",
    timestamp: partial.timestamp ?? 1,
    requestId: partial.requestId
  };
}

describe("AI builder history serialization", () => {
  it("clips long history content to schema-compatible length", () => {
    const oversized = "x".repeat(FLOW_BUILDER_HISTORY_MESSAGE_MAX_CHARS + 50);
    const clipped = clipFlowBuilderHistoryContent(oversized);
    expect(clipped).toHaveLength(FLOW_BUILDER_HISTORY_MESSAGE_MAX_CHARS);
  });

  it("skips non-conversational roles", () => {
    const entry = toFlowBuilderHistoryMessage(createMessage({ role: "error", content: "boom" }));
    expect(entry).toBeNull();
  });

  it("serializes assistant entries with clipped content", () => {
    const entry = toFlowBuilderHistoryMessage(
      createMessage({
        role: "assistant",
        content: "y".repeat(FLOW_BUILDER_HISTORY_MESSAGE_MAX_CHARS + 20)
      })
    );

    expect(entry).not.toBeNull();
    expect(entry?.role).toBe("assistant");
    expect(entry?.content.length).toBe(FLOW_BUILDER_HISTORY_MESSAGE_MAX_CHARS);
  });
});
