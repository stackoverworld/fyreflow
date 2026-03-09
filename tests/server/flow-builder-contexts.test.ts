import { describe, expect, it } from "vitest";

import { buildChatPlannerContext, buildPlannerContext } from "../../server/flowBuilder/contexts.js";

describe("flow builder contexts", () => {
  describe("history compaction", () => {
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

  describe("policy profile guidance", () => {
    it("planner context includes policy profile instructions", () => {
      const context = buildPlannerContext({
        prompt: "Build design to HTML to PDF investor deck pipeline"
      });

      expect(context).toContain("policyProfileIds");
      expect(context).toContain("design_deck_assets");
      expect(context).toContain("cacheBypassInputKeys");
      expect(context).toContain("cacheBypassOrchestratorPromptPatterns");
      expect(context).toContain("on_fail remediation route");
      expect(context).toContain("configured MCP servers");
      expect(context).toContain("Never invent a cron expression");
    });

    it("chat planner context includes policy profile instructions", () => {
      const context = buildChatPlannerContext({
        prompt: "Update my design-to-pdf flow",
        history: [{ role: "user", content: "Improve design fidelity." }]
      });

      expect(context).toContain("policyProfileIds");
      expect(context).toContain("design_deck_assets");
      expect(context).toContain("cacheBypassInputKeys");
      expect(context).toContain("cacheBypassOrchestratorPromptPatterns");
      expect(context).toContain("on_fail remediation route");
      expect(context).toContain("prefer action=answer");
      expect(context).toContain("does not provide a valid 5-field cron expression");
    });
  });

  describe("provider runtime context", () => {
    it("injects provider runtime profile into planner context", () => {
      const context = buildPlannerContext({
        prompt: "Build investor deck flow",
        providerRuntime: {
          providerId: "claude",
          authMode: "oauth",
          providerFastModeAvailable: false,
          fastModeRequested: true,
          fastModeEffective: false,
          fastModeNote: "Fast mode disabled because API key auth is not active."
        }
      });

      expect(context).toContain("Provider runtime profile:");
      expect(context).toContain("provider_fast_mode_available: no");
      expect(context).toContain("fast_mode_requested: on");
      expect(context).toContain("fast_mode_effective: off");
      expect(context).toContain("Fast mode disabled because API key auth is not active.");
    });

    it("injects provider runtime profile into chat planner context", () => {
      const context = buildChatPlannerContext({
        prompt: "Update current flow for faster run",
        history: [{ role: "user", content: "Make it faster" }],
        providerRuntime: {
          providerId: "claude",
          authMode: "api_key",
          providerFastModeAvailable: true,
          fastModeRequested: true,
          fastModeEffective: true,
          fastModeNote: "Fast mode enabled."
        }
      });

      expect(context).toContain("Provider runtime profile:");
      expect(context).toContain("auth_mode: api_key");
      expect(context).toContain("provider_fast_mode_available: yes");
      expect(context).toContain("fast_mode_effective: on");
    });
  });

  describe("parallel multi-agent guidance", () => {
    it("planner context includes parallel delegation keywords", () => {
      const context = buildPlannerContext({
        prompt: "Build a multi-agent research pipeline"
      });

      expect(context).toContain("enableDelegation");
      expect(context).toContain("delegationCount");
      expect(context).toContain("Fan-out pattern");
      expect(context).toContain("Fan-in pattern");
      expect(context).toContain("parallel");
    });

    it("chat planner context includes parallel delegation keywords", () => {
      const context = buildChatPlannerContext({
        prompt: "Add parallel agents to my flow",
        history: [{ role: "user", content: "I want a multi-agent setup." }]
      });

      expect(context).toContain("enableDelegation");
      expect(context).toContain("delegationCount");
      expect(context).toContain("Fan-out pattern");
      expect(context).toContain("Fan-in pattern");
      expect(context).toContain("parallel");
      expect(context).toContain("multi-agent");
    });
  });

  describe("edge cases", () => {
    it("handles empty history array", () => {
      const context = buildChatPlannerContext({
        prompt: "start fresh",
        history: []
      });

      expect(context).toContain("start fresh");
      expect(context).not.toContain("Earlier conversation was compacted");
    });

    it("handles history with only system-like messages (no user messages)", () => {
      const context = buildChatPlannerContext({
        prompt: "next prompt",
        history: [
          { role: "assistant", content: "I initialized the session." },
          { role: "assistant", content: "Ready for instructions." }
        ]
      });

      expect(context).toContain("next prompt");
      expect(context).toContain("I initialized the session.");
    });

    it("handles provider runtime with missing optional fields", () => {
      const context = buildPlannerContext({
        prompt: "Build flow",
        providerRuntime: {
          providerId: "openai",
          authMode: "api_key",
          providerFastModeAvailable: false,
          fastModeRequested: false,
          fastModeEffective: false
        }
      });

      expect(context).toContain("Provider runtime profile:");
      expect(context).toContain("openai");
    });
  });
});
