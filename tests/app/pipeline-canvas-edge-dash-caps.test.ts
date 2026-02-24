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

function renderEdge(dasharray: string | null, route: Array<{ x: number; y: number }> = [
  { x: 0, y: 0 },
  { x: 40, y: 0 },
  { x: 40, y: 30 }
]): string {
  const length = routeLength(route);
  const data: EdgeRenderData = {
    link: {
      id: "edge-1",
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

describe("edge dash endpoint caps", () => {
  it("chooses a dashed phase that keeps endpoint visible and avoids corner boundary artifacts", () => {
    const route = [
      { x: 0, y: 0 },
      { x: 40, y: 0 },
      { x: 40, y: 30 }
    ];
    const html = renderEdge("8 7", route);

    const match = html.match(/stroke-dashoffset="([^"]+)"/);
    expect(match).not.toBeNull();
    const offset = Number(match?.[1] ?? "NaN");
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
    const match = html.match(/stroke-dashoffset="([^"]+)"/);
    expect(match).not.toBeNull();
    const offset = Number(match?.[1] ?? "NaN");

    const cycle = 15;
    const dash = 8;
    const cornerDistance = 64;
    const cornerPhase = ((cornerDistance + offset) % cycle + cycle) % cycle;
    const endpointPhase = ((routeLength(route) + offset) % cycle + cycle) % cycle;

    expect(endpointPhase).toBeLessThan(dash);
    expect(Math.min(Math.abs(cornerPhase), Math.abs(cornerPhase - dash))).toBeGreaterThanOrEqual(1);
  });
});
