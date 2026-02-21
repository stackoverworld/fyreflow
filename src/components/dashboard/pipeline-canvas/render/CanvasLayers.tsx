import type { RefObject } from "react";
import { cn } from "@/lib/cn";
import { isMultiSelectModifier } from "../selectionState";
import { EdgesLayer } from "./layers/EdgesLayer";
import { NodesLayer } from "./layers/NodesLayer";
import type { CanvasLayersProps } from "./layers/types";

export function CanvasLayers({
  canvasRef,
  canvasHeight,
  viewportState,
  selectionState,
  nodes,
  links,
  nodeById,
  renderedLinks,
  selectedNodeId,
  selectedNodeIds,
  selectedLinkId,
  readOnly,
  onSelectionChange,
  onConnectNodes,
  onDeleteNodes,
  animatedNodeSet,
  animatedLinkSet,
  glowReadySet,
  toolMode,
  marqueeFrame,
  children
}: CanvasLayersProps) {
  const { viewport, toCanvasPoint, toWorldPoint, panState, setPanState } = viewportState;
  const {
    setDragState,
    connectingState,
    setConnectingState,
    setMarqueeState,
    setRouteAdjustState,
    setManualRoutePoints,
    manualRoutePointsRef,
    routeUndoStackRef,
    routeRedoStackRef,
    routeAdjustStartSnapshotRef,
    nodeDragDidMoveRef
  } = selectionState;

  const isRunning = animatedNodeSet.size > 0 || animatedLinkSet.size > 0;

  return (
    <div
      ref={canvasRef as RefObject<HTMLDivElement>}
      className={cn(
        "relative overflow-hidden rounded-2xl rounded-bl-none rounded-tr-none border border-ink-800 bg-ink-950/50",
        isRunning && "canvas-running-border",
        panState ? "cursor-grabbing" : toolMode === "pan" ? "cursor-grab" : "cursor-crosshair"
      )}
      style={{
        height: canvasHeight,
        backgroundImage:
          `radial-gradient(circle, rgb(var(--dot-grid-color) / var(--dot-grid-alpha)) 1px, transparent 1px)`,
        backgroundSize: `${18 * viewport.scale}px ${18 * viewport.scale}px`,
        backgroundPosition: `${viewport.x}px ${viewport.y}px`
      }}
      onPointerDown={(event) => {
        if ((event.button !== 0 && event.button !== 1) || event.target !== event.currentTarget) {
          return;
        }

        if (toolMode === "pan" || event.button === 1 || event.altKey) {
          setPanState({
            startPointerX: event.clientX,
            startPointerY: event.clientY,
            startViewportX: viewport.x,
            startViewportY: viewport.y,
            clearSelectionOnTap: toolMode === "pan" && event.button === 0 && !event.altKey
          });
          return;
        }

        const canvasPoint = toCanvasPoint(event);
        const worldPoint = toWorldPoint(event);
        if (!canvasPoint || !worldPoint) {
          return;
        }

        setMarqueeState({
          additive: isMultiSelectModifier(event),
          startCanvas: canvasPoint,
          currentCanvas: canvasPoint,
          startWorld: worldPoint,
          currentWorld: worldPoint
        });
        }}
      >
      <EdgesLayer
        viewport={viewport}
        renderedLinks={renderedLinks}
        selectedLinkId={selectedLinkId}
        selectedNodeIds={selectedNodeIds}
        animatedLinkSet={animatedLinkSet}
        readOnly={readOnly}
        onSelectionChange={onSelectionChange}
        connectingState={connectingState}
        nodes={nodes}
        links={links}
        nodeById={nodeById}
        manualRoutePointsRef={manualRoutePointsRef}
        routeUndoStackRef={routeUndoStackRef}
        routeRedoStackRef={routeRedoStackRef}
        routeAdjustStartSnapshotRef={routeAdjustStartSnapshotRef}
        setManualRoutePoints={setManualRoutePoints}
        setRouteAdjustState={setRouteAdjustState}
        toWorldPoint={toWorldPoint}
      />

      <NodesLayer
        nodes={nodes}
        nodeById={nodeById}
        selectedNodeId={selectedNodeId}
        selectedNodeIds={selectedNodeIds}
        readOnly={readOnly}
        onSelectionChange={onSelectionChange}
        onConnectNodes={onConnectNodes}
        onDeleteNodes={onDeleteNodes}
        connectingState={connectingState}
        setConnectingState={setConnectingState}
        setDragState={setDragState}
        toWorldPoint={toWorldPoint}
        viewport={viewport}
        nodeDragDidMoveRef={nodeDragDidMoveRef}
        animatedNodeSet={animatedNodeSet}
        glowReadySet={glowReadySet}
      />

      {marqueeFrame ? (
        <div
          className="pointer-events-none absolute rounded-lg border border-ember-400/70 bg-ember-500/10"
          style={{
            left: marqueeFrame.left,
            top: marqueeFrame.top,
            width: marqueeFrame.right - marqueeFrame.left,
            height: marqueeFrame.bottom - marqueeFrame.top
          }}
        />
      ) : null}

      {children}
    </div>
  );
}
