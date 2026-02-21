import {
  CORNER_RADIUS,
  EDGE_PREVIEW_COLOR,
  buildEdgeRoute,
  edgeInvolvesOrchestrator,
  edgePath,
  edgeStrokeDasharray,
  routePath,
  simpleOrchestratorLaneMeta
} from "../../../edgeRendering";
import { NODE_HEIGHT, NODE_WIDTH } from "../../../useNodeLayout";
import type { ConnectingState, FlowLink, FlowNode, RenderedLink } from "../../../types";

export interface EdgeVisualStyle {
  baseStrokeWidth: number;
  selectedStrokeWidth: number;
  edgeOpacity: number;
  selectedHaloOpacity: number;
  currentStrokeWidth: number;
}

export interface EdgeShimmerLayer {
  widthOffset: number;
  dasharray: string;
  dataDashLen: string;
  filter?: string;
  opacity: number;
}

export interface ConnectingPreviewData {
  d: string;
  stroke: string;
  strokeWidth: number;
  strokeDasharray?: string;
  opacity?: number;
  markerEnd?: string;
}

export const HIGHLIGHT_HALO_STROKE_WIDTH = 8;
export const EDGE_SHIMMER_LAYERS: readonly EdgeShimmerLayer[] = [
  { widthOffset: 8, dasharray: "0.45 1.5", dataDashLen: "0.45", filter: "url(#link-shimmer-soft)", opacity: 0.1 },
  { widthOffset: 4, dasharray: "0.26 1.5", dataDashLen: "0.26", filter: "url(#link-shimmer-mid)", opacity: 0.2 },
  { widthOffset: 1, dasharray: "0.1 1.5", dataDashLen: "0.1", opacity: 0.4 }
];

export function selectEdgePathStyle(link: RenderedLink, isSelected: boolean): EdgeVisualStyle {
  const baseStrokeWidth = link.hasOrchestrator ? 2.35 : 1.95;
  const selectedStrokeWidth = link.hasOrchestrator ? 3.35 : 2.85;
  const edgeOpacity = link.hasOrchestrator ? 0.98 : 0.88;
  const selectedHaloOpacity = link.hasOrchestrator ? 0.24 : 0.18;

  return {
    baseStrokeWidth,
    selectedStrokeWidth,
    edgeOpacity,
    selectedHaloOpacity,
    currentStrokeWidth: isSelected ? selectedStrokeWidth : baseStrokeWidth
  };
}

export function buildConnectingPreviewData(
  connectingState: ConnectingState | null,
  nodes: FlowNode[],
  links: FlowLink[],
  nodeById: Map<string, FlowNode>
): ConnectingPreviewData | null {
  if (!connectingState) {
    return null;
  }

  const sourceNode = nodeById.get(connectingState.sourceNodeId);
  if (!sourceNode) {
    return null;
  }

  if (connectingState.targetNodeId) {
    const targetNode = nodeById.get(connectingState.targetNodeId);
    if (targetNode && targetNode.id !== sourceNode.id) {
      const previewLane = simpleOrchestratorLaneMeta(sourceNode, targetNode);
      const previewRoute = buildEdgeRoute(
        sourceNode,
        targetNode,
        nodes,
        links.length,
        null,
        previewLane,
        null,
        null
      );
      const dasharray = edgeStrokeDasharray(sourceNode.role, targetNode.role);
      const previewHasOrchestrator = edgeInvolvesOrchestrator(sourceNode.role, targetNode.role);

      return {
        d: routePath(previewRoute.route, CORNER_RADIUS),
        stroke: EDGE_PREVIEW_COLOR,
        strokeWidth: previewHasOrchestrator ? 2.25 : 1.95,
        strokeDasharray: dasharray ?? undefined,
        opacity: previewHasOrchestrator ? 0.98 : 0.86,
        markerEnd: "url(#flow-arrow)"
      };
    }
  }

  const sourceAnchor = {
    x: sourceNode.position.x + NODE_WIDTH,
    y: sourceNode.position.y + NODE_HEIGHT / 2
  };

  return {
    d: edgePath(sourceAnchor, connectingState.pointer),
    stroke: EDGE_PREVIEW_COLOR,
    strokeWidth: 2,
    strokeDasharray: sourceNode.role === "orchestrator" ? undefined : "8 7"
  };
}
