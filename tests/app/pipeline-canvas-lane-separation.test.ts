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

describe("pipeline canvas lane separation", () => {
  it("keeps the target entry segment horizontal for separated overlapping links", () => {
    const source = createNode("source", 520, 180);
    const target = createNode("target", 200, 180);
    const nodes = [source, target];
    const links: FlowLink[] = [
      {
        id: "link-1",
        sourceStepId: source.id,
        targetStepId: target.id,
        condition: "always"
      },
      {
        id: "link-2",
        sourceStepId: source.id,
        targetStepId: target.id,
        condition: "on_fail"
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

    const primaryRoute = rendered.find((link) => link.id === "link-1")?.route;
    const separatedRoute = rendered.find((link) => link.id === "link-2")?.route;

    expect(primaryRoute).toBeDefined();
    expect(separatedRoute).toBeDefined();
    expect(separatedRoute).not.toEqual(primaryRoute);

    const end = separatedRoute?.[separatedRoute.length - 1];
    const beforeEnd = separatedRoute?.[separatedRoute.length - 2];
    expect(end).toBeDefined();
    expect(beforeEnd).toBeDefined();

    expect(beforeEnd?.y).toBe(end?.y);
    expect(beforeEnd?.x).toBeGreaterThan(end?.x ?? Number.POSITIVE_INFINITY);
  });
});
