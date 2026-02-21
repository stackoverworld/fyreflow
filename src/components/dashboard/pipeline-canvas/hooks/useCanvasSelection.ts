import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { rectFromPoints } from "../useNodeLayout";
import type { ConnectingState, DragState, MarqueeState, RouteAdjustState, Point } from "../types";
import { buildSelectionPointerHandlers } from "./selection/pointerHandlers";
import {
  clearRouteHistory as clearRouteHistoryState,
  pruneManualRoutePoints,
  redoManualRoutePlacement as redoManualRoutePlacementState,
  undoManualRoutePlacement as undoManualRoutePlacementState
} from "./selectionState";
import type { UseCanvasSelectionOptions, UseCanvasSelectionResult } from "./selection/types";

export type { UseCanvasSelectionOptions, UseCanvasSelectionResult };

export function useCanvasSelection({
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
  toCanvasPoint,
  toWorldPoint,
  setViewport,
  panState,
  setPanState
}: UseCanvasSelectionOptions): UseCanvasSelectionResult {
  const [manualRoutePoints, setManualRoutePoints] = useState<Record<string, Point>>({});
  const manualRoutePointsRef = useRef<Record<string, Point>>({});
  const routeUndoStackRef = useRef<Record<string, Point>[]>([]);
  const routeRedoStackRef = useRef<Record<string, Point>[]>([]);
  const routeAdjustStartSnapshotRef = useRef<Record<string, Point> | null>(null);
  const [dragState, setDragState] = useState<DragState | null>(null);
  const [connectingState, setConnectingState] = useState<ConnectingState | null>(null);
  const [marqueeState, setMarqueeState] = useState<MarqueeState | null>(null);
  const [routeAdjustState, setRouteAdjustState] = useState<RouteAdjustState | null>(null);
  const nodeDragDidMoveRef = useRef(false);

  useEffect(() => {
    if (!readOnly) {
      return;
    }

    setDragState(null);
    setConnectingState(null);
    setMarqueeState(null);
    setRouteAdjustState(null);
  }, [readOnly]);

  useEffect(() => {
    onDragStateChange?.(dragState !== null);
  }, [dragState, onDragStateChange]);

  useEffect(() => {
    return () => {
      onDragStateChange?.(false);
    };
  }, [onDragStateChange]);

  useEffect(() => {
    manualRoutePointsRef.current = manualRoutePoints;
  }, [manualRoutePoints]);

  const clearRouteHistory = useCallback(() => {
    clearRouteHistoryState(routeUndoStackRef, routeRedoStackRef, routeAdjustStartSnapshotRef);
  }, []);

  const clearSelection = useCallback(() => {
    onSelectionChange({
      nodeIds: [],
      primaryNodeId: null,
      linkId: null
    });
  }, [onSelectionChange]);

  const triggerAutoLayout = useCallback(() => {
    if (readOnly) {
      return;
    }

    if (!onAutoLayout) {
      return;
    }

    setManualRoutePoints({});
    setSmartRouteByLinkId({});
    setRouteAdjustState(null);
    clearRouteHistory();
    onAutoLayout();
  }, [clearRouteHistory, onAutoLayout, onSelectionChange, readOnly, setSmartRouteByLinkId]);

  const undoManualRoutePlacement = useCallback((): boolean => {
    return undoManualRoutePlacementState({
      manualRoutePointsRef,
      routeUndoStackRef,
      routeRedoStackRef,
      routeAdjustStartSnapshotRef,
      setManualRoutePoints,
      setRouteAdjustState
    });
  }, []);

  const redoManualRoutePlacement = useCallback((): boolean => {
    return redoManualRoutePlacementState({
      manualRoutePointsRef,
      routeUndoStackRef,
      routeRedoStackRef,
      routeAdjustStartSnapshotRef,
      setManualRoutePoints,
      setRouteAdjustState
    });
  }, []);

  const handleDeleteSelection = useCallback(() => {
    if (readOnly) {
      return;
    }

    if (selectedNodeIds.length > 0) {
      onDeleteNodes?.(selectedNodeIds);
      return;
    }

    if (selectedLinkId) {
      onDeleteLink?.(selectedLinkId);
    }
  }, [onDeleteLink, onDeleteNodes, readOnly, selectedLinkId, selectedNodeIds]);

  const canDeleteSelection = selectedNodeIds.length > 0 || Boolean(selectedLinkId);

  useEffect(() => {
    const { removed } = pruneManualRoutePoints(manualRoutePointsRef.current, links);
    setManualRoutePoints((current) => {
      const next = pruneManualRoutePoints(current, links);
      return next.removed ? next.points : current;
    });

    if (removed) {
      clearRouteHistory();
    }
  }, [clearRouteHistory, links]);

  useEffect(() => {
    if (!dragState && !panState && !connectingState && !marqueeState && !routeAdjustState) {
      return;
    }

    const { onPointerMove, onPointerUp } = buildSelectionPointerHandlers({
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
    });

    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);

    return () => {
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
    };
  }, [
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
    toWorldPoint
  ]);

  const canUseSmartRoutes = dragState === null || !nodeDragDidMoveRef.current;

  const marqueeFrame = useMemo(() => {
    if (!marqueeState) {
      return null;
    }

    return rectFromPoints(marqueeState.startCanvas, marqueeState.currentCanvas);
  }, [marqueeState]);

  return {
    manualRoutePoints,
    setManualRoutePoints,
    manualRoutePointsRef,
    routeUndoStackRef,
    routeRedoStackRef,
    routeAdjustStartSnapshotRef,
    clearRouteHistory,
    undoManualRoutePlacement,
    redoManualRoutePlacement,
    dragState,
    setDragState,
    connectingState,
    setConnectingState,
    marqueeState,
    setMarqueeState,
    routeAdjustState,
    setRouteAdjustState,
    nodeDragDidMoveRef,
    canUseSmartRoutes,
    marqueeFrame,
    clearSelection,
    canDeleteSelection,
    handleDeleteSelection,
    triggerAutoLayout
  };
}
