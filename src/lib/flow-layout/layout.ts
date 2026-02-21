import { average, type FlowLayoutOptions, type LayoutLink, type LayoutStep } from "./normalize";
import { DEFAULT_CENTER_Y, DEFAULT_LAYER_GAP, DEFAULT_ROW_GAP, DEFAULT_START_X, rolePriority } from "./constants";

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

  const positions: Record<string, { x: number; y: number }> = {};

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
