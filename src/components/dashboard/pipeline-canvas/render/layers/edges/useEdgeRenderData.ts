import type { ConnectingState, FlowLink, FlowNode, RenderedLink } from "../../../types";
import type { ConnectingPreviewData } from "./edgeLayerSelectors";
import { buildConnectingPreviewData, selectEdgePathStyle } from "./edgeLayerSelectors";

export interface EdgeRenderData {
  link: RenderedLink;
  isSelected: boolean;
  isPrimarySelected: boolean;
  isAnimated: boolean;
  baseStrokeWidth: number;
  selectedStrokeWidth: number;
  edgeOpacity: number;
  selectedHaloOpacity: number;
}

export interface UseEdgeRenderDataParams {
  renderedLinks: RenderedLink[];
  links: FlowLink[];
  selectedNodeIds: string[];
  selectedLinkId: string | null;
  animatedLinkSet: Set<string>;
}

export interface UseConnectingPreviewParams {
  connectingState: ConnectingState | null;
  nodes: FlowNode[];
  links: FlowLink[];
  nodeById: Map<string, FlowNode>;
}

export function useEdgeRenderData({
  renderedLinks,
  links,
  selectedNodeIds,
  selectedLinkId,
  animatedLinkSet
}: UseEdgeRenderDataParams): EdgeRenderData[] {
  const selectedLinkIds = new Set<string>();
  if (selectedLinkId) {
    selectedLinkIds.add(selectedLinkId);
  }
  if (selectedNodeIds.length > 1) {
    const selectedNodeSet = new Set(selectedNodeIds);
    for (const link of links) {
      if (selectedNodeSet.has(link.sourceStepId) && selectedNodeSet.has(link.targetStepId)) {
        selectedLinkIds.add(link.id);
      }
    }
  }

  return renderedLinks.map((link) => {
    const isSelected = selectedLinkIds.has(link.id);
    const isPrimarySelected = selectedLinkId === link.id;
    const style = selectEdgePathStyle(link, isSelected);

    return {
      link,
      isSelected,
      isPrimarySelected,
      isAnimated: animatedLinkSet.has(link.id),
      baseStrokeWidth: style.baseStrokeWidth,
      selectedStrokeWidth: style.selectedStrokeWidth,
      edgeOpacity: style.edgeOpacity,
      selectedHaloOpacity: style.selectedHaloOpacity
    };
  });
}

export function useConnectingPreviewData({
  connectingState,
  nodes,
  links,
  nodeById
}: UseConnectingPreviewParams): ConnectingPreviewData | null {
  return buildConnectingPreviewData(connectingState, nodes, links, nodeById);
}
