import {
  average,
  FlowLayoutOptions,
  LayoutLink,
  LayoutStep,
  median,
  normalizeElkRoute,
  RouteLinkInput,
  RouteNodeInput,
  ElkEdgeSectionLike,
  Position,
  routeEndpointsAreValid,
  routeLength,
  toRoundedPoint
} from "./normalize";

import {
  DEFAULT_NODE_HEIGHT,
  DEFAULT_NODE_WIDTH,
  DEFAULT_START_X,
  DEFAULT_CENTER_Y,
  ROUTE_MAX_POINTS,
  ROUTE_PATH_EXTRA_LIMIT,
  ROUTE_PATH_STRETCH_LIMIT
} from "./constants";
import { layoutNodeVisualHeight } from "./nodeDimensions";
import { computeAutoLayoutPositions } from "./layout";
import { buildElkGraph, buildElkRouteGraph, getElkInstance } from "./graphMutations";
import { routeFromElkSections } from "./graphTraversal";

export { buildElkGraph } from "./graphMutations";

function layoutBoundsById(
  positions: Record<string, Position>,
  stepIds: string[],
  heightByStepId: ReadonlyMap<string, number>
): { width: number; height: number } {
  let minX = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;

  for (const stepId of stepIds) {
    const position = positions[stepId];
    if (!position) {
      continue;
    }
    const stepHeight = heightByStepId.get(stepId) ?? DEFAULT_NODE_HEIGHT;
    minX = Math.min(minX, position.x);
    maxX = Math.max(maxX, position.x + DEFAULT_NODE_WIDTH);
    minY = Math.min(minY, position.y);
    maxY = Math.max(maxY, position.y + stepHeight);
  }

  if (!Number.isFinite(minX) || !Number.isFinite(maxX) || !Number.isFinite(minY) || !Number.isFinite(maxY)) {
    return { width: 0, height: 0 };
  }

  return {
    width: maxX - minX,
    height: maxY - minY
  };
}

function shouldPreferCompactFallback(
  elkPositions: Record<string, Position>,
  fallbackPositions: Record<string, Position>,
  stepIds: string[],
  heightByStepId: ReadonlyMap<string, number>
): boolean {
  const elkBounds = layoutBoundsById(elkPositions, stepIds, heightByStepId);
  const fallbackBounds = layoutBoundsById(fallbackPositions, stepIds, heightByStepId);
  if (elkBounds.width <= 0 || fallbackBounds.width <= 0) {
    return false;
  }

  const elkAspect = elkBounds.width / Math.max(1, elkBounds.height);
  const isOverlyWide = elkBounds.width > fallbackBounds.width * 1.14;
  return isOverlyWide && elkBounds.width > 1600 && elkAspect > 2;
}

export async function computeEdgeRoutesSmart(
  nodes: RouteNodeInput[],
  links: RouteLinkInput[],
  options: FlowLayoutOptions = {}
): Promise<Record<string, Position[]>> {
  if (nodes.length === 0 || links.length === 0) {
    return {};
  }

  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const { graph, routeLinks } = buildElkRouteGraph(nodes, links, options);

  if (routeLinks.length === 0) {
    return {};
  }

  try {
    const elk = await getElkInstance();
    const layout = await elk.layout(graph);
    const laidOutNodes = layout.children ?? [];
    const layoutNodeById = new Map(laidOutNodes.filter((node) => node.id).map((node) => [node.id as string, node]));
    const offsetXValues: number[] = [];
    const offsetYValues: number[] = [];

    for (const node of nodes) {
      const laidOutNode = layoutNodeById.get(node.id);
      if (!laidOutNode || typeof laidOutNode.x !== "number" || typeof laidOutNode.y !== "number") {
        continue;
      }

      offsetXValues.push(node.position.x - laidOutNode.x);
      offsetYValues.push(node.position.y - laidOutNode.y);
    }

    if (offsetXValues.length === 0 || offsetYValues.length === 0) {
      return {};
    }

    const offsetX = median(offsetXValues);
    const offsetY = median(offsetYValues);
    const linkById = new Map(routeLinks.map((link) => [link.id, link]));
    const routesByLinkId: Record<string, Position[]> = {};

    for (const edge of layout.edges ?? []) {
      if (!edge.id) {
        continue;
      }

      const link = linkById.get(edge.id);
      if (!link) {
        continue;
      }

      const sourceNode = nodeById.get(link.sourceStepId);
      const targetNode = nodeById.get(link.targetStepId);
      if (!sourceNode || !targetNode) {
        continue;
      }

      const sections = (edge.sections ?? []) as ElkEdgeSectionLike[];
      const rawRoute = routeFromElkSections(sections);
      if (rawRoute.length < 2) {
        continue;
      }

      const translated = normalizeElkRoute(
        rawRoute.map((point) => ({
          x: point.x + offsetX,
          y: point.y + offsetY
        }))
      ).map(toRoundedPoint);

      if (translated.length < 2) {
        continue;
      }

      if (!routeEndpointsAreValid(translated, sourceNode, targetNode)) {
        continue;
      }

      const sourceCenter = {
        x: sourceNode.position.x + DEFAULT_NODE_WIDTH / 2,
        y: sourceNode.position.y + DEFAULT_NODE_HEIGHT / 2
      };
      const targetCenter = {
        x: targetNode.position.x + DEFAULT_NODE_WIDTH / 2,
        y: targetNode.position.y + DEFAULT_NODE_HEIGHT / 2
      };
      const baselineLength = Math.abs(targetCenter.x - sourceCenter.x) + Math.abs(targetCenter.y - sourceCenter.y);
      const pathLength = routeLength(translated);
      const maxAllowedLength = Math.max(
        baselineLength * ROUTE_PATH_STRETCH_LIMIT,
        baselineLength + ROUTE_PATH_EXTRA_LIMIT
      );

      if (pathLength > maxAllowedLength || translated.length > ROUTE_MAX_POINTS) {
        continue;
      }

      routesByLinkId[link.id] = translated;
    }

    return routesByLinkId;
  } catch {
    return {};
  }
}

export async function computeAutoLayoutPositionsSmart(
  steps: LayoutStep[],
  links: LayoutLink[],
  options: FlowLayoutOptions = {}
): Promise<Record<string, Position>> {
  if (steps.length === 0) {
    return {};
  }

  const visualHeightByStepId = new Map(steps.map((step) => [step.id, layoutNodeVisualHeight(step)]));
  const fallbackPositions = computeAutoLayoutPositions(steps, links, options);

  try {
    const graph = buildElkGraph(steps, links, options);
    const elk = await getElkInstance();
    const layout = await elk.layout(graph);
    const laidOutNodes = layout.children ?? [];
    if (laidOutNodes.length === 0) {
      return fallbackPositions;
    }

    const xValues = laidOutNodes
      .map((node) => node.x)
      .filter((value): value is number => typeof value === "number");
    const yTopValues = laidOutNodes
      .map((node) => node.y)
      .filter((value): value is number => typeof value === "number");
    const yBottomValues = laidOutNodes
      .map((node) => (typeof node.y === "number" ? node.y + (node.height ?? DEFAULT_NODE_HEIGHT) : undefined))
      .filter((value): value is number => typeof value === "number");

    if (xValues.length === 0 || yTopValues.length === 0 || yBottomValues.length === 0) {
      return fallbackPositions;
    }

    const minX = Math.min(...xValues);
    const minY = Math.min(...yTopValues);
    const maxY = Math.max(...yBottomValues);
    const startX = Math.round(options.startX ?? DEFAULT_START_X);
    const existingCenterY = average(
      steps.map((step) => (step.position?.y ?? DEFAULT_CENTER_Y) + (visualHeightByStepId.get(step.id) ?? DEFAULT_NODE_HEIGHT) / 2)
    );
    const centerY = options.centerY ?? existingCenterY;
    const layoutCenterY = (minY + maxY) / 2;
    const offsetX = startX - minX;
    const offsetY = centerY - layoutCenterY;
    const positionById: Record<string, Position> = {};

    for (const node of laidOutNodes) {
      if (!node.id || typeof node.x !== "number" || typeof node.y !== "number") {
        continue;
      }

      positionById[node.id] = {
        x: Math.round(node.x + offsetX),
        y: Math.round(node.y + offsetY)
      };
    }

    if (Object.keys(positionById).length === 0) {
      return fallbackPositions;
    }

    const stepIds = steps.map((step) => step.id);
    if (shouldPreferCompactFallback(positionById, fallbackPositions, stepIds, visualHeightByStepId)) {
      return fallbackPositions;
    }

    return positionById;
  } catch {
    return fallbackPositions;
  }
}
