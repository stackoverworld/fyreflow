import type { ELK, ElkExtendedEdge, ElkNode } from "elkjs";

import {
  DEFAULT_NODE_HEIGHT,
  DEFAULT_NODE_WIDTH,
  ELK_BASE_LAYOUT_OPTIONS
} from "./constants";
import { layoutNodeVisualHeight } from "./nodeDimensions";
import { stableUniqueLinks } from "./layout";
import { FlowLayoutOptions, LayoutLink, LayoutStep, RouteLinkInput, RouteNodeInput } from "./normalize";
import { orderedStepsForElk } from "./graphTraversal";

let elkInstancePromise: Promise<ELK> | null = null;

const DENSE_GRAPH_BASE_DEGREE = 3;
const DENSE_GRAPH_ROW_GAP_STEP = 12;

export async function getElkInstance(): Promise<ELK> {
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

function maxIncidentDegree(
  nodeIds: ReadonlySet<string>,
  links: ReadonlyArray<{ source: string; target: string }>
): number {
  const degreeById = new Map<string, number>();
  for (const nodeId of nodeIds) {
    degreeById.set(nodeId, 0);
  }

  for (const link of links) {
    if (nodeIds.has(link.source)) {
      degreeById.set(link.source, (degreeById.get(link.source) ?? 0) + 1);
    }
    if (nodeIds.has(link.target)) {
      degreeById.set(link.target, (degreeById.get(link.target) ?? 0) + 1);
    }
  }

  return Math.max(0, ...degreeById.values());
}

function elkLayoutOptions(
  options: FlowLayoutOptions,
  maxNodeHeight: number = DEFAULT_NODE_HEIGHT,
  incidentDegree: number = 0
): Record<string, string> {
  const layerGap = Math.max(DEFAULT_NODE_WIDTH + 64, Math.round((options.layerGap ?? 360) * 0.85));
  const denseGraphRowBoost = Math.max(0, incidentDegree - DENSE_GRAPH_BASE_DEGREE) * DENSE_GRAPH_ROW_GAP_STEP;
  const rowGap = Math.max(maxNodeHeight + 52, Math.round((options.rowGap ?? 196) * 0.85) + denseGraphRowBoost);

  return {
    ...ELK_BASE_LAYOUT_OPTIONS,
    "elk.layered.spacing.nodeNodeBetweenLayers": String(layerGap),
    "elk.spacing.nodeNode": String(rowGap)
  };
}

export function buildElkGraph(steps: LayoutStep[], links: LayoutLink[], options: FlowLayoutOptions): ElkNode {
  const sortedSteps = orderedStepsForElk(steps);
  const maxNodeHeight = sortedSteps.reduce(
    (currentMax, step) => Math.max(currentMax, layoutNodeVisualHeight(step)),
    DEFAULT_NODE_HEIGHT
  );
  const uniqueLinks = stableUniqueLinks(steps, links);
  const incidentDegree = maxIncidentDegree(new Set(sortedSteps.map((step) => step.id)), uniqueLinks);
  const edges: ElkExtendedEdge[] = uniqueLinks.map((link, index) => ({
    id: `elk-edge-${index}-${link.source}-${link.target}`,
    sources: [link.source],
    targets: [link.target]
  }));

  return {
    id: "flow-root",
    layoutOptions: elkLayoutOptions(options, maxNodeHeight, incidentDegree),
    children: sortedSteps.map((step) => ({
      id: step.id,
      width: DEFAULT_NODE_WIDTH,
      height: layoutNodeVisualHeight(step)
    })),
    edges
  };
}

export function buildElkRouteGraph(
  nodes: RouteNodeInput[],
  links: RouteLinkInput[],
  options: FlowLayoutOptions
): { graph: ElkNode; routeLinks: RouteLinkInput[] } {
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const routeLinks = links.filter((link) => {
    if (link.sourceStepId === link.targetStepId) {
      return false;
    }

    return nodeById.has(link.sourceStepId) && nodeById.has(link.targetStepId);
  });
  const routeEdgePairs = routeLinks.map((link) => ({
    source: link.sourceStepId,
    target: link.targetStepId
  }));
  const incidentDegree = maxIncidentDegree(new Set(nodes.map((node) => node.id)), routeEdgePairs);

  return {
    graph: {
      id: "flow-routes-root",
      layoutOptions: {
        // Keep route graph based on main-card height so endpoint anchors stay stable.
        ...elkLayoutOptions(options, DEFAULT_NODE_HEIGHT, incidentDegree),
        "elk.interactive": "true",
        "elk.layered.cycleBreaking.strategy": "INTERACTIVE",
        "elk.layered.layering.strategy": "INTERACTIVE",
        "elk.layered.crossingMinimization.semiInteractive": "true",
        "elk.layered.nodePlacement.strategy": "INTERACTIVE",
        "elk.separateConnectedComponents": "false"
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
    },
    routeLinks
  };
}
