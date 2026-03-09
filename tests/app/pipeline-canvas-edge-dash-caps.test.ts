import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { EdgePathGroup } from "../../src/components/dashboard/pipeline-canvas/render/layers/edges/EdgePathGroup.tsx";
import type { EdgeRenderData } from "../../src/components/dashboard/pipeline-canvas/render/layers/edges/useEdgeRenderData.ts";

function routeLength(route: Array<{ x: number; y: number }>): number {
  return route.slice(1).reduce((sum, point, index) => {
    const previous = route[index];
    return sum + Math.abs(point.x - previous.x) + Math.abs(point.y - previous.y);
  }, 0);
}

function routePath(route: Array<{ x: number; y: number }>): string {
  if (route.length === 0) {
    return "";
  }

  return route
    .map((point, index) => (index === 0 ? `M ${point.x} ${point.y}` : `L ${point.x} ${point.y}`))
    .join(" ");
}

function renderEdge(
  dasharray: string | null,
  route: Array<{ x: number; y: number }> = [
    { x: 0, y: 0 },
    { x: 40, y: 0 },
    { x: 40, y: 30 }
  ],
  id: string = "edge-1"
): string {
  const length = routeLength(route);
  const data: EdgeRenderData = {
    link: {
      id,
      path: routePath(route),
      route,
      pathDistance: length,
      endPoint: route[route.length - 1],
      axis: "horizontal",
      dasharray,
      hasOrchestrator: false,
      controlPoint: route[Math.floor(route.length / 2)] ?? route[0],
      hasManualRoute: false,
      visual: {
        stroke: "#f87171",
        markerId: "flow-arrow-fail"
      }
    },
    isSelected: false,
    isPrimarySelected: false,
    isAnimated: false,
    baseStrokeWidth: 2,
    selectedStrokeWidth: 3,
    edgeOpacity: 1,
    selectedHaloOpacity: 0
  };

  return renderToStaticMarkup(createElement(EdgePathGroup, { data }));
}

function extractDashOffset(markup: string): number {
  const match = markup.match(/stroke-dashoffset="([^"]+)"/);
  expect(match).not.toBeNull();
  return Number(match?.[1] ?? "NaN");
}

describe("edge dash endpoint caps", () => {
  it("renders a background separator underlay for overlap readability", () => {
    const dashed = renderEdge("8 7");
    const solid = renderEdge(null);

    expect(dashed).toContain('stroke="rgb(var(--canvas-bg))"');
    expect(solid).toContain('stroke="rgb(var(--canvas-bg))"');
  });

  it("chooses a dashed phase that keeps endpoint visible and avoids corner boundary artifacts", () => {
    const route = [
      { x: 0, y: 0 },
      { x: 40, y: 0 },
      { x: 40, y: 30 }
    ];
    const html = renderEdge("8 7", route);

    const offset = extractDashOffset(html);
    expect(Number.isFinite(offset)).toBe(true);

    const cycle = 15;
    const dash = 8;
    const endpointPhase = ((routeLength(route) + offset) % cycle + cycle) % cycle;
    const cornerPhase = ((40 + offset) % cycle + cycle) % cycle;

    expect(endpointPhase).toBeLessThan(dash);
    expect(endpointPhase).toBeGreaterThanOrEqual(3);
    expect(Math.min(Math.abs(cornerPhase), Math.abs(cornerPhase - dash))).toBeGreaterThanOrEqual(1);

    expect(html).not.toContain('d="M 0 0 L 8 0"');
    expect(html).not.toContain('d="M 40 22 L 40 30"');
  });

  it("does not apply dash offset for solid links", () => {
    const html = renderEdge(null);

    expect(html).not.toContain("stroke-dashoffset");
  });

  it("avoids exact dash boundaries on corners for problematic hook geometry", () => {
    const route = [
      { x: 1272, y: -76 },
      { x: 1336, y: -76 },
      { x: 1336, y: -174 }
    ];
    const html = renderEdge("8 7", route);
    const offset = extractDashOffset(html);

    const cycle = 15;
    const dash = 8;
    const cornerDistance = 64;
    const cornerPhase = ((cornerDistance + offset) % cycle + cycle) % cycle;
    const endpointPhase = ((routeLength(route) + offset) % cycle + cycle) % cycle;

    expect(endpointPhase).toBeLessThan(dash);
    expect(Math.min(Math.abs(cornerPhase), Math.abs(cornerPhase - dash))).toBeGreaterThanOrEqual(1);
  });

  it("uses stable id-based dash phase to reduce identical-path overlap ambiguity", () => {
    const route = [
      { x: 0, y: 0 },
      { x: 40, y: 0 },
      { x: 40, y: 30 }
    ];
    const first = renderEdge("8 7", route, "edge-1");
    const second = renderEdge("8 7", route, "edge-2");

    const firstOffset = extractDashOffset(first);
    const secondOffset = extractDashOffset(second);

    expect(firstOffset).not.toEqual(secondOffset);
  });
});
