import { describe, expect, it } from "vitest";
import { buildChatPlannerContext, buildPlannerContext } from "../../server/flowBuilder/contexts.js";

describe("flow builder policy profile guidance", () => {
  it("planner context includes policy profile instructions", () => {
    const context = buildPlannerContext({
      prompt: "Build design to HTML to PDF investor deck pipeline"
    });

    expect(context).toContain("policyProfileIds");
    expect(context).toContain("design_deck_assets");
    expect(context).toContain("cacheBypassInputKeys");
    expect(context).toContain("cacheBypassOrchestratorPromptPatterns");
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
  });
});
