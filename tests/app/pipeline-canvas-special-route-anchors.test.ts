import { describe, expect, it } from "vitest";
import { buildRenderedLinks } from "../../src/components/dashboard/pipeline-canvas/PipelineCanvas.handlers.ts";
import {
  buildOrchestratorLaneByLinkId,
  buildReciprocalLaneByLinkId
} from "../../src/components/dashboard/pipeline-canvas/PipelineCanvas.viewport.ts";
import type { FlowLink, FlowNode, Point, Rect } from "../../src/components/dashboard/pipeline-canvas/types.ts";
import {
  nodeSourceAnchorRect,
  nodeTargetAnchorRect
} from "../../src/components/dashboard/pipeline-canvas/useNodeLayout.ts";

function node(
  id: string,
  role: FlowNode["role"],
  x: number,
  y: number,
  withDelegation = true
): FlowNode {
  return {
    id,
    name: id,
    role,
    providerId: "claude",
    model: "claude-opus-4-6",
    position: { x, y },
    enableDelegation: withDelegation,
    delegationCount: withDelegation ? 2 : 0
  };
}

function onPerimeter(point: Point, rect: Rect): boolean {
  const onVertical = (point.x === rect.left || point.x === rect.right) && point.y >= rect.top && point.y <= rect.bottom;
  const onHorizontal = (point.y === rect.top || point.y === rect.bottom) && point.x >= rect.left && point.x <= rect.right;
  return onVertical || onHorizontal;
}

function segmentLength(a: Point, b: Point): number {
  return Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
}

describe("pipeline canvas special route anchoring", () => {
  it("keeps reciprocal link endpoints on main card perimeter for delegated nodes", () => {
    const left = node("left", "executor", 120, 180, true);
    const right = node("right", "executor", 620, 220, true);
    const nodes = [left, right];
    const links: FlowLink[] = [
      { id: "a-to-b-fail", sourceStepId: left.id, targetStepId: right.id, condition: "on_fail" },
      { id: "a-to-b-always", sourceStepId: left.id, targetStepId: right.id, condition: "always" },
      { id: "b-to-a-fail", sourceStepId: right.id, targetStepId: left.id, condition: "on_fail" },
      { id: "b-to-a-always", sourceStepId: right.id, targetStepId: left.id, condition: "always" }
    ];
    const nodeById = new Map(nodes.map((entry) => [entry.id, entry]));

    const rendered = buildRenderedLinks({
      links,
      nodes,
      nodeById,
      previousAxisByLinkId: new Map(),
      manualRoutePoints: {},
      canUseSmartRoutes: false,
      smartRouteByLinkId: {},
      orchestratorLaneByLinkId: buildOrchestratorLaneByLinkId({ links, nodeById }),
      reciprocalLaneByLinkId: buildReciprocalLaneByLinkId({ links, nodeById })
    });

    expect(rendered).toHaveLength(4);

    for (const edge of rendered) {
      const link = links.find((entry) => entry.id === edge.id);
      expect(link).toBeTruthy();
      if (!link) {
        continue;
      }
      const sourceNode = nodeById.get(link.sourceStepId);
      const targetNode = nodeById.get(link.targetStepId);
      expect(sourceNode).toBeTruthy();
      expect(targetNode).toBeTruthy();
      if (!sourceNode || !targetNode) {
        continue;
      }

      const start = edge.route[0];
      const end = edge.route[edge.route.length - 1];
      expect(start).toBeDefined();
      expect(end).toBeDefined();
      if (!start || !end) {
        continue;
      }

      const sourceRect = nodeSourceAnchorRect(sourceNode);
      const targetRect = nodeTargetAnchorRect(targetNode);
      expect(onPerimeter(start, sourceRect)).toBe(true);
      expect(onPerimeter(end, targetRect)).toBe(true);
      expect(start.y).toBeGreaterThanOrEqual(sourceRect.top);
      expect(start.y).toBeLessThanOrEqual(sourceRect.bottom);
      expect(end.y).toBeGreaterThanOrEqual(targetRect.top);
      expect(end.y).toBeLessThanOrEqual(targetRect.bottom);

      // Prevent tiny hook artifacts right on node endpoints.
      if (edge.route.length >= 3) {
        const firstLen = segmentLength(edge.route[0], edge.route[1]);
        const secondLen = segmentLength(edge.route[1], edge.route[2]);
        expect(!(firstLen <= 26 && secondLen <= 26)).toBe(true);
      }
      if (edge.route.length >= 4) {
        const n = edge.route.length;
        const lastLen = segmentLength(edge.route[n - 2], edge.route[n - 1]);
        const prevLen = segmentLength(edge.route[n - 3], edge.route[n - 2]);
        expect(!(lastLen <= 26 && prevLen <= 26)).toBe(true);
      }
    }
  });
});
