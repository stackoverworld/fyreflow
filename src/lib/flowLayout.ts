import type { ELK, ElkExtendedEdge, ElkNode } from "elkjs";
import type { AgentRole, PipelinePayload } from "@/lib/types";

const DEFAULT_START_X = 120;
const DEFAULT_CENTER_Y = 300;
const DEFAULT_LAYER_GAP = 360;
const DEFAULT_ROW_GAP = 196;
const DEFAULT_NODE_WIDTH = 240;
const DEFAULT_NODE_HEIGHT = 116;

type LayoutStep = PipelinePayload["steps"][number];
type LayoutLink = PipelinePayload["links"][number];

interface Position {
  x: number;
  y: number;
}

export interface RouteNodeInput {
  id: string;
  position: Position;
  role?: AgentRole;
}

export interface RouteLinkInput {
  id: string;
  sourceStepId: string;
  targetStepId: string;
  condition?: string;
}

export interface FlowLayoutOptions {
  startX?: number;
  centerY?: number;
  layerGap?: number;
  rowGap?: number;
}

const rolePriority: Record<AgentRole, number> = {
  orchestrator: 0,
  analysis: 1,
  planner: 2,
  executor: 3,
  tester: 4,
  review: 5
};

const ELK_BASE_LAYOUT_OPTIONS: Record<string, string> = {
  "elk.algorithm": "layered",
  "elk.direction": "RIGHT",
  "elk.edgeRouting": "ORTHOGONAL",
  "elk.layered.nodePlacement.strategy": "BRANDES_KOEPF",
  "elk.layered.crossingMinimization.strategy": "LAYER_SWEEP",
  "elk.layered.considerModelOrder.strategy": "NODES_AND_EDGES",
  "elk.layered.feedbackEdges": "true",
  "elk.spacing.edgeEdge": "26",
  "elk.spacing.edgeNode": "80"
};

const ROUTE_ENDPOINT_MAX_DISTANCE = 110;
const ROUTE_PATH_STRETCH_LIMIT = 3.7;
const ROUTE_PATH_EXTRA_LIMIT = 820;
const ROUTE_MAX_POINTS = 36;

interface RouteRect {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

interface ElkPointLike {
  x?: number;
  y?: number;
}

interface ElkEdgeSectionLike {
  id?: string;
  startPoint?: ElkPointLike;
  endPoint?: ElkPointLike;
  bendPoints?: ElkPointLike[];
  incomingSections?: string[];
  outgoingSections?: string[];
}

let elkInstancePromise: Promise<ELK> | null = null;

async function getElkInstance(): Promise<ELK> {
  if (!elkInstancePromise) {
    elkInstancePromise = import("elkjs/lib/elk.bundled.js").then((module) => {
      const ElkConstructor = (
        module as unknown as {
          default: new () => ELK;
        }
      ).default;
      return new ElkConstructor();
    });
  }

  return elkInstancePromise;
}

function average(values: number[]): number {
  if (values.length === 0) {
    return 0;
  }

  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function stableUniqueLinks(steps: LayoutStep[], links: LayoutLink[]): Array<{ source: string; target: string }> {
  const stepIds = new Set(steps.map((step) => step.id));
  const seen = new Set<string>();
  const result: Array<{ source: string; target: string }> = [];

  for (const link of links) {
    const source = link.sourceStepId;
    const target = link.targetStepId;
    if (!stepIds.has(source) || !stepIds.has(target) || source === target) {
      continue;
    }

    const key = `${source}->${target}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    result.push({ source, target });
  }

  return result;
}

function orderedStepsForElk(steps: LayoutStep[]): LayoutStep[] {
  return [...steps].sort((left, right) => {
    const leftPriority = rolePriority[left.role] ?? 99;
    const rightPriority = rolePriority[right.role] ?? 99;
    if (leftPriority !== rightPriority) {
      return leftPriority - rightPriority;
    }

    const leftX = left.position?.x ?? 0;
    const rightX = right.position?.x ?? 0;
    if (leftX !== rightX) {
      return leftX - rightX;
    }

    const leftY = left.position?.y ?? 0;
    const rightY = right.position?.y ?? 0;
    if (leftY !== rightY) {
      return leftY - rightY;
    }

    return left.id.localeCompare(right.id);
  });
}

function elkLayoutOptions(options: FlowLayoutOptions): Record<string, string> {
  const layerGap = Math.max(220, Math.round((options.layerGap ?? DEFAULT_LAYER_GAP) * 0.7));
  const rowGap = Math.max(120, Math.round((options.rowGap ?? DEFAULT_ROW_GAP) * 0.75));

  return {
    ...ELK_BASE_LAYOUT_OPTIONS,
    "elk.layered.spacing.nodeNodeBetweenLayers": String(layerGap),
    "elk.spacing.nodeNode": String(rowGap)
  };
}

function buildElkGraph(steps: LayoutStep[], links: LayoutLink[], options: FlowLayoutOptions): ElkNode {
  const sortedSteps = orderedStepsForElk(steps);
  const uniqueLinks = stableUniqueLinks(steps, links);
  const edges: ElkExtendedEdge[] = uniqueLinks.map((link, index) => ({
    id: `elk-edge-${index}-${link.source}-${link.target}`,
    sources: [link.source],
    targets: [link.target]
  }));

  return {
    id: "flow-root",
    layoutOptions: elkLayoutOptions(options),
    children: sortedSteps.map((step) => ({
      id: step.id,
      width: DEFAULT_NODE_WIDTH,
      height: DEFAULT_NODE_HEIGHT
    })),
    edges
  };
}

function toRoundedPoint(point: Position): Position {
  return {
    x: Math.round(point.x),
    y: Math.round(point.y)
  };
}

function normalizeElkRoute(points: Position[]): Position[] {
  if (points.length <= 2) {
    return points.map(toRoundedPoint);
  }

  const compact: Position[] = [];

  for (const point of points.map(toRoundedPoint)) {
    const last = compact[compact.length - 1];
    if (last && last.x === point.x && last.y === point.y) {
      continue;
    }

    compact.push(point);
    if (compact.length < 3) {
      continue;
    }

    const a = compact[compact.length - 3];
    const b = compact[compact.length - 2];
    const c = compact[compact.length - 1];
    const collinear = (a.x === b.x && b.x === c.x) || (a.y === b.y && b.y === c.y);
    if (collinear) {
      compact.splice(compact.length - 2, 1);
    }
  }

  return compact;
}

function routeNodeRect(node: RouteNodeInput): RouteRect {
  return {
    left: node.position.x,
    right: node.position.x + DEFAULT_NODE_WIDTH,
    top: node.position.y,
    bottom: node.position.y + DEFAULT_NODE_HEIGHT
  };
}

function pointDistanceToRect(point: Position, rect: RouteRect): number {
  const dx = point.x < rect.left ? rect.left - point.x : point.x > rect.right ? point.x - rect.right : 0;
  const dy = point.y < rect.top ? rect.top - point.y : point.y > rect.bottom ? point.y - rect.bottom : 0;
  return Math.hypot(dx, dy);
}

function routeLength(points: Position[]): number {
  let total = 0;
  for (let index = 1; index < points.length; index += 1) {
    total += Math.abs(points[index].x - points[index - 1].x) + Math.abs(points[index].y - points[index - 1].y);
  }
  return total;
}

function routePointFromElk(point: ElkPointLike | undefined): Position | null {
  if (typeof point?.x !== "number" || typeof point?.y !== "number") {
    return null;
  }

  return {
    x: point.x,
    y: point.y
  };
}

function orderElkSections(sections: ElkEdgeSectionLike[]): ElkEdgeSectionLike[] {
  if (sections.length <= 1) {
    return sections;
  }

  const byId = new Map<string, ElkEdgeSectionLike>();
  for (const section of sections) {
    if (!section.id) {
      return sections;
    }
    byId.set(section.id, section);
  }

  if (byId.size !== sections.length) {
    return sections;
  }

  const start =
    sections.find((section) => {
      const incoming = section.incomingSections ?? [];
      return incoming.length === 0;
    }) ?? sections[0];

  const ordered: ElkEdgeSectionLike[] = [];
  const visited = new Set<string>();
  let current: ElkEdgeSectionLike | undefined = start;

  while (current?.id && !visited.has(current.id)) {
    ordered.push(current);
    visited.add(current.id);

    const nextId: string | undefined = (current.outgoingSections ?? []).find(
      (outgoingId: string) => byId.has(outgoingId) && !visited.has(outgoingId)
    );
    current = nextId ? byId.get(nextId) : undefined;
  }

  for (const section of sections) {
    if (!ordered.includes(section)) {
      ordered.push(section);
    }
  }

  return ordered;
}

function routeFromElkSections(sections: ElkEdgeSectionLike[]): Position[] {
  if (sections.length === 0) {
    return [];
  }

  const points: Position[] = [];

  for (const section of orderElkSections(sections)) {
    const start = routePointFromElk(section.startPoint);
    if (start) {
      points.push(start);
    }

    for (const bend of section.bendPoints ?? []) {
      const bendPoint = routePointFromElk(bend);
      if (bendPoint) {
        points.push(bendPoint);
      }
    }

    const end = routePointFromElk(section.endPoint);
    if (end) {
      points.push(end);
    }
  }

  return normalizeElkRoute(points);
}

function routeEndpointsAreValid(route: Position[], sourceNode: RouteNodeInput, targetNode: RouteNodeInput): boolean {
  const start = route[0];
  const end = route[route.length - 1];
  if (!start || !end) {
    return false;
  }

  const sourceDistance = pointDistanceToRect(start, routeNodeRect(sourceNode));
  const targetDistance = pointDistanceToRect(end, routeNodeRect(targetNode));

  return sourceDistance <= ROUTE_ENDPOINT_MAX_DISTANCE && targetDistance <= ROUTE_ENDPOINT_MAX_DISTANCE;
}

function median(values: number[]): number {
  if (values.length === 0) {
    return 0;
  }

  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
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
  const routeLinks = links.filter((link) => {
    if (link.sourceStepId === link.targetStepId) {
      return false;
    }

    return nodeById.has(link.sourceStepId) && nodeById.has(link.targetStepId);
  });

  if (routeLinks.length === 0) {
    return {};
  }

  const graph: ElkNode = {
    id: "flow-routes-root",
    layoutOptions: {
      ...elkLayoutOptions(options),
      "elk.interactive": "true",
      "elk.layered.crossingMinimization.semiInteractive": "true"
    },
    children: nodes.map((node) => ({
      id: node.id,
      width: DEFAULT_NODE_WIDTH,
      height: DEFAULT_NODE_HEIGHT,
      x: node.position.x,
      y: node.position.y
    })),
    edges: routeLinks.map((link) => ({
      id: link.id,
      sources: [link.sourceStepId],
      targets: [link.targetStepId]
    }))
  };

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

function buildAdjacency(
  steps: LayoutStep[],
  links: Array<{ source: string; target: string }>
): {
  outgoing: Map<string, string[]>;
  incoming: Map<string, string[]>;
} {
  const outgoing = new Map<string, string[]>();
  const incoming = new Map<string, string[]>();

  for (const step of steps) {
    outgoing.set(step.id, []);
    incoming.set(step.id, []);
  }

  for (const link of links) {
    outgoing.get(link.source)?.push(link.target);
    incoming.get(link.target)?.push(link.source);
  }

  return { outgoing, incoming };
}

function orderedRootIds(steps: LayoutStep[], incoming: Map<string, string[]>): string[] {
  const stepIndexById = new Map(steps.map((step, index) => [step.id, index]));
  const byVisualOrder = (leftId: string, rightId: string): number => {
    const leftStep = steps[stepIndexById.get(leftId) ?? 0];
    const rightStep = steps[stepIndexById.get(rightId) ?? 0];
    const leftY = leftStep?.position?.y ?? 0;
    const rightY = rightStep?.position?.y ?? 0;
    if (leftY !== rightY) {
      return leftY - rightY;
    }
    return (stepIndexById.get(leftId) ?? 0) - (stepIndexById.get(rightId) ?? 0);
  };

  const orchestrators = steps.filter((step) => step.role === "orchestrator").map((step) => step.id).sort(byVisualOrder);
  if (orchestrators.length > 0) {
    return orchestrators;
  }

  const roots = steps
    .filter((step) => (incoming.get(step.id)?.length ?? 0) === 0)
    .map((step) => step.id)
    .sort(byVisualOrder);
  if (roots.length > 0) {
    return roots;
  }

  return steps.length > 0 ? [steps[0].id] : [];
}

function assignLayers(
  steps: LayoutStep[],
  outgoing: Map<string, string[]>,
  incoming: Map<string, string[]>
): Map<string, number> {
  const layers = new Map<string, number>();
  const rootIds = orderedRootIds(steps, incoming);
  const rootSet = new Set(rootIds);
  const queue = [...rootIds];

  for (const rootId of rootIds) {
    layers.set(rootId, 0);
  }

  while (queue.length > 0) {
    const current = queue.shift();
    if (!current) {
      continue;
    }

    const currentLayer = layers.get(current) ?? 0;
    const nextNodes = outgoing.get(current) ?? [];
    for (const next of nextNodes) {
      const proposed = currentLayer + 1;
      const existing = layers.get(next);
      if (existing === undefined || proposed < existing) {
        layers.set(next, proposed);
        queue.push(next);
      }
    }
  }

  for (let pass = 0; pass < steps.length; pass += 1) {
    let changed = false;
    for (const step of steps) {
      if (layers.has(step.id)) {
        continue;
      }

      const predecessorLayers = (incoming.get(step.id) ?? [])
        .map((id) => layers.get(id))
        .filter((value): value is number => value !== undefined);
      if (predecessorLayers.length === 0) {
        continue;
      }

      layers.set(step.id, Math.max(...predecessorLayers) + 1);
      changed = true;
    }

    if (!changed) {
      break;
    }
  }

  let nextLayer = Math.max(0, ...layers.values()) + 1;
  for (const step of steps) {
    if (layers.has(step.id)) {
      continue;
    }
    layers.set(step.id, nextLayer);
    nextLayer += 1;
  }

  if (rootIds.length > 0) {
    for (const step of steps) {
      if (rootSet.has(step.id)) {
        layers.set(step.id, 0);
      } else if ((layers.get(step.id) ?? 0) === 0) {
        layers.set(step.id, 1);
      }
    }
  }

  return layers;
}

function sortWithinLayers(
  steps: LayoutStep[],
  layerById: Map<string, number>,
  outgoing: Map<string, string[]>,
  incoming: Map<string, string[]>
): Map<number, string[]> {
  const stepById = new Map(steps.map((step) => [step.id, step]));
  const grouped = new Map<number, string[]>();

  for (const step of steps) {
    const layer = layerById.get(step.id) ?? 0;
    const bucket = grouped.get(layer) ?? [];
    bucket.push(step.id);
    grouped.set(layer, bucket);
  }

  for (const [layer, ids] of grouped) {
    ids.sort((left, right) => {
      const leftStep = stepById.get(left);
      const rightStep = stepById.get(right);
      const leftPriority = leftStep ? rolePriority[leftStep.role] : 99;
      const rightPriority = rightStep ? rolePriority[rightStep.role] : 99;
      if (leftPriority !== rightPriority) {
        return leftPriority - rightPriority;
      }
      const leftY = leftStep?.position?.y ?? 0;
      const rightY = rightStep?.position?.y ?? 0;
      if (leftY !== rightY) {
        return leftY - rightY;
      }
      return left.localeCompare(right);
    });
    grouped.set(layer, ids);
  }

  const layerOrder = [...grouped.keys()].sort((a, b) => a - b);

  const buildOrderById = (): Map<string, number> => {
    const order = new Map<string, number>();
    for (const layer of layerOrder) {
      for (const [index, id] of (grouped.get(layer) ?? []).entries()) {
        order.set(id, index);
      }
    }
    return order;
  };

  for (let pass = 0; pass < 4; pass += 1) {
    let orderById = buildOrderById();

    for (let index = 1; index < layerOrder.length; index += 1) {
      const layer = layerOrder[index];
      const ids = grouped.get(layer);
      if (!ids) {
        continue;
      }

      ids.sort((left, right) => {
        const leftNeighbors = (incoming.get(left) ?? []).filter((id) => (layerById.get(id) ?? 0) < layer);
        const rightNeighbors = (incoming.get(right) ?? []).filter((id) => (layerById.get(id) ?? 0) < layer);
        const leftScore =
          leftNeighbors.length > 0
            ? average(leftNeighbors.map((id) => orderById.get(id) ?? 0))
            : orderById.get(left) ?? 0;
        const rightScore =
          rightNeighbors.length > 0
            ? average(rightNeighbors.map((id) => orderById.get(id) ?? 0))
            : orderById.get(right) ?? 0;
        if (leftScore !== rightScore) {
          return leftScore - rightScore;
        }
        return (orderById.get(left) ?? 0) - (orderById.get(right) ?? 0);
      });
      grouped.set(layer, ids);
    }

    orderById = buildOrderById();

    for (let index = layerOrder.length - 2; index >= 0; index -= 1) {
      const layer = layerOrder[index];
      const ids = grouped.get(layer);
      if (!ids) {
        continue;
      }

      ids.sort((left, right) => {
        const leftNeighbors = (outgoing.get(left) ?? []).filter((id) => (layerById.get(id) ?? 0) > layer);
        const rightNeighbors = (outgoing.get(right) ?? []).filter((id) => (layerById.get(id) ?? 0) > layer);
        const leftScore =
          leftNeighbors.length > 0
            ? average(leftNeighbors.map((id) => orderById.get(id) ?? 0))
            : orderById.get(left) ?? 0;
        const rightScore =
          rightNeighbors.length > 0
            ? average(rightNeighbors.map((id) => orderById.get(id) ?? 0))
            : orderById.get(right) ?? 0;
        if (leftScore !== rightScore) {
          return leftScore - rightScore;
        }
        return (orderById.get(left) ?? 0) - (orderById.get(right) ?? 0);
      });
      grouped.set(layer, ids);
    }
  }

  return grouped;
}

export function computeAutoLayoutPositions(
  steps: LayoutStep[],
  links: LayoutLink[],
  options: FlowLayoutOptions = {}
): Record<string, Position> {
  if (steps.length === 0) {
    return {};
  }

  const layerGap = Math.max(300, options.layerGap ?? DEFAULT_LAYER_GAP);
  const rowGap = Math.max(170, options.rowGap ?? DEFAULT_ROW_GAP);
  const startX = Math.round(options.startX ?? DEFAULT_START_X);
  const existingCenterY = Math.round(average(steps.map((step) => step.position?.y ?? DEFAULT_CENTER_Y)));
  const centerY = Math.round(options.centerY ?? existingCenterY);

  const linksForLayout = stableUniqueLinks(steps, links);
  const { outgoing, incoming } = buildAdjacency(steps, linksForLayout);
  const layerById = assignLayers(steps, outgoing, incoming);
  const grouped = sortWithinLayers(steps, layerById, outgoing, incoming);
  const orderedLayers = [...grouped.keys()].sort((a, b) => a - b);

  const positions: Record<string, Position> = {};

  for (const layer of orderedLayers) {
    const ids = grouped.get(layer) ?? [];
    const totalHeight = Math.max(0, (ids.length - 1) * rowGap);
    const startY = centerY - totalHeight / 2;

    ids.forEach((id, index) => {
      positions[id] = {
        x: Math.round(startX + layer * layerGap),
        y: Math.round(startY + index * rowGap)
      };
    });
  }

  return positions;
}

export async function computeAutoLayoutPositionsSmart(
  steps: LayoutStep[],
  links: LayoutLink[],
  options: FlowLayoutOptions = {}
): Promise<Record<string, Position>> {
  if (steps.length === 0) {
    return {};
  }

  try {
    const graph = buildElkGraph(steps, links, options);
    const elk = await getElkInstance();
    const layout = await elk.layout(graph);
    const laidOutNodes = layout.children ?? [];
    if (laidOutNodes.length === 0) {
      return computeAutoLayoutPositions(steps, links, options);
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
      return computeAutoLayoutPositions(steps, links, options);
    }

    const minX = Math.min(...xValues);
    const minY = Math.min(...yTopValues);
    const maxY = Math.max(...yBottomValues);
    const startX = Math.round(options.startX ?? DEFAULT_START_X);
    const existingCenterY = Math.round(average(steps.map((step) => step.position?.y ?? DEFAULT_CENTER_Y)));
    const centerY = Math.round(options.centerY ?? existingCenterY);
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
      return computeAutoLayoutPositions(steps, links, options);
    }

    return positionById;
  } catch {
    return computeAutoLayoutPositions(steps, links, options);
  }
}

export async function autoLayoutPipelineDraftSmart(
  draft: PipelinePayload,
  options: FlowLayoutOptions = {}
): Promise<PipelinePayload> {
  const positions = await computeAutoLayoutPositionsSmart(draft.steps, draft.links, options);

  return {
    ...draft,
    steps: draft.steps.map((step) => ({
      ...step,
      position: positions[step.id] ?? step.position
    }))
  };
}

export function autoLayoutPipelineDraft(
  draft: PipelinePayload,
  options: FlowLayoutOptions = {}
): PipelinePayload {
  const positions = computeAutoLayoutPositions(draft.steps, draft.links, options);

  return {
    ...draft,
    steps: draft.steps.map((step) => ({
      ...step,
      position: positions[step.id] ?? step.position
    }))
  };
}
