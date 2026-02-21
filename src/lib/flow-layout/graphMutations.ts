import type { ELK, ElkExtendedEdge, ElkNode } from "elkjs";

import {
  DEFAULT_NODE_HEIGHT,
  DEFAULT_NODE_WIDTH,
  ELK_BASE_LAYOUT_OPTIONS
} from "./constants";
import { stableUniqueLinks } from "./layout";
import { FlowLayoutOptions, LayoutLink, LayoutStep, RouteLinkInput, RouteNodeInput } from "./normalize";
import { orderedStepsForElk } from "./graphTraversal";

let elkInstancePromise: Promise<ELK> | null = null;

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

function elkLayoutOptions(options: FlowLayoutOptions): Record<string, string> {
  const layerGap = Math.max(220, Math.round((options.layerGap ?? 360) * 0.7));
  const rowGap = Math.max(120, Math.round((options.rowGap ?? 196) * 0.75));

  return {
    ...ELK_BASE_LAYOUT_OPTIONS,
    "elk.layered.spacing.nodeNodeBetweenLayers": String(layerGap),
    "elk.spacing.nodeNode": String(rowGap)
  };
}

export function buildElkGraph(steps: LayoutStep[], links: LayoutLink[], options: FlowLayoutOptions): ElkNode {
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

  return {
    graph: {
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
    },
    routeLinks
  };
}
