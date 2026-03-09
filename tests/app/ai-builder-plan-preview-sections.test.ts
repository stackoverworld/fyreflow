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
    requestId: partial.requestId,
    generatedDraft: partial.generatedDraft
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

  it("shows deterministic and semantic route badges for generated drafts", () => {
    const html = renderToStaticMarkup(
      createElement(ChatBubble, {
        message: createMessage({
          id: "assistant-generated-draft",
          role: "assistant",
          content: "Updated the flow.",
          action: "update_current_flow",
          generatedDraft: {
            name: "Lean runtime flow",
            description: "Uses deterministic stages and semantic routing.",
            steps: [
              {
                id: "fetch-step",
                name: "Fetch research",
                role: "executor",
                prompt: "{\"op\":\"fetch\"}",
                providerId: "openai",
                model: "gpt-5.4",
                reasoningEffort: "medium",
                fastMode: false,
                use1MContext: false,
                contextWindowTokens: 128000,
                position: { x: 0, y: 0 },
                contextTemplate: "Task:\n{{task}}",
                enableDelegation: false,
                delegationCount: 1,
                enableIsolatedStorage: false,
                enableSharedStorage: true,
                enabledMcpServerIds: [],
                sandboxMode: "secure",
                outputFormat: "json",
                requiredOutputFields: ["status"],
                requiredOutputFiles: [],
                scenarios: [],
                skipIfArtifacts: [],
                policyProfileIds: ["deterministic_fetch"],
                cacheBypassInputKeys: [],
                cacheBypassOrchestratorPromptPatterns: []
              },
              {
                id: "rewrite-step",
                name: "Rewrite content",
                role: "executor",
                prompt: "Rewrite the content to match the site style guide.",
                providerId: "claude",
                model: "claude-sonnet-4-6",
                reasoningEffort: "medium",
                fastMode: false,
                use1MContext: false,
                contextWindowTokens: 128000,
                position: { x: 300, y: 0 },
                contextTemplate: "Task:\n{{task}}",
                enableDelegation: false,
                delegationCount: 1,
                enableIsolatedStorage: false,
                enableSharedStorage: true,
                enabledMcpServerIds: [],
                sandboxMode: "secure",
                outputFormat: "markdown",
                requiredOutputFields: [],
                requiredOutputFiles: [],
                scenarios: [],
                skipIfArtifacts: [],
                policyProfileIds: [],
                cacheBypassInputKeys: [],
                cacheBypassOrchestratorPromptPatterns: []
              }
            ],
            links: [
              {
                id: "rewrite-link",
                sourceStepId: "fetch-step",
                targetStepId: "rewrite-step",
                condition: "always",
                conditionExpression: "$.has_changes == true"
              }
            ],
            qualityGates: []
          }
        }),
        onApply: () => undefined
      })
    );

    expect(html).toContain("2 steps");
    expect(html).toContain("1 deterministic");
    expect(html).toContain("1 semantic route");
    expect(html).toContain("1 LLM");
  });
});
