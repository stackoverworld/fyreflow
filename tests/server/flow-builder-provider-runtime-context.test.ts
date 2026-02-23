import { describe, expect, it } from "vitest";
import { buildChatPlannerContext, buildPlannerContext } from "../../server/flowBuilder/contexts.js";

describe("Flow Builder provider runtime context", () => {
  it("injects provider runtime profile into planner context", () => {
    const context = buildPlannerContext({
      prompt: "Build investor deck flow",
      providerRuntime: {
        providerId: "claude",
        authMode: "oauth",
        claudeFastModeAvailable: false,
        fastModeRequested: true,
        fastModeEffective: false,
        fastModeNote: "Fast mode disabled because API key auth is not active."
      }
    });

    expect(context).toContain("Provider runtime profile:");
    expect(context).toContain("claude_fast_mode_available: no");
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
        claudeFastModeAvailable: true,
        fastModeRequested: true,
        fastModeEffective: true,
        fastModeNote: "Fast mode enabled."
      }
    });

    expect(context).toContain("Provider runtime profile:");
    expect(context).toContain("auth_mode: api_key");
    expect(context).toContain("claude_fast_mode_available: yes");
    expect(context).toContain("fast_mode_effective: on");
  });
});
