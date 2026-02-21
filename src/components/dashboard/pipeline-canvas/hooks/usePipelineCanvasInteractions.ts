import {
  useRef,
  useState,
  type Dispatch,
  type MutableRefObject,
  type SetStateAction
} from "react";
import type { RouteAxis, CanvasToolMode, Point } from "../types";
import { usePipelineCanvasKeyboard } from "./usePipelineCanvasKeyboard";
import {
  type UseCanvasSelectionOptions,
  type UseCanvasSelectionResult,
  useCanvasSelection
} from "./useCanvasSelection";

export type { UseCanvasSelectionOptions, UseCanvasSelectionResult };

export type UsePipelineCanvasInteractionsOptions = Omit<UseCanvasSelectionOptions, "setSmartRouteByLinkId">;

export interface UsePipelineCanvasInteractionsResult {
  routeAxisMemoryRef: MutableRefObject<Map<string, RouteAxis>>;
  smartRouteByLinkId: Record<string, Point[]>;
  setSmartRouteByLinkId: Dispatch<SetStateAction<Record<string, Point[]>>>;
  toolMode: CanvasToolMode;
  setToolMode: Dispatch<SetStateAction<CanvasToolMode>>;
  selectionState: UseCanvasSelectionResult;
}

export function usePipelineCanvasInteractions({
  nodes,
  links,
  selectedNodeId,
  selectedNodeIds,
  selectedLinkId,
  onSelectionChange,
  onMoveNode,
  onMoveNodes,
  onConnectNodes,
  onDeleteNodes,
  onDeleteLink,
  onDragStateChange,
  onAutoLayout,
  readOnly = false,
  setViewport,
  panState,
  setPanState,
  toCanvasPoint,
  toWorldPoint
}: UsePipelineCanvasInteractionsOptions): UsePipelineCanvasInteractionsResult {
  const routeAxisMemoryRef = useRef<Map<string, RouteAxis>>(new Map());
  const [smartRouteByLinkId, setSmartRouteByLinkId] = useState<Record<string, Point[]>>({});
  const [toolMode, setToolMode] = useState<CanvasToolMode>("pan");

  const selectionState = useCanvasSelection({
    nodes,
    links,
    selectedNodeId,
    selectedNodeIds,
    selectedLinkId,
    onSelectionChange,
    onMoveNode,
    onMoveNodes,
    onConnectNodes,
    onDeleteNodes,
    onDeleteLink,
    onDragStateChange,
    onAutoLayout,
    readOnly,
    setSmartRouteByLinkId,
    setViewport,
    panState,
    setPanState,
    toCanvasPoint,
    toWorldPoint
  });

  usePipelineCanvasKeyboard({
    readOnly,
    selectedLinkId,
    onAutoLayout,
    setToolMode,
    triggerAutoLayout: selectionState.triggerAutoLayout,
    undoManualRoutePlacement: selectionState.undoManualRoutePlacement,
    redoManualRoutePlacement: selectionState.redoManualRoutePlacement
  });

  return {
    routeAxisMemoryRef,
    smartRouteByLinkId,
    setSmartRouteByLinkId,
    toolMode,
    setToolMode,
    selectionState
  };
}
