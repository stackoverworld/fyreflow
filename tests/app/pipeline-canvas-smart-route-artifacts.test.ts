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

function segmentLength(a: { x: number; y: number }, b: { x: number; y: number }): number {
  return Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
}

function hasTinyEndpointHook(route: Array<{ x: number; y: number }>): boolean {
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
}

describe("pipeline canvas smart-route artifact filtering", () => {
  it("falls back to cleaner routing when smart route creates endpoint hook artifacts", () => {
    const source = createNode("source", 120, 220);
    const target = createNode("target", 620, 200);
    const nodes = [source, target];
    const link: FlowLink = {
      id: "source-target",
      sourceStepId: source.id,
      targetStepId: target.id,
      condition: "always"
    };

    const smartRoute = [
      { x: 360, y: 278 },
      { x: 580, y: 278 },
      { x: 580, y: 250 },
      { x: 612, y: 250 },
      { x: 612, y: 258 },
      { x: 620, y: 258 }
    ];

    const baseInput = {
      links: [link],
      nodes,
      nodeById: new Map(nodes.map((node) => [node.id, node])),
      previousAxisByLinkId: new Map(),
      manualRoutePoints: {},
      orchestratorLaneByLinkId: new Map(),
      reciprocalLaneByLinkId: new Map()
    };

    const withSmart = buildRenderedLinks({
      ...baseInput,
      canUseSmartRoutes: true,
      smartRouteByLinkId: { [link.id]: smartRoute }
    });

    const withoutSmart = buildRenderedLinks({
      ...baseInput,
      canUseSmartRoutes: false,
      smartRouteByLinkId: {}
    });

    expect(withSmart).toHaveLength(1);
    expect(withoutSmart).toHaveLength(1);
    expect(hasTinyEndpointHook(smartRoute)).toBe(true);
    expect(hasTinyEndpointHook(withSmart[0].route)).toBe(false);
    expect(withSmart[0].route).toEqual(withoutSmart[0].route);
  });
});
