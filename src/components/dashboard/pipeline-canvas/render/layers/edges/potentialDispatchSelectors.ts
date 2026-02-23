import { parsePotentialDispatchRouteId } from "../../../potentialDispatchRouteId";
import type { RenderedLink } from "../../../types";
import type { PotentialDispatchRoute } from "./potentialDispatchRoutes";

type RouteOrientation = "horizontal" | "vertical";

interface RouteSegment {
  orientation: RouteOrientation;
  startX: number;
  endX: number;
  startY: number;
  endY: number;
}

export function getActivePotentialDispatchRouteIds(animatedLinkSet: Set<string>): Set<string> {
  const activePotentialRouteIds = new Set<string>();
  for (const linkId of animatedLinkSet) {
    if (parsePotentialDispatchRouteId(linkId)) {
      activePotentialRouteIds.add(linkId);
    }
  }
  return activePotentialRouteIds;
}

export function getPotentialDispatchOrchestratorIds(routeIds: Iterable<string>): string[] {
  const orchestratorIds = new Set<string>();
  for (const routeId of routeIds) {
    const parsedRouteId = parsePotentialDispatchRouteId(routeId);
    if (parsedRouteId) {
      orchestratorIds.add(parsedRouteId.orchestratorId);
    }
  }
  return [...orchestratorIds];
}

export function getLinksIntersectingPotentialRoutes(
  renderedLinks: RenderedLink[],
  activePotentialRoutes: PotentialDispatchRoute[]
): Set<string> {
  const intersectingLinkIds = new Set<string>();
  if (activePotentialRoutes.length === 0 || renderedLinks.length === 0) {
    return intersectingLinkIds;
  }

  for (const link of renderedLinks) {
    for (const potentialRoute of activePotentialRoutes) {
      if (routesIntersect(link.route, potentialRoute.route)) {
        intersectingLinkIds.add(link.id);
        break;
      }
    }
  }

  return intersectingLinkIds;
}

function routesIntersect(leftRoute: RenderedLink["route"], rightRoute: PotentialDispatchRoute["route"]): boolean {
  const leftSegments = toRouteSegments(leftRoute);
  const rightSegments = toRouteSegments(rightRoute);
  if (leftSegments.length === 0 || rightSegments.length === 0) {
    return false;
  }

  for (const leftSegment of leftSegments) {
    for (const rightSegment of rightSegments) {
      if (segmentsIntersect(leftSegment, rightSegment)) {
        return true;
      }
    }
  }

  return false;
}

function toRouteSegments(route: RenderedLink["route"]): RouteSegment[] {
  const segments: RouteSegment[] = [];

  for (let index = 1; index < route.length; index += 1) {
    const start = route[index - 1];
    const end = route[index];

    if (start.x === end.x && start.y === end.y) {
      continue;
    }

    if (start.x === end.x) {
      segments.push({
        orientation: "vertical",
        startX: start.x,
        endX: end.x,
        startY: Math.min(start.y, end.y),
        endY: Math.max(start.y, end.y)
      });
      continue;
    }

    if (start.y === end.y) {
      segments.push({
        orientation: "horizontal",
        startX: Math.min(start.x, end.x),
        endX: Math.max(start.x, end.x),
        startY: start.y,
        endY: end.y
      });
    }
  }

  return segments;
}

function segmentsIntersect(left: RouteSegment, right: RouteSegment): boolean {
  if (left.orientation === right.orientation) {
    if (left.orientation === "horizontal") {
      return left.startY === right.startY && rangesOverlap(left.startX, left.endX, right.startX, right.endX);
    }

    return left.startX === right.startX && rangesOverlap(left.startY, left.endY, right.startY, right.endY);
  }

  const horizontal = left.orientation === "horizontal" ? left : right;
  const vertical = left.orientation === "vertical" ? left : right;

  return (
    between(vertical.startX, horizontal.startX, horizontal.endX) &&
    between(horizontal.startY, vertical.startY, vertical.endY)
  );
}

function rangesOverlap(aStart: number, aEnd: number, bStart: number, bEnd: number): boolean {
  return Math.max(aStart, bStart) <= Math.min(aEnd, bEnd);
}

function between(value: number, min: number, max: number): boolean {
  return value >= Math.min(min, max) && value <= Math.max(min, max);
}
