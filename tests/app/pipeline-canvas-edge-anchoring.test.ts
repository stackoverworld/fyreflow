import { describe, expect, it } from "vitest";
import { buildRenderedLinks } from "../../src/components/dashboard/pipeline-canvas/PipelineCanvas.handlers.ts";
import type { FlowLink, FlowNode, Point, Rect } from "../../src/components/dashboard/pipeline-canvas/types.ts";
import {
  NODE_WIDTH,
  nodeDelegationRect,
  nodeSourceAnchorRect,
  nodeTargetAnchorRect
} from "../../src/components/dashboard/pipeline-canvas/useNodeLayout.ts";

function createNode(id: string, x: number, y: number, delegated = false): FlowNode {
  return {
    id,
    name: id,
    role: delegated ? "orchestrator" : "executor",
    providerId: "claude",
    model: "claude-opus-4-6",
    position: { x, y },
    enableDelegation: delegated,
    delegationCount: delegated ? 3 : 0
  };
}

function isOnPerimeter(point: Point, rect: Rect): boolean {
  const onVertical = (point.x === rect.left || point.x === rect.right) && point.y >= rect.top && point.y <= rect.bottom;
  const onHorizontal = (point.y === rect.top || point.y === rect.bottom) && point.x >= rect.left && point.x <= rect.right;
  return onVertical || onHorizontal;
}

describe("pipeline canvas edge anchoring", () => {
  it("anchors delegated-node routes to the main card perimeter", () => {
    const source = createNode("source", 120, 220, true);
    const targetA = createNode("target-a", 600, 120);
    const targetB = createNode("target-b", 600, 260);
    const targetC = createNode("target-c", 600, 400);
    const nodes = [source, targetA, targetB, targetC];

    const links: FlowLink[] = [
      { id: "link-a", sourceStepId: source.id, targetStepId: targetA.id, condition: "always" },
      { id: "link-b", sourceStepId: source.id, targetStepId: targetB.id, condition: "always" },
      { id: "link-c", sourceStepId: source.id, targetStepId: targetC.id, condition: "always" }
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

    expect(rendered).toHaveLength(3);

    const anchorRect = nodeSourceAnchorRect(source);
    for (const link of rendered) {
      const start = link.route[0];
      expect(start).toBeDefined();
      expect(isOnPerimeter(start, anchorRect)).toBe(true);
      expect(start.y).toBeGreaterThanOrEqual(anchorRect.top);
      expect(start.y).toBeLessThanOrEqual(anchorRect.bottom);
      expect(start.x).toBeGreaterThanOrEqual(source.position.x);
      expect(start.x).toBeLessThanOrEqual(source.position.x + NODE_WIDTH);
    }
  });

  it("anchors incoming routes to delegated targets on the main card perimeter", () => {
    const source = createNode("source", 120, 220, false);
    const target = createNode("target", 600, 220, true);
    const links: FlowLink[] = [
      { id: "source-target", sourceStepId: source.id, targetStepId: target.id, condition: "always" }
    ];

    const rendered = buildRenderedLinks({
      links,
      nodes: [source, target],
      nodeById: new Map([
        [source.id, source],
        [target.id, target]
      ]),
      previousAxisByLinkId: new Map(),
      manualRoutePoints: {},
      canUseSmartRoutes: false,
      smartRouteByLinkId: {},
      orchestratorLaneByLinkId: new Map(),
      reciprocalLaneByLinkId: new Map()
    });

    expect(rendered).toHaveLength(1);
    const end = rendered[0].route[rendered[0].route.length - 1];
    const targetMainRect = nodeTargetAnchorRect(target);
    const targetDelegationRect = nodeDelegationRect(target);

    expect(isOnPerimeter(end, targetMainRect)).toBe(true);
    if (targetDelegationRect) {
      expect(end.y).toBeLessThan(targetDelegationRect.top);
    }
  });
});
