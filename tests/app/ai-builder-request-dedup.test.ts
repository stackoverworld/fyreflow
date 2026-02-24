import { describe, expect, it } from "vitest";

import type { AiChatMessage } from "../../src/lib/types";
import {
  hasAssistantResultForRequest,
  hasErrorResultForRequest
} from "../../src/components/dashboard/ai-builder/requestDedup";

function createMessage(partial: Partial<AiChatMessage>): AiChatMessage {
  return {
    id: partial.id ?? "msg-1",
    role: partial.role ?? "assistant",
    content: partial.content ?? "ok",
    timestamp: partial.timestamp ?? 1,
    requestId: partial.requestId
  };
}

describe("AI builder request dedupe", () => {
  it("detects assistant results by request id", () => {
    const messages: AiChatMessage[] = [
      createMessage({ id: "u1", role: "user", requestId: "req-1", content: "hi" }),
      createMessage({ id: "a1", role: "assistant", requestId: "req-1", content: "done" })
    ];

    expect(hasAssistantResultForRequest(messages, "req-1")).toBe(true);
    expect(hasAssistantResultForRequest(messages, "req-2")).toBe(false);
  });

  it("detects error results by request id", () => {
    const messages: AiChatMessage[] = [
      createMessage({ id: "e1", role: "error", requestId: "req-err", content: "failed" })
    ];

    expect(hasErrorResultForRequest(messages, "req-err")).toBe(true);
    expect(hasErrorResultForRequest(messages, "req-other")).toBe(false);
  });
});
