import { describe, expect, it } from "vitest";
import { buildRenderedLinks } from "../../src/components/dashboard/pipeline-canvas/PipelineCanvas.handlers.ts";
import {
  buildOrchestratorLaneByLinkId,
  buildReciprocalLaneByLinkId
} from "../../src/components/dashboard/pipeline-canvas/PipelineCanvas.viewport.ts";
import type { FlowLink, FlowNode, Point, Rect } from "../../src/components/dashboard/pipeline-canvas/types.ts";
import {
  NODE_WIDTH,
  nodeDelegationRect,
  nodeRect,
  nodeSourceAnchorRect,
  nodeTargetAnchorRect
} from "../../src/components/dashboard/pipeline-canvas/useNodeLayout.ts";
import { DROPDOWN_MENU_CONTENT_CLASS, SELECT_DROPDOWN_CONTENT_CLASS } from "../../src/components/optics/overlay-classes.ts";

function createNode(id: string, x: number, y: number, opts?: { delegated?: boolean; role?: FlowNode["role"] }): FlowNode {
  const delegated = opts?.delegated ?? false;
  return {
    id,
    name: id,
    role: opts?.role ?? (delegated ? "orchestrator" : "executor"),
    providerId: "claude",
    model: delegated ? "claude-opus-4-6" : "claude-sonnet-4-6",
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

function hasUndersizedEndpointLeg(route: Array<{ x: number; y: number }>): boolean {
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
}

function hasOuterHorizontalLane(route: Array<{ x: number; y: number }>, minTop: number, maxBottom: number): boolean {
  for (let index = 1; index < route.length; index += 1) {
    const previous = route[index - 1];
    const current = route[index];
    if (previous.y !== current.y) {
      continue;
    }

    const segmentY = previous.y;
    const segmentLengthX = Math.abs(current.x - previous.x);
    const outsideBounds = segmentY < minTop || segmentY > maxBottom;
    if (outsideBounds && segmentLengthX >= 40) {
      return true;
    }
  }

  return false;
}

function segmentCrosses(
  aStart: { x: number; y: number },
  aEnd: { x: number; y: number },
  bStart: { x: number; y: number },
  bEnd: { x: number; y: number }
): boolean {
  const aVertical = aStart.x === aEnd.x;
  const bVertical = bStart.x === bEnd.x;
  const aHorizontal = aStart.y === aEnd.y;
  const bHorizontal = bStart.y === bEnd.y;

  if ((aVertical && bVertical) || (aHorizontal && bHorizontal)) {
    return false;
  }

  const horizontalStart = aHorizontal ? aStart : bStart;
  const horizontalEnd = aHorizontal ? aEnd : bEnd;
  const verticalStart = aVertical ? aStart : bStart;
  const verticalEnd = aVertical ? aEnd : bEnd;

  if (horizontalStart.y !== horizontalEnd.y || verticalStart.x !== verticalEnd.x) {
    return false;
  }

  const horizontalMinX = Math.min(horizontalStart.x, horizontalEnd.x);
  const horizontalMaxX = Math.max(horizontalStart.x, horizontalEnd.x);
  const verticalMinY = Math.min(verticalStart.y, verticalEnd.y);
  const verticalMaxY = Math.max(verticalStart.y, verticalEnd.y);
  const intersectionX = verticalStart.x;
  const intersectionY = horizontalStart.y;

  return (
    intersectionX > horizontalMinX &&
    intersectionX < horizontalMaxX &&
    intersectionY > verticalMinY &&
    intersectionY < verticalMaxY
  );
}

function routeCrossingCount(routes: Array<Array<{ x: number; y: number }>>): number {
  let count = 0;

  for (let routeIndex = 1; routeIndex < routes.length; routeIndex += 1) {
    const route = routes[routeIndex];
    for (let previousIndex = 0; previousIndex < routeIndex; previousIndex += 1) {
      const previous = routes[previousIndex];
      for (let a = 1; a < route.length; a += 1) {
        for (let b = 1; b < previous.length; b += 1) {
          if (segmentCrosses(route[a - 1], route[a], previous[b - 1], previous[b])) {
            count += 1;
          }
        }
      }
    }
  }

  return count;
}

function buildInput(nodes: FlowNode[], links: FlowLink[], extra?: Partial<Parameters<typeof buildRenderedLinks>[0]>) {
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  return {
    links,
    nodes,
    nodeById,
    previousAxisByLinkId: new Map(),
    manualRoutePoints: {},
    canUseSmartRoutes: false,
    smartRouteByLinkId: {},
    orchestratorLaneByLinkId: new Map(),
    reciprocalLaneByLinkId: new Map(),
    ...extra
  };
}

describe("pipeline canvas routing", () => {
  describe("dashed corner rendering", () => {
    it("keeps rounded path corners for dashed non-orchestrator links", () => {
      const left = createNode("left", 120, 240);
      const right = createNode("right", 640, 120);
      const nodes = [left, right];
      const links: FlowLink[] = [
        { id: "left-right", sourceStepId: left.id, targetStepId: right.id, condition: "always" }
      ];

      const rendered = buildRenderedLinks(buildInput(nodes, links));

      expect(rendered).toHaveLength(1);
      const dashed = rendered[0];
      expect(dashed.dasharray).toBe("8 7");
      expect(dashed.path.includes("Q")).toBe(true);
    });
  });

  describe("edge anchoring", () => {
    it("anchors delegated-node routes to the main card perimeter", () => {
      const source = createNode("source", 120, 220, { delegated: true });
      const targetA = createNode("target-a", 600, 120);
      const targetB = createNode("target-b", 600, 260);
      const targetC = createNode("target-c", 600, 400);
      const nodes = [source, targetA, targetB, targetC];

      const links: FlowLink[] = [
        { id: "link-a", sourceStepId: source.id, targetStepId: targetA.id, condition: "always" },
        { id: "link-b", sourceStepId: source.id, targetStepId: targetB.id, condition: "always" },
        { id: "link-c", sourceStepId: source.id, targetStepId: targetC.id, condition: "always" }
      ];

      const rendered = buildRenderedLinks(buildInput(nodes, links));

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
      const source = createNode("source", 120, 220);
      const target = createNode("target", 600, 220, { delegated: true });
      const links: FlowLink[] = [
        { id: "source-target", sourceStepId: source.id, targetStepId: target.id, condition: "always" }
      ];

      const rendered = buildRenderedLinks(buildInput([source, target], links));

      expect(rendered).toHaveLength(1);
      const end = rendered[0].route[rendered[0].route.length - 1];
      const targetMainRect = nodeTargetAnchorRect(target);
      const targetDelegationRect = nodeDelegationRect(target);

      expect(isOnPerimeter(end, targetMainRect)).toBe(true);
      if (targetDelegationRect) {
        expect(end.y).toBeLessThan(targetDelegationRect.top);
      }
    });

    it("distributes source ports across a side for fan-out links", () => {
      const source = createNode("source", 120, 220);
      const targetA = createNode("target-a", 640, 120);
      const targetB = createNode("target-b", 640, 240);
      const targetC = createNode("target-c", 640, 360);
      const links: FlowLink[] = [
        { id: "fan-a", sourceStepId: source.id, targetStepId: targetA.id, condition: "always" },
        { id: "fan-b", sourceStepId: source.id, targetStepId: targetB.id, condition: "always" },
        { id: "fan-c", sourceStepId: source.id, targetStepId: targetC.id, condition: "always" }
      ];

      const rendered = buildRenderedLinks(buildInput([source, targetA, targetB, targetC], links));
      const sourceRect = nodeSourceAnchorRect(source);
      const startPoints = rendered.map((entry) => entry.route[0]).filter(Boolean);

      expect(rendered).toHaveLength(3);
      for (const startPoint of startPoints) {
        expect(isOnPerimeter(startPoint, sourceRect)).toBe(true);
      }

      const distinctY = new Set(startPoints.map((point) => point.y));
      expect(distinctY.size).toBeGreaterThan(1);
    });
  });

  describe("lane separation", () => {
    it("avoids tiny endpoint hooks when resolving overlapping dashed links", () => {
      const source = createNode("source", 520, 180);
      const target = createNode("target", 200, 180);
      const nodes = [source, target];
      const links: FlowLink[] = [
        { id: "link-1", sourceStepId: source.id, targetStepId: target.id, condition: "always" },
        { id: "link-2", sourceStepId: source.id, targetStepId: target.id, condition: "on_fail" }
      ];

      const rendered = buildRenderedLinks(buildInput(nodes, links));

      const primaryRoute = rendered.find((link) => link.id === "link-1")?.route;
      const separatedRoute = rendered.find((link) => link.id === "link-2")?.route;

      expect(primaryRoute).toBeDefined();
      expect(separatedRoute).toBeDefined();
      if (!primaryRoute || !separatedRoute) return;

      expect(hasTinyEndpointHook(primaryRoute)).toBe(false);
      expect(hasTinyEndpointHook(separatedRoute)).toBe(false);
      expect(hasUndersizedEndpointLeg(primaryRoute)).toBe(false);
      expect(hasUndersizedEndpointLeg(separatedRoute)).toBe(false);
    });

    it("avoids interior crossings on crisscross links when alternatives exist", () => {
      const topLeft = createNode("top-left", 80, 80);
      const topRight = createNode("top-right", 760, 80);
      const bottomLeft = createNode("bottom-left", 80, 360);
      const bottomRight = createNode("bottom-right", 760, 360);
      const centerBlocker = createNode("center-blocker", 440, 220);
      const nodes = [topLeft, topRight, bottomLeft, bottomRight, centerBlocker];
      const links: FlowLink[] = [
        { id: "diag-a", sourceStepId: topLeft.id, targetStepId: bottomRight.id, condition: "always" },
        { id: "diag-b", sourceStepId: bottomLeft.id, targetStepId: topRight.id, condition: "always" }
      ];

      const rendered = buildRenderedLinks(buildInput(nodes, links));
      const routes = rendered.map((entry) => entry.route);

      expect(rendered).toHaveLength(2);
      expect(routeCrossingCount(routes)).toBe(0);
    });
  });

  describe("feedback gutters", () => {
    it("routes on_fail links through a dedicated outer lane", () => {
      const source = createNode("source", 960, 220);
      const target = createNode("target", 240, 160);
      const blocker = createNode("blocker", 620, 200);
      const nodes = [source, target, blocker];
      const links: FlowLink[] = [
        { id: "feedback", sourceStepId: source.id, targetStepId: target.id, condition: "on_fail" }
      ];

      const rendered = buildRenderedLinks(buildInput(nodes, links));

      expect(rendered).toHaveLength(1);
      const route = rendered[0]?.route ?? [];
      const bounds = nodes.map((node) => nodeRect(node));
      const minTop = Math.min(...bounds.map((rect) => rect.top));
      const maxBottom = Math.max(...bounds.map((rect) => rect.bottom));

      expect(hasOuterHorizontalLane(route, minTop, maxBottom)).toBe(true);
    });
  });

  describe("routing stability", () => {
    it("keeps computed routes stable when link input order changes", () => {
      const source = createNode("source", 920, 220);
      const target = createNode("target", 220, 180);
      const blocker = createNode("blocker", 560, 200);
      const nodes = [source, target, blocker];
      const links: FlowLink[] = [
        { id: "feedback", sourceStepId: source.id, targetStepId: target.id, condition: "on_fail" },
        { id: "forward", sourceStepId: target.id, targetStepId: source.id, condition: "always" }
      ];

      const renderedOriginal = buildRenderedLinks(buildInput(nodes, links));
      const renderedReordered = buildRenderedLinks(buildInput(nodes, [...links].reverse()));

      const routeByIdOriginal = new Map(renderedOriginal.map((entry) => [entry.id, entry.route]));
      const routeByIdReordered = new Map(renderedReordered.map((entry) => [entry.id, entry.route]));

      expect(routeByIdOriginal.get("feedback")).toEqual(routeByIdReordered.get("feedback"));
      expect(routeByIdOriginal.get("forward")).toEqual(routeByIdReordered.get("forward"));
    });
  });

  describe("smart-route artifact filtering", () => {
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

      const baseInput = buildInput(nodes, [link]);

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

  describe("special route anchoring", () => {
    it("keeps reciprocal link endpoints on main card perimeter for delegated nodes", () => {
      const left = createNode("left", 120, 180, { delegated: true });
      const right = createNode("right", 620, 220, { delegated: true });
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
        expect(link).toBeDefined();
        if (!link) continue;
        const sourceNode = nodeById.get(link.sourceStepId);
        const targetNode = nodeById.get(link.targetStepId);
        expect(sourceNode).toBeDefined();
        expect(targetNode).toBeDefined();
        if (!sourceNode || !targetNode) continue;

        const start = edge.route[0];
        const end = edge.route[edge.route.length - 1];
        expect(start).toBeDefined();
        expect(end).toBeDefined();
        if (!start || !end) continue;

        const sourceRect = nodeSourceAnchorRect(sourceNode);
        const targetRect = nodeTargetAnchorRect(targetNode);
        expect(isOnPerimeter(start, sourceRect)).toBe(true);
        expect(isOnPerimeter(end, targetRect)).toBe(true);
        expect(start.y).toBeGreaterThanOrEqual(sourceRect.top);
        expect(start.y).toBeLessThanOrEqual(sourceRect.bottom);
        expect(end.y).toBeGreaterThanOrEqual(targetRect.top);
        expect(end.y).toBeLessThanOrEqual(targetRect.bottom);

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

  describe("edge cases", () => {
    it("returns empty array for zero nodes and zero links", () => {
      const rendered = buildRenderedLinks(buildInput([], []));
      expect(rendered).toEqual([]);
    });

    it("returns empty array for a single node with no links", () => {
      const node = createNode("solo", 200, 200);
      const rendered = buildRenderedLinks(buildInput([node], []));
      expect(rendered).toEqual([]);
    });

    it("handles circular link references without crashing", () => {
      const a = createNode("a", 120, 120);
      const b = createNode("b", 520, 120);
      const links: FlowLink[] = [
        { id: "a-to-b", sourceStepId: "a", targetStepId: "b", condition: "always" },
        { id: "b-to-a", sourceStepId: "b", targetStepId: "a", condition: "always" }
      ];

      const rendered = buildRenderedLinks(buildInput([a, b], links));
      expect(rendered).toHaveLength(2);
      for (const edge of rendered) {
        expect(edge.route.length).toBeGreaterThanOrEqual(2);
      }
    });

    it("handles a long chain of 12 steps without layout artifacts", () => {
      const nodes = Array.from({ length: 12 }, (_, i) =>
        createNode(`step-${i}`, 120 + i * 200, 200 + (i % 2) * 60)
      );
      const links: FlowLink[] = nodes.slice(0, -1).map((node, i) => ({
        id: `link-${i}`,
        sourceStepId: node.id,
        targetStepId: nodes[i + 1].id,
        condition: "always" as const
      }));

      const rendered = buildRenderedLinks(buildInput(nodes, links));
      expect(rendered).toHaveLength(11);
      for (const edge of rendered) {
        expect(edge.route.length).toBeGreaterThanOrEqual(2);
        expect(hasTinyEndpointHook(edge.route)).toBe(false);
      }
    });
  });

  describe("overlay classes", () => {
    it("keeps dropdown menu surfaces frosted", () => {
      expect(DROPDOWN_MENU_CONTENT_CLASS).toContain("bg-ink-900/55");
      expect(DROPDOWN_MENU_CONTENT_CLASS).toContain("backdrop-blur-xl");
      expect(DROPDOWN_MENU_CONTENT_CLASS).toContain("backdrop-saturate-150");
    });

    it("keeps select dropdown surfaces frosted", () => {
      expect(SELECT_DROPDOWN_CONTENT_CLASS).toContain("bg-ink-900/55");
      expect(SELECT_DROPDOWN_CONTENT_CLASS).toContain("backdrop-blur-xl");
      expect(SELECT_DROPDOWN_CONTENT_CLASS).toContain("backdrop-saturate-150");
    });
  });
});
