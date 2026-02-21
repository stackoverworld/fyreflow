import type { Dispatch, MutableRefObject, ReactNode, RefObject, SetStateAction } from "react";
import type {
  DragState,
  FlowLink,
  FlowNode,
  PipelineCanvasSelection,
  RenderedLink,
  ConnectingState,
  RouteAdjustState
} from "../../types";
import type { UseCanvasSelectionResult } from "../../hooks/useCanvasSelection";
import type { UseCanvasViewportResult } from "../../hooks/useCanvasViewport";
import type { Point, ViewportState } from "../../types";

export interface CanvasLayersProps {
  canvasRef: RefObject<HTMLDivElement | null>;
  canvasHeight: number | string;
  viewportState: UseCanvasViewportResult;
  selectionState: UseCanvasSelectionResult;
  nodes: FlowNode[];
  links: FlowLink[];
  nodeById: Map<string, FlowNode>;
  renderedLinks: RenderedLink[];
  selectedNodeId: string | null;
  selectedNodeIds: string[];
  selectedLinkId: string | null;
  readOnly: boolean;
  onSelectionChange: (selection: PipelineCanvasSelection) => void;
  onConnectNodes: (sourceNodeId: string, targetNodeId: string) => void;
  onDeleteNodes?: (nodeIds: string[]) => void;
  animatedNodeSet: Set<string>;
  animatedLinkSet: Set<string>;
  glowReadySet: Set<string>;
  toolMode: "select" | "pan";
  marqueeFrame: {
    left: number;
    right: number;
    top: number;
    bottom: number;
  } | null;
  children?: ReactNode;
}

export interface OverlayLayerProps {
  toolMode: "select" | "pan";
  onToolModeChange: (toolMode: "select" | "pan") => void;
  onAutoLayout?: () => void;
  viewportScale: number;
  selectedNodeIds: string[];
  selectedLinkId: string | null;
  canDeleteSelection: boolean;
  hasDeleteAction: boolean;
  onDeleteSelection: () => void;
  onClearSelection: () => void;
}

export interface EdgesLayerProps {
  renderedLinks: RenderedLink[];
  selectedLinkId: string | null;
  selectedNodeIds: string[];
  animatedLinkSet: Set<string>;
  viewport: ViewportState;
  readOnly: boolean;
  onSelectionChange: (selection: PipelineCanvasSelection) => void;
  connectingState: ConnectingState | null;
  nodes: FlowNode[];
  links: FlowLink[];
  nodeById: Map<string, FlowNode>;
  manualRoutePointsRef: MutableRefObject<Record<string, Point>>;
  routeUndoStackRef: MutableRefObject<Record<string, Point>[]>;
  routeRedoStackRef: MutableRefObject<Record<string, Point>[]>;
  routeAdjustStartSnapshotRef: MutableRefObject<Record<string, Point> | null>;
  setManualRoutePoints: Dispatch<SetStateAction<Record<string, Point>>>;
  setRouteAdjustState: Dispatch<SetStateAction<RouteAdjustState | null>>;
  toWorldPoint: (event: { clientX: number; clientY: number }) => Point | null;
}

export interface NodesLayerProps {
  nodes: FlowNode[];
  nodeById: Map<string, FlowNode>;
  selectedNodeId: string | null;
  selectedNodeIds: string[];
  viewport: ViewportState;
  readOnly: boolean;
  onSelectionChange: (selection: PipelineCanvasSelection) => void;
  onConnectNodes: (sourceNodeId: string, targetNodeId: string) => void;
  onDeleteNodes?: (nodeIds: string[]) => void;
  connectingState: ConnectingState | null;
  setConnectingState: Dispatch<SetStateAction<ConnectingState | null>>;
  setDragState: Dispatch<SetStateAction<DragState | null>>;
  toWorldPoint: (event: { clientX: number; clientY: number }) => Point | null;
  nodeDragDidMoveRef: MutableRefObject<boolean>;
  animatedNodeSet: Set<string>;
  glowReadySet: Set<string>;
}
