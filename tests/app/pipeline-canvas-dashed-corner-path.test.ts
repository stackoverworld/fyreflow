import { describe, expect, it } from "vitest";
import { buildRenderedLinks } from "../../src/components/dashboard/pipeline-canvas/PipelineCanvas.handlers.ts";
import type { FlowLink, FlowNode } from "../../src/components/dashboard/pipeline-canvas/types.ts";

function createNode(id: string, x: number, y: number): FlowNode {
  return {
    id,
    name: id,
    role: "executor",
    providerId: "claude",
    model: "claude-sonnet-4-6",
    position: { x, y }
  };
}

describe("pipeline canvas dashed corner rendering", () => {
  it("keeps rounded path corners for dashed non-orchestrator links", () => {
    const left = createNode("left", 120, 240);
    const right = createNode("right", 640, 120);
    const nodes = [left, right];
    const links: FlowLink[] = [
      {
        id: "left-right",
        sourceStepId: left.id,
        targetStepId: right.id,
        condition: "always"
      }
    ];

    const rendered = buildRenderedLinks({
      links,
      nodes,
      nodeById: new Map(nodes.map((node) => [node.id, node])),
      previousAxisByLinkId: new Map(),
      manualRoutePoints: {},
      canUseSmartRoutes: false,
      smartRouteByLinkId: {},
      orchestratorLaneByLinkId: new Map(),
      reciprocalLaneByLinkId: new Map()
    });

    expect(rendered).toHaveLength(1);
    const dashed = rendered[0];
    expect(dashed.dasharray).toBe("8 7");
    expect(dashed.path.includes("Q")).toBe(true);
  });
});
