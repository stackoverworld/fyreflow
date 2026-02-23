import { describe, expect, it } from "vitest";
import {
  getActivePotentialDispatchRouteIds,
  getLinksIntersectingPotentialRoutes,
  getPotentialDispatchOrchestratorIds
} from "../../src/components/dashboard/pipeline-canvas/render/layers/edges/potentialDispatchSelectors.ts";
import type { PotentialDispatchRoute } from "../../src/components/dashboard/pipeline-canvas/render/layers/edges/potentialDispatchRoutes.ts";
import type { Point, RenderedLink } from "../../src/components/dashboard/pipeline-canvas/types.ts";

function createRenderedLink(id: string, route: Point[]): RenderedLink {
  const endPoint = route[route.length - 1] ?? { x: 0, y: 0 };

  return {
    id,
    path: "M 0 0",
    route,
    pathDistance: 0,
    endPoint,
    axis: "horizontal",
    dasharray: null,
    hasOrchestrator: false,
    controlPoint: endPoint,
    hasManualRoute: false,
    visual: {
      stroke: "#fff",
      markerId: "flow-arrow"
    }
  };
}

function createPotentialRoute(id: string, route: Point[]): PotentialDispatchRoute {
  return {
    id,
    sourceNodeId: "orchestrator",
    targetNodeId: "executor",
    path: "M 0 0",
    route
  };
}

describe("potentialDispatchSelectors", () => {
  it("keeps only valid potential dispatch ids from animated links", () => {
    const animatedLinkSet = new Set<string>([
      "normal-link",
      "potential-dispatch:orch-a:node-1",
      "potential-dispatch:missing-target"
    ]);

    expect([...getActivePotentialDispatchRouteIds(animatedLinkSet)]).toEqual([
      "potential-dispatch:orch-a:node-1"
    ]);
  });

  it("extracts unique orchestrator ids from active potential dispatch route ids", () => {
    const routeIds = new Set<string>([
      "potential-dispatch:orch-a:node-1",
      "potential-dispatch:orch-a:node-2",
      "potential-dispatch:orch-b:node-3"
    ]);

    expect(getPotentialDispatchOrchestratorIds(routeIds)).toEqual(["orch-a", "orch-b"]);
  });

  it("finds rendered links that intersect the active potential dispatch route", () => {
    const renderedLinks: RenderedLink[] = [
      createRenderedLink("link-1", [
        { x: 20, y: 0 },
        { x: 20, y: 30 }
      ]),
      createRenderedLink("link-2", [
        { x: 0, y: 80 },
        { x: 40, y: 80 }
      ]),
      createRenderedLink("link-3", [
        { x: 50, y: 25 },
        { x: 50, y: 70 }
      ])
    ];
    const activeRoutes = [
      createPotentialRoute("potential-dispatch:orch-a:node-1", [
        { x: 0, y: 10 },
        { x: 50, y: 10 },
        { x: 50, y: 50 }
      ])
    ];

    expect([...getLinksIntersectingPotentialRoutes(renderedLinks, activeRoutes)].sort()).toEqual([
      "link-1",
      "link-3"
    ]);
  });
});
