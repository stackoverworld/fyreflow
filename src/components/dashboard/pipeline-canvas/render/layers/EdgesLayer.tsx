import { EDGE_COLOR, EDGE_FAIL_COLOR, EDGE_PASS_COLOR } from "../../edgeRendering";
import { cloneManualRoutePoints, manualRoutePointsEqual, pushRouteHistorySnapshot } from "../../selectionState";
import { type EdgesLayerProps } from "./types";
import { EdgePathGroup } from "./edges/EdgePathGroup";
import { useConnectingPreviewData, useEdgeRenderData } from "./edges/useEdgeRenderData";

export function EdgesLayer({
  renderedLinks,
  selectedLinkId,
  selectedNodeIds,
  animatedLinkSet,
  viewport,
  readOnly,
  onSelectionChange,
  connectingState,
  nodes,
  links,
  nodeById,
  manualRoutePointsRef,
  routeUndoStackRef,
  routeRedoStackRef,
  routeAdjustStartSnapshotRef,
  setManualRoutePoints,
  setRouteAdjustState,
  toWorldPoint
}: EdgesLayerProps) {
  const edgeRenderData = useEdgeRenderData({
    renderedLinks,
    links,
    selectedNodeIds,
    selectedLinkId,
    animatedLinkSet
  });
  const connectingPreview = useConnectingPreviewData({
    connectingState,
    nodes,
    links,
    nodeById
  });

  return (
    <>
      <svg className="pointer-events-none absolute inset-0 h-full w-full">
        <defs>
          <marker
            id="flow-arrow"
            markerUnits="userSpaceOnUse"
            viewBox="0 0 14 14"
            markerWidth="14"
            markerHeight="14"
            refX="13"
            refY="7"
            orient="auto-start-reverse"
          >
            <path
              d="M1 1.4 Q3.1 7 1 12.6 L13 7 Z"
              fill={EDGE_COLOR}
              stroke={EDGE_COLOR}
              strokeWidth={0.8}
              strokeLinejoin="round"
            />
          </marker>
          <marker
            id="flow-arrow-pass"
            markerUnits="userSpaceOnUse"
            viewBox="0 0 14 14"
            markerWidth="14"
            markerHeight="14"
            refX="13"
            refY="7"
            orient="auto-start-reverse"
          >
            <path
              d="M1 1.4 Q3.1 7 1 12.6 L13 7 Z"
              fill={EDGE_PASS_COLOR}
              stroke={EDGE_PASS_COLOR}
              strokeWidth={0.8}
              strokeLinejoin="round"
            />
          </marker>
          <marker
            id="flow-arrow-fail"
            markerUnits="userSpaceOnUse"
            viewBox="0 0 14 14"
            markerWidth="14"
            markerHeight="14"
            refX="13"
            refY="7"
            orient="auto-start-reverse"
          >
            <path
              d="M1 1.4 Q3.1 7 1 12.6 L13 7 Z"
              fill={EDGE_FAIL_COLOR}
              stroke={EDGE_FAIL_COLOR}
              strokeWidth={0.8}
              strokeLinejoin="round"
            />
          </marker>
          <filter id="link-shimmer-soft" x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur stdDeviation="10" />
          </filter>
          <filter id="link-shimmer-mid" x="-40%" y="-40%" width="180%" height="180%">
            <feGaussianBlur stdDeviation="5" />
          </filter>
        </defs>

        <g transform={`translate(${viewport.x} ${viewport.y}) scale(${viewport.scale})`}>
          {edgeRenderData.map((edgeData) => (
            <EdgePathGroup key={edgeData.link.id} data={edgeData} />
          ))}

          {connectingPreview ? (
            <path
              d={connectingPreview.d}
              fill="none"
              stroke={connectingPreview.stroke}
              strokeWidth={connectingPreview.strokeWidth}
              strokeLinecap="round"
              strokeLinejoin="round"
              vectorEffect="non-scaling-stroke"
              strokeDasharray={connectingPreview.strokeDasharray ?? undefined}
              opacity={connectingPreview.opacity}
              markerEnd={connectingPreview.markerEnd}
            />
          ) : null}
        </g>
      </svg>

      <svg className="pointer-events-none absolute inset-0 h-full w-full">
        <g transform={`translate(${viewport.x} ${viewport.y}) scale(${viewport.scale})`}>
          {edgeRenderData.map(({ isPrimarySelected, link }) => (
            <g key={`hit-${link.id}`}>
              <path
                d={link.path}
                fill="none"
                stroke="transparent"
                strokeWidth={16}
                strokeLinecap="round"
                strokeLinejoin="round"
                vectorEffect="non-scaling-stroke"
                pointerEvents="stroke"
                className="pointer-events-auto cursor-pointer"
                onPointerDown={(event) => {
                  if (event.button !== 0) {
                    return;
                  }

                  event.stopPropagation();
                  if (readOnly) {
                    onSelectionChange({
                      nodeIds: [],
                      primaryNodeId: null,
                      linkId: link.id
                    });
                    return;
                  }

                  const worldPoint = toWorldPoint(event);
                  if (selectedLinkId === link.id && worldPoint) {
                    routeAdjustStartSnapshotRef.current = cloneManualRoutePoints(manualRoutePointsRef.current);
                    setManualRoutePoints((current) => ({
                      ...current,
                      [link.id]: {
                        x: Math.round(worldPoint.x),
                        y: Math.round(worldPoint.y)
                      }
                    }));
                    setRouteAdjustState({
                      linkId: link.id,
                      offsetX: 0,
                      offsetY: 0
                    });
                  }

                  onSelectionChange({
                    nodeIds: [],
                    primaryNodeId: null,
                    linkId: link.id
                  });
                }}
              />
              {isPrimarySelected ? (
                <circle
                  cx={link.controlPoint.x}
                  cy={link.controlPoint.y}
                  r={7.5}
                  fill={link.hasManualRoute ? "rgba(236, 154, 125, 0.3)" : "rgba(236, 154, 125, 0.18)"}
                  stroke={link.visual.stroke}
                  strokeWidth={1.5}
                  pointerEvents="all"
                  className="pointer-events-auto cursor-grab active:cursor-grabbing"
                  onPointerDown={(event) => {
                    if (readOnly) {
                      return;
                    }

                    if (event.button !== 0) {
                      return;
                    }

                    event.stopPropagation();
                    const worldPoint = toWorldPoint(event);
                    if (!worldPoint) {
                      return;
                    }

                    routeAdjustStartSnapshotRef.current = cloneManualRoutePoints(manualRoutePointsRef.current);
                    setManualRoutePoints((current) => ({
                      ...current,
                      [link.id]: {
                        x: Math.round(link.controlPoint.x),
                        y: Math.round(link.controlPoint.y)
                      }
                    }));

                    setRouteAdjustState({
                      linkId: link.id,
                      offsetX: worldPoint.x - link.controlPoint.x,
                      offsetY: worldPoint.y - link.controlPoint.y
                    });
                  }}
                  onDoubleClick={(event) => {
                    if (readOnly) {
                      return;
                    }

                    event.stopPropagation();
                    const previous = cloneManualRoutePoints(manualRoutePointsRef.current);
                    if (!(link.id in previous)) {
                      return;
                    }

                    const next = cloneManualRoutePoints(previous);
                    delete next[link.id];
                    if (manualRoutePointsEqual(previous, next)) {
                      return;
                    }

                    routeUndoStackRef.current = pushRouteHistorySnapshot(routeUndoStackRef.current, previous);
                    routeRedoStackRef.current = [];
                    routeAdjustStartSnapshotRef.current = null;
                    setManualRoutePoints(next);
                  }}
                />
              ) : null}
              <circle
                cx={link.endPoint.x}
                cy={link.endPoint.y}
                r={12}
                fill="transparent"
                pointerEvents="all"
                className="pointer-events-auto cursor-pointer"
                onPointerDown={(event) => {
                  if (event.button !== 0) {
                    return;
                  }

                  event.stopPropagation();
                  if (readOnly) {
                    onSelectionChange({
                      nodeIds: [],
                      primaryNodeId: null,
                      linkId: link.id
                    });
                    return;
                  }

                  onSelectionChange({
                    nodeIds: [],
                    primaryNodeId: null,
                    linkId: link.id
                  });
                }}
              />
            </g>
          ))}
        </g>
      </svg>
    </>
  );
}
