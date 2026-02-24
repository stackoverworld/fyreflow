import { average, type FlowLayoutOptions, type LayoutLink, type LayoutStep } from "./normalize";
import {
  DEFAULT_CENTER_Y,
  DEFAULT_LAYER_GAP,
  DEFAULT_NODE_HEIGHT,
  DEFAULT_NODE_WIDTH,
  DEFAULT_ROW_GAP,
  DEFAULT_START_X,
  rolePriority
} from "./constants";
import { layoutNodeVisualHeight } from "./nodeDimensions";

const DENSE_GRAPH_BASE_DEGREE = 3;
const DENSE_GRAPH_ROW_GAP_STEP = 12;

export function stableUniqueLinks(steps: LayoutStep[], links: LayoutLink[]): Array<{ source: string; target: string }> {
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

function compactLinearLayers(
  steps: LayoutStep[],
  layerById: Map<string, number>,
  outgoing: Map<string, string[]>,
  incoming: Map<string, string[]>
): Map<string, number> {
  const compacted = new Map(layerById);
  if (steps.length < 3) {
    return compacted;
  }

  const stepById = new Map(steps.map((step) => [step.id, step]));
  const rootIds = new Set(orderedRootIds(steps, incoming));
  const orderedStepIds = [...steps]
    .sort((left, right) => {
      const leftLayer = compacted.get(left.id) ?? 0;
      const rightLayer = compacted.get(right.id) ?? 0;
      if (leftLayer !== rightLayer) {
        return leftLayer - rightLayer;
      }

      const leftY = left.position?.y ?? 0;
      const rightY = right.position?.y ?? 0;
      if (leftY !== rightY) {
        return leftY - rightY;
      }

      return left.id.localeCompare(right.id);
    })
    .map((step) => step.id);

  for (const stepId of orderedStepIds) {
    const predecessors = incoming.get(stepId) ?? [];
    if (predecessors.length !== 1) {
      continue;
    }

    const predecessorId = predecessors[0];
    const stepLayer = compacted.get(stepId) ?? 0;
    const predecessorLayer = compacted.get(predecessorId);
    if (predecessorLayer === undefined || predecessorLayer >= stepLayer) {
      continue;
    }

    if (rootIds.has(stepId) || rootIds.has(predecessorId)) {
      continue;
    }

    const predecessorIncomingCount = incoming.get(predecessorId)?.length ?? 0;
    const predecessorOutgoingCount = outgoing.get(predecessorId)?.length ?? 0;
    const stepIncomingCount = incoming.get(stepId)?.length ?? 0;
    const stepOutgoingCount = outgoing.get(stepId)?.length ?? 0;
    const predecessorRolePriority = rolePriority[stepById.get(predecessorId)?.role ?? "executor"] ?? 99;
    const stepRolePriority = rolePriority[stepById.get(stepId)?.role ?? "executor"] ?? 99;

    const hasLinearShape =
      predecessorIncomingCount > 0 &&
      predecessorOutgoingCount <= 1 &&
      stepIncomingCount <= 1 &&
      stepOutgoingCount <= 1 &&
      stepRolePriority >= predecessorRolePriority;
    if (!hasLinearShape) {
      continue;
    }

    compacted.set(stepId, predecessorLayer);
  }

  const orderedLayerValues = [...new Set(compacted.values())].sort((a, b) => a - b);
  const normalizedLayerByValue = new Map(orderedLayerValues.map((layer, index) => [layer, index]));
  const normalized = new Map<string, number>();

  for (const [stepId, layer] of compacted) {
    normalized.set(stepId, normalizedLayerByValue.get(layer) ?? 0);
  }

  return normalized;
}

function resolveLayerGap(baseLayerGap: number, layerCount: number, stepCount: number): number {
  const minLayerGap = DEFAULT_NODE_WIDTH + 64;
  if (layerCount <= 1) {
    return Math.max(minLayerGap, baseLayerGap);
  }

  const maxCanvasSpan = Math.max(1200, Math.min(2100, stepCount * 270));
  const adaptiveGap = Math.round(maxCanvasSpan / (layerCount - 1));
  return Math.max(minLayerGap, Math.min(baseLayerGap, adaptiveGap));
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
): Record<string, { x: number; y: number }> {
  if (steps.length === 0) {
    return {};
  }

  const baseLayerGap = Math.max(300, options.layerGap ?? DEFAULT_LAYER_GAP);
  const startX = Math.round(options.startX ?? DEFAULT_START_X);
  const existingCenterY = Math.round(
    average(steps.map((step) => (step.position?.y ?? DEFAULT_CENTER_Y) + layoutNodeVisualHeight(step) / 2))
  );
  const centerY = Math.round(options.centerY ?? existingCenterY);

  const linksForLayout = stableUniqueLinks(steps, links);
  const { outgoing, incoming } = buildAdjacency(steps, linksForLayout);
  const maxIncidentDegree = steps.reduce((maxDegree, step) => {
    const out = outgoing.get(step.id)?.length ?? 0;
    const incomingCount = incoming.get(step.id)?.length ?? 0;
    return Math.max(maxDegree, out + incomingCount);
  }, 0);
  const denseGraphRowBoost = Math.max(0, maxIncidentDegree - DENSE_GRAPH_BASE_DEGREE) * DENSE_GRAPH_ROW_GAP_STEP;
  const rowGap = Math.max(170, (options.rowGap ?? DEFAULT_ROW_GAP) + denseGraphRowBoost);
  const interNodeGap = Math.max(24, rowGap - DEFAULT_NODE_HEIGHT);
  const layered = assignLayers(steps, outgoing, incoming);
  const layerById = compactLinearLayers(steps, layered, outgoing, incoming);
  const grouped = sortWithinLayers(steps, layerById, outgoing, incoming);
  const orderedLayers = [...grouped.keys()].sort((a, b) => a - b);
  const layerGap = resolveLayerGap(baseLayerGap, orderedLayers.length, steps.length);
  const stepById = new Map(steps.map((step) => [step.id, step]));

  const positions: Record<string, { x: number; y: number }> = {};

  for (const layer of orderedLayers) {
    const ids = grouped.get(layer) ?? [];
    const heights = ids.map((id) => layoutNodeVisualHeight(stepById.get(id) ?? {}));
    const columnHeight =
      heights.reduce((sum, height) => sum + height, 0) + Math.max(0, ids.length - 1) * interNodeGap;
    let nextY = centerY - columnHeight / 2;

    ids.forEach((id, index) => {
      positions[id] = {
        x: Math.round(startX + layer * layerGap),
        y: Math.round(nextY)
      };
      nextY += heights[index] + interNodeGap;
    });
  }

  return positions;
}
