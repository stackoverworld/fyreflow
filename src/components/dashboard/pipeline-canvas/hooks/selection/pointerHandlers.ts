import type { Dispatch, MutableRefObject, SetStateAction } from "react";
import { findNodeAtPoint } from "../../useNodeLayout";
import type {
  ConnectingState,
  DragState,
  FlowNode,
  MarqueeState,
  NodePositionUpdate,
  PanState,
  PipelineCanvasSelection,
  Point,
  RouteAdjustState,
  ViewportState
} from "../../types";
import {
  buildDragUpdates,
  buildMarqueeSelection,
  buildRouteAdjustPoint,
  isPointerDrag,
  resolveTargetNodeIdForConnection
} from "../selectionMath";
import { finalizeRouteAdjustState } from "../selectionState";

export interface SelectionPointerHandlersArgs {
  connectingState: ConnectingState | null;
  dragState: DragState | null;
  marqueeState: MarqueeState | null;
  nodes: FlowNode[];
  onConnectNodes: (sourceNodeId: string, targetNodeId: string) => void;
  onMoveNode: (nodeId: string, position: { x: number; y: number }) => void;
  onMoveNodes?: (updates: NodePositionUpdate[]) => void;
  onSelectionChange: (selection: PipelineCanvasSelection) => void;
  panState: PanState | null;
  routeAdjustState: RouteAdjustState | null;
  clearSelection: () => void;
  selectedNodeId: string | null;
  selectedNodeIds: string[];
  setViewport: Dispatch<SetStateAction<ViewportState>>;
  toCanvasPoint: (event: { clientX: number; clientY: number }) => Point | null;
  toWorldPoint: (event: { clientX: number; clientY: number }) => Point | null;
  setManualRoutePoints: Dispatch<SetStateAction<Record<string, Point>>>;
  setPanState: Dispatch<SetStateAction<PanState | null>>;
  setDragState: Dispatch<SetStateAction<DragState | null>>;
  setConnectingState: Dispatch<SetStateAction<ConnectingState | null>>;
  setMarqueeState: Dispatch<SetStateAction<MarqueeState | null>>;
  setRouteAdjustState: Dispatch<SetStateAction<RouteAdjustState | null>>;
  manualRoutePointsRef: MutableRefObject<Record<string, Point>>;
  routeUndoStackRef: MutableRefObject<Record<string, Point>[]>;
  routeRedoStackRef: MutableRefObject<Record<string, Point>[]>;
  routeAdjustStartSnapshotRef: MutableRefObject<Record<string, Point> | null>;
  nodeDragDidMoveRef: MutableRefObject<boolean>;
}

export function buildSelectionPointerHandlers({
  connectingState,
  dragState,
  marqueeState,
  nodes,
  onConnectNodes,
  onMoveNode,
  onMoveNodes,
  onSelectionChange,
  panState,
  routeAdjustState,
  clearSelection,
  selectedNodeId,
  selectedNodeIds,
  setViewport,
  toCanvasPoint,
  toWorldPoint,
  setManualRoutePoints,
  setPanState,
  setDragState,
  setConnectingState,
  setMarqueeState,
  setRouteAdjustState,
  manualRoutePointsRef,
  routeUndoStackRef,
  routeRedoStackRef,
  routeAdjustStartSnapshotRef,
  nodeDragDidMoveRef
}: SelectionPointerHandlersArgs): {
  onPointerMove: (event: PointerEvent) => void;
  onPointerUp: (event: PointerEvent) => void;
} {
  const onPointerMove = (event: PointerEvent) => {
    if (routeAdjustState) {
      const worldPoint = toWorldPoint(event);
      if (!worldPoint) {
        return;
      }

      setManualRoutePoints((current) => ({
        ...current,
        [routeAdjustState.linkId]: buildRouteAdjustPoint(worldPoint, routeAdjustState)
      }));
    }

    if (dragState) {
      const worldPoint = toWorldPoint(event);
      if (!worldPoint) {
        return;
      }

      const dragResult = buildDragUpdates(dragState, worldPoint, nodes);
      if (!dragResult) {
        return;
      }

      const shouldApplyDrag = nodeDragDidMoveRef.current || dragResult.hasDragged;
      if (shouldApplyDrag) {
        if (!nodeDragDidMoveRef.current) {
          nodeDragDidMoveRef.current = true;
        }

        if (onMoveNodes) {
          onMoveNodes(dragResult.updates);
        } else {
          dragResult.updates.forEach((entry) => onMoveNode(entry.nodeId, entry.position));
        }
      }
    }

    if (panState) {
      setViewport((current) => ({
        ...current,
        x: panState.startViewportX + (event.clientX - panState.startPointerX),
        y: panState.startViewportY + (event.clientY - panState.startPointerY)
      }));
    }

    if (connectingState) {
      const worldPoint = toWorldPoint(event);
      if (!worldPoint) {
        return;
      }

      const targetNode = findNodeAtPoint(worldPoint, nodes, connectingState.sourceNodeId);
      setConnectingState((current) =>
        current
          ? {
              ...current,
              pointer: worldPoint,
              targetNodeId: targetNode?.id ?? null
            }
          : null
      );
    }

    if (marqueeState) {
      const canvasPoint = toCanvasPoint(event);
      const worldPoint = toWorldPoint(event);
      if (!canvasPoint || !worldPoint) {
        return;
      }

      setMarqueeState((current) =>
        current
          ? {
              ...current,
              currentCanvas: canvasPoint,
              currentWorld: worldPoint
            }
          : null
      );
    }
  };

  const onPointerUp = (event: PointerEvent) => {
    if (connectingState) {
      let targetNodeId = connectingState.targetNodeId;
      if (!targetNodeId) {
        const worldPoint = toWorldPoint(event);
        targetNodeId = resolveTargetNodeIdForConnection(connectingState, worldPoint, nodes);
      }

      if (targetNodeId && targetNodeId !== connectingState.sourceNodeId) {
        onConnectNodes(connectingState.sourceNodeId, targetNodeId);
        onSelectionChange({
          nodeIds: [targetNodeId],
          primaryNodeId: targetNodeId,
          linkId: null
        });
      }
    }

    if (marqueeState) {
      const dragged = isPointerDrag(marqueeState.currentCanvas, marqueeState.startCanvas);

      if (dragged) {
        const selection = buildMarqueeSelection({
          marqueeState,
          selectedNodeIds,
          selectedNodeId,
          additive: marqueeState.additive,
          nodes
        });
        onSelectionChange({
          nodeIds: selection.nodeIds,
          primaryNodeId: selection.primaryNodeId,
          linkId: null
        });
      } else if (!marqueeState.additive) {
        clearSelection();
      }
    }

    if (panState?.clearSelectionOnTap) {
      const dragged = isPointerDrag({ x: event.clientX, y: event.clientY }, { x: panState.startPointerX, y: panState.startPointerY });
      if (!dragged) {
        clearSelection();
      }
    }

    if (dragState && !nodeDragDidMoveRef.current) {
      onSelectionChange({
        nodeIds: dragState.initialPositions.map((entry) => entry.nodeId),
        primaryNodeId: dragState.anchorNodeId,
        linkId: null
      });
    }

    if (routeAdjustState) {
      finalizeRouteAdjustState({
        routeAdjustStartSnapshotRef,
        manualRoutePointsRef,
        routeUndoStackRef,
        routeRedoStackRef
      });
    }

    setPanState(null);
    setDragState(null);
    setConnectingState(null);
    setMarqueeState(null);
    setRouteAdjustState(null);
    nodeDragDidMoveRef.current = false;
  };

  return {
    onPointerMove,
    onPointerUp
  };
}
