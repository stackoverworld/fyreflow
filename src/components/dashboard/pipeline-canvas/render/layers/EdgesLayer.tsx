import { useMemo } from "react";
import { AnimatePresence, motion } from "motion/react";
import { EDGE_COLOR, EDGE_FAIL_COLOR, EDGE_PASS_COLOR } from "../../edgeRendering";
import { cloneManualRoutePoints, manualRoutePointsEqual, pushRouteHistorySnapshot } from "../../selectionState";
import { type EdgesLayerProps } from "./types";
import { EdgePathGroup } from "./edges/EdgePathGroup";
import { EDGE_SHIMMER_LAYERS } from "./edges/edgeLayerSelectors";
import { buildPotentialOrchestratorDispatchRoutes, type PotentialDispatchRoute } from "./edges/potentialDispatchRoutes";
import {
  getActivePotentialDispatchRouteIds,
  getLinksIntersectingPotentialRoutes,
  getPotentialDispatchOrchestratorIds
} from "./edges/potentialDispatchSelectors";
import { useConnectingPreviewData, useEdgeRenderData } from "./edges/useEdgeRenderData";

const POTENTIAL_DISPATCH_COLOR = "#a6afbe";
const POTENTIAL_DISPATCH_OPACITY = 0.66;
const POTENTIAL_DISPATCH_DASHARRAY = "6 5";
const POTENTIAL_DISPATCH_STROKE_WIDTH = 1.8;
const ORCHESTRATOR_CONNECTED_EDGE_OPACITY = 0.66;
const ORCHESTRATOR_OTHER_EDGE_OPACITY = 0.18;
const ACTIVE_DISPATCH_PATH_EDGE_OPACITY = 0.3;
const EDGE_FADE_TRANSITION = {
  duration: 0.24,
  ease: [0.16, 1, 0.3, 1] as const
};

export function EdgesLayer({
  renderedLinks,
  selectedLinkId,
  selectedNodeId,
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
  const selectedOrchestratorId = useMemo(() => {
    if (!selectedNodeId) {
      return null;
    }
    const selectedNode = nodeById.get(selectedNodeId);
    return selectedNode?.role === "orchestrator" ? selectedNode.id : null;
  }, [nodeById, selectedNodeId]);
  const activePotentialDispatchRouteIds = useMemo(
    () => getActivePotentialDispatchRouteIds(animatedLinkSet),
    [animatedLinkSet]
  );
  const activePotentialDispatchOrchestratorIds = useMemo(
    () => getPotentialDispatchOrchestratorIds(activePotentialDispatchRouteIds),
    [activePotentialDispatchRouteIds]
  );
  const potentialDispatchRoutes = useMemo(() => {
    const routesById = new Map<string, PotentialDispatchRoute>();

    if (selectedOrchestratorId) {
      const selectedRoutes = buildPotentialOrchestratorDispatchRoutes(nodes, links, {
        orchestratorIds: [selectedOrchestratorId]
      });
      for (const route of selectedRoutes) {
        routesById.set(route.id, route);
      }
    }

    if (activePotentialDispatchOrchestratorIds.length > 0) {
      const activeRoutes = buildPotentialOrchestratorDispatchRoutes(nodes, links, {
        orchestratorIds: activePotentialDispatchOrchestratorIds
      });
      for (const route of activeRoutes) {
        if (activePotentialDispatchRouteIds.has(route.id)) {
          routesById.set(route.id, route);
        }
      }
    }

    return [...routesById.values()];
  }, [
    activePotentialDispatchOrchestratorIds,
    activePotentialDispatchRouteIds,
    links,
    nodes,
    selectedOrchestratorId
  ]);
  const activePotentialDispatchRoutes = useMemo(
    () => potentialDispatchRoutes.filter((route) => activePotentialDispatchRouteIds.has(route.id)),
    [activePotentialDispatchRouteIds, potentialDispatchRoutes]
  );
  const edgeOpacityMultiplierByLinkId = useMemo(() => {
    const multipliers = new Map<string, number>();
    if (selectedOrchestratorId) {
      for (const link of links) {
        const touchesSelectedOrchestrator =
          link.sourceStepId === selectedOrchestratorId || link.targetStepId === selectedOrchestratorId;
        multipliers.set(
          link.id,
          touchesSelectedOrchestrator ? ORCHESTRATOR_CONNECTED_EDGE_OPACITY : ORCHESTRATOR_OTHER_EDGE_OPACITY
        );
      }
    }

    if (activePotentialDispatchRoutes.length > 0) {
      const intersectingLinkIds = getLinksIntersectingPotentialRoutes(renderedLinks, activePotentialDispatchRoutes);
      for (const linkId of intersectingLinkIds) {
        const current = multipliers.get(linkId) ?? 1;
        multipliers.set(linkId, Math.min(current, ACTIVE_DISPATCH_PATH_EDGE_OPACITY));
      }
    }

    return multipliers;
  }, [activePotentialDispatchRoutes, links, renderedLinks, selectedOrchestratorId]);
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
          <marker
            id="flow-arrow-possible"
            markerUnits="userSpaceOnUse"
            viewBox="0 0 12 12"
            markerWidth="12"
            markerHeight="12"
            refX="11"
            refY="6"
            orient="auto-start-reverse"
          >
            <path
              d="M1 1.3 Q2.8 6 1 10.7 L11 6 Z"
              fill={POTENTIAL_DISPATCH_COLOR}
              stroke={POTENTIAL_DISPATCH_COLOR}
              strokeWidth={0.85}
              strokeLinejoin="round"
              opacity="0.9"
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
          <AnimatePresence initial={false}>
            {potentialDispatchRoutes.map((route) => (
              <motion.g
                key={route.id}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={EDGE_FADE_TRANSITION}
              >
                <motion.path
                  d={route.path}
                  fill="none"
                  stroke={POTENTIAL_DISPATCH_COLOR}
                  strokeWidth={POTENTIAL_DISPATCH_STROKE_WIDTH}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  vectorEffect="non-scaling-stroke"
                  strokeDasharray={POTENTIAL_DISPATCH_DASHARRAY}
                  markerEnd="url(#flow-arrow-possible)"
                  initial={false}
                  animate={{ opacity: animatedLinkSet.has(route.id) ? 0.88 : POTENTIAL_DISPATCH_OPACITY }}
                  transition={EDGE_FADE_TRANSITION}
                />
                {animatedLinkSet.has(route.id) ? (
                  <g className="link-shimmer-group" opacity="0">
                    {EDGE_SHIMMER_LAYERS.map((shimmerLayer) => (
                      <path
                        key={`${route.id}:${shimmerLayer.dasharray}`}
                        className="link-shimmer-path"
                        d={route.path}
                        fill="none"
                        stroke="white"
                        strokeWidth={POTENTIAL_DISPATCH_STROKE_WIDTH + shimmerLayer.widthOffset}
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        vectorEffect="non-scaling-stroke"
                        pathLength={1}
                        strokeDasharray={shimmerLayer.dasharray}
                        data-dash-len={shimmerLayer.dataDashLen}
                        filter={shimmerLayer.filter}
                        opacity={Math.min(0.56, shimmerLayer.opacity + 0.14)}
                      />
                    ))}
                  </g>
                ) : null}
              </motion.g>
            ))}
          </AnimatePresence>

          {edgeRenderData.map((edgeData) => (
            <EdgePathGroup
              key={edgeData.link.id}
              data={edgeData}
              opacityMultiplier={edgeOpacityMultiplierByLinkId.get(edgeData.link.id) ?? 1}
            />
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
