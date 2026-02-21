import type { AgentRole, LinkCondition, ProviderId } from "@/lib/types";

export interface FlowNode {
  id: string;
  name: string;
  role: AgentRole;
  providerId: ProviderId;
  model: string;
  position: {
    x: number;
    y: number;
  };
  enableDelegation?: boolean;
  delegationCount?: number;
  fastMode?: boolean;
  use1MContext?: boolean;
  enableIsolatedStorage?: boolean;
  enableSharedStorage?: boolean;
}

export interface FlowLink {
  id: string;
  sourceStepId: string;
  targetStepId: string;
  condition?: LinkCondition;
}

export interface PipelineCanvasSelection {
  nodeIds: string[];
  primaryNodeId: string | null;
  linkId: string | null;
  isDragStart?: boolean;
}

export interface NodePositionUpdate {
  nodeId: string;
  position: {
    x: number;
    y: number;
  };
}

export interface PipelineCanvasProps {
  nodes: FlowNode[];
  links: FlowLink[];
  animatedNodeIds?: string[];
  animatedLinkIds?: string[];
  selectedNodeId: string | null;
  selectedNodeIds: string[];
  selectedLinkId: string | null;
  onSelectionChange: (selection: PipelineCanvasSelection) => void;
  onAddNode: () => void;
  onAutoLayout?: () => void;
  onMoveNode: (nodeId: string, position: { x: number; y: number }) => void;
  onMoveNodes?: (updates: NodePositionUpdate[]) => void;
  onDragStateChange?: (active: boolean) => void;
  onConnectNodes: (sourceNodeId: string, targetNodeId: string) => void;
  onDeleteNodes?: (nodeIds: string[]) => void;
  onDeleteLink?: (linkId: string) => void;
  readOnly?: boolean;
  className?: string;
  showToolbar?: boolean;
  canvasHeight?: number | string;
}

export interface DragState {
  anchorNodeId: string;
  offsetX: number;
  offsetY: number;
  initialPositions: NodePositionUpdate[];
}

export interface PanState {
  startPointerX: number;
  startPointerY: number;
  startViewportX: number;
  startViewportY: number;
  clearSelectionOnTap: boolean;
}

export interface ConnectingState {
  sourceNodeId: string;
  pointer: {
    x: number;
    y: number;
  };
  targetNodeId: string | null;
}

export interface MarqueeState {
  additive: boolean;
  startCanvas: Point;
  currentCanvas: Point;
  startWorld: Point;
  currentWorld: Point;
}

export interface RouteAdjustState {
  linkId: string;
  offsetX: number;
  offsetY: number;
}

export interface ViewportState {
  x: number;
  y: number;
  scale: number;
}

export interface Point {
  x: number;
  y: number;
}

export interface Rect {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

export type AnchorSide = "left" | "right" | "top" | "bottom";
export type RouteAxis = "horizontal" | "vertical";
export type CanvasToolMode = "select" | "pan";

export interface CanonicalRouteCandidate {
  axis: RouteAxis;
  route: Point[];
  sourceSide: AnchorSide;
  targetSide: AnchorSide;
}

export interface OrchestratorLaneMeta {
  orchestratorId: string;
  side: AnchorSide;
  index: number;
  count: number;
}

export interface ReciprocalLaneMeta {
  offset: number;
  sourceIndex?: number;
  sourceCount?: number;
  targetIndex?: number;
  targetCount?: number;
}

export interface RenderedLink {
  id: string;
  path: string;
  route: Point[];
  pathDistance: number;
  endPoint: Point;
  axis: RouteAxis | null;
  dasharray: string | null;
  hasOrchestrator: boolean;
  controlPoint: Point;
  hasManualRoute: boolean;
  visual: {
    stroke: string;
    markerId: string;
  };
}
