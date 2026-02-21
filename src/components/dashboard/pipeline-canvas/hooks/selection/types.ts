import type { Dispatch, MutableRefObject, SetStateAction } from "react";
import type {
  ConnectingState,
  DragState,
  MarqueeState,
  NodePositionUpdate,
  PipelineCanvasSelection,
  PanState,
  Point,
  RouteAdjustState,
  ViewportState,
  FlowLink,
  FlowNode
} from "../../types";

export interface UseCanvasSelectionOptions {
  nodes: FlowNode[];
  links: FlowLink[];
  selectedNodeId: string | null;
  selectedNodeIds: string[];
  selectedLinkId: string | null;
  onSelectionChange: (selection: PipelineCanvasSelection) => void;
  onMoveNode: (nodeId: string, position: { x: number; y: number }) => void;
  onMoveNodes?: (updates: NodePositionUpdate[]) => void;
  onConnectNodes: (sourceNodeId: string, targetNodeId: string) => void;
  onDeleteNodes?: (nodeIds: string[]) => void;
  onDeleteLink?: (linkId: string) => void;
  onDragStateChange?: (active: boolean) => void;
  onAutoLayout?: () => void;
  readOnly: boolean;
  setSmartRouteByLinkId: Dispatch<SetStateAction<Record<string, Point[]>>>;
  toCanvasPoint: (event: { clientX: number; clientY: number }) => Point | null;
  toWorldPoint: (event: { clientX: number; clientY: number }) => Point | null;
  setViewport: Dispatch<SetStateAction<ViewportState>>;
  panState: PanState | null;
  setPanState: Dispatch<SetStateAction<PanState | null>>;
}

export interface UseCanvasSelectionResult {
  manualRoutePoints: Record<string, Point>;
  setManualRoutePoints: Dispatch<SetStateAction<Record<string, Point>>>;
  manualRoutePointsRef: MutableRefObject<Record<string, Point>>;
  routeUndoStackRef: MutableRefObject<Record<string, Point>[]>;
  routeRedoStackRef: MutableRefObject<Record<string, Point>[]>;
  routeAdjustStartSnapshotRef: MutableRefObject<Record<string, Point> | null>;
  clearRouteHistory: () => void;
  undoManualRoutePlacement: () => boolean;
  redoManualRoutePlacement: () => boolean;
  dragState: DragState | null;
  setDragState: Dispatch<SetStateAction<DragState | null>>;
  connectingState: ConnectingState | null;
  setConnectingState: Dispatch<SetStateAction<ConnectingState | null>>;
  marqueeState: MarqueeState | null;
  setMarqueeState: Dispatch<SetStateAction<MarqueeState | null>>;
  routeAdjustState: RouteAdjustState | null;
  setRouteAdjustState: Dispatch<SetStateAction<RouteAdjustState | null>>;
  nodeDragDidMoveRef: MutableRefObject<boolean>;
  canUseSmartRoutes: boolean;
  marqueeFrame: {
    left: number;
    right: number;
    top: number;
    bottom: number;
  } | null;
  clearSelection: () => void;
  canDeleteSelection: boolean;
  handleDeleteSelection: () => void;
  triggerAutoLayout: () => void;
}
