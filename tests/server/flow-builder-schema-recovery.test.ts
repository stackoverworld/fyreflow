import { describe, expect, it } from "vitest";

import { recoverFlowDecisionEnvelope } from "../../server/flowBuilder/schema.js";

describe("flow builder schema recovery", () => {
  it("recovers action and nested flow from partially invalid copilot json", () => {
    const recovered = recoverFlowDecisionEnvelope(
      JSON.stringify({
        action: "replace_flow",
        response: { kind: "rich_text" },
        flow: {
          name: "Recovered flow",
          description: "desc",
          steps: [
            {
              id: "orchestrator",
              name: "Orchestrator",
              role: "orchestrator",
              prompt: "Coordinate the work."
            }
          ],
          links: [],
          qualityGates: []
        }
      })
    );

    expect(recovered).toMatchObject({
      action: "replace_flow",
      flow: {
        name: "Recovered flow",
        steps: [{ name: "Orchestrator" }]
      }
    });
  });
});
