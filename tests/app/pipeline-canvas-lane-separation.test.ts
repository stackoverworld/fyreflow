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
  it("avoids tiny endpoint hooks when resolving overlapping dashed links", () => {
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
    expect(primaryRoute).not.toBeNull();
    expect(separatedRoute).not.toBeNull();
    if (!primaryRoute || !separatedRoute) {
      return;
    }

    const segmentLength = (a: { x: number; y: number }, b: { x: number; y: number }): number =>
      Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
    const hasTinyEndpointHook = (route: Array<{ x: number; y: number }>): boolean => {
      if (route.length >= 3) {
        const first = segmentLength(route[0], route[1]);
        const second = segmentLength(route[1], route[2]);
        if (first <= 26 && second <= 26) {
          return true;
        }
      }
      if (route.length >= 4) {
        const n = route.length;
        const last = segmentLength(route[n - 2], route[n - 1]);
        const beforeLast = segmentLength(route[n - 3], route[n - 2]);
        if (last <= 26 && beforeLast <= 26) {
          return true;
        }
      }
      return false;
    };

    const hasUndersizedEndpointLeg = (route: Array<{ x: number; y: number }>): boolean => {
      if (route.length < 3) {
        return false;
      }
      const first = segmentLength(route[0], route[1]);
      const second = segmentLength(route[1], route[2]);
      if (first < 32 && second > 32) {
        return true;
      }

      const n = route.length;
      const last = segmentLength(route[n - 2], route[n - 1]);
      const beforeLast = segmentLength(route[n - 3], route[n - 2]);
      return last < 32 && beforeLast > 32;
    };

    expect(hasTinyEndpointHook(primaryRoute)).toBe(false);
    expect(hasTinyEndpointHook(separatedRoute)).toBe(false);
    expect(hasUndersizedEndpointLeg(primaryRoute)).toBe(false);
    expect(hasUndersizedEndpointLeg(separatedRoute)).toBe(false);
  });
});
