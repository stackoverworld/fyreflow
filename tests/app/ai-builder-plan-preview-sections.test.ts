import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import type { AiChatMessage } from "../../src/lib/types";
import {
  ChatBubble,
  PlanPreviewGeneratingIndicator
} from "../../src/components/dashboard/ai-builder/plan-preview/PlanPreviewSections";

function createMessage(partial: Partial<AiChatMessage>): AiChatMessage {
  return {
    id: partial.id ?? "msg-1",
    role: partial.role ?? "assistant",
    content: partial.content ?? "",
    timestamp: partial.timestamp ?? 1,
    streaming: partial.streaming,
    action: partial.action,
    requestId: partial.requestId
  };
}

describe("AI builder plan preview sections", () => {
  it("renders animated Thinking indicator for streaming assistant messages", () => {
    const html = renderToStaticMarkup(
      createElement(ChatBubble, {
        message: createMessage({
          id: "streaming-assistant",
          role: "assistant",
          content: "Partial output",
          streaming: true
        })
      })
    );

    expect(html).toContain("Thinking");
    expect(html).toContain("shiny-text");
    expect(html).not.toContain("bg-ember-400");
  });

  it("does not render Thinking indicator for non-streaming assistant messages", () => {
    const html = renderToStaticMarkup(
      createElement(ChatBubble, {
        message: createMessage({
          id: "assistant-complete",
          role: "assistant",
          content: "Completed response",
          streaming: false
        })
      })
    );

    expect(html).not.toContain("shiny-text");
    expect(html).not.toContain("Thinking");
  });

  it("hides Answer chip and timestamp while assistant message is streaming", () => {
    const html = renderToStaticMarkup(
      createElement(ChatBubble, {
        message: createMessage({
          id: "assistant-streaming-meta-hidden",
          role: "assistant",
          content: "Partial output",
          streaming: true,
          action: "answer",
          timestamp: 1731546000000
        })
      })
    );

    expect(html).not.toContain("Answer");
    expect(html).not.toContain("text-[10px] text-ink-600");
  });

  it("shows Answer chip and timestamp once assistant message is complete", () => {
    const html = renderToStaticMarkup(
      createElement(ChatBubble, {
        message: createMessage({
          id: "assistant-complete-meta-visible",
          role: "assistant",
          content: "Completed response",
          streaming: false,
          action: "answer",
          timestamp: 1731546000000
        })
      })
    );

    expect(html).toContain("Answer");
    expect(html).toContain("text-[10px] text-ink-600");
  });

  it("renders animated Thinking indicator in the generating placeholder", () => {
    const html = renderToStaticMarkup(createElement(PlanPreviewGeneratingIndicator));

    expect(html).toContain("Thinking");
    expect(html).toContain("shiny-text");
  });
});
