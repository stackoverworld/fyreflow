import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { computeEdgeRoutesSmart } from "@/lib/flowLayout";
import { CANVAS_HEIGHT } from "./pipeline-canvas/PipelineCanvas.constants";
import { buildOrchestratorLaneByLinkId, buildReciprocalLaneByLinkId } from "./pipeline-canvas/PipelineCanvas.viewport";
import { buildRenderedLinks, syncRouteAxisMemory } from "./pipeline-canvas/PipelineCanvas.handlers";
import {
  type FlowNode,
  type PipelineCanvasProps,
  type RenderedLink
} from "./pipeline-canvas/types";
import { usePipelineCanvasViewport } from "./pipeline-canvas/hooks/usePipelineCanvasViewport";
import { PipelineCanvasContent } from "./pipeline-canvas/components/PipelineCanvasContent";
import { PipelineCanvasOverlays } from "./pipeline-canvas/components/PipelineCanvasOverlays";
import { usePipelineCanvasInteractions } from "./pipeline-canvas/hooks/usePipelineCanvasInteractions";
import { ZOOM_MAX, ZOOM_MIN } from "./pipeline-canvas/useCanvasInteractions";
import { NODE_WIDTH, clamp, nodeVisualHeight } from "./pipeline-canvas/useNodeLayout";

const VIEWPORT_FIT_PADDING = 72;
const AUTO_LAYOUT_CENTER_FALLBACK_MS = 900;

function buildNodePositionSignature(nodes: FlowNode[]): string {
  return nodes
    .map(
      (node) =>
        `${node.id}:${Math.round(node.position.x)}:${Math.round(node.position.y)}:${node.enableDelegation ? 1 : 0}:${node.delegationCount ?? 0}`
    )
    .join("|");
}

export function PipelineCanvas({
  nodes,
  links,
  animatedNodeIds = [],
  animatedLinkIds = [],
  runStatus,
  selectedNodeId,
  selectedNodeIds,
  selectedLinkId,
  onSelectionChange,
  onAddNode,
  onAutoLayout,
  onMoveNode,
  onMoveNodes,
  onDragStateChange,
  onConnectNodes,
  onDeleteNodes,
  onDeleteLink,
  readOnly = false,
  className,
  showToolbar = true,
  canvasHeight = CANVAS_HEIGHT
}: PipelineCanvasProps) {
  const canvasRef = useRef<HTMLDivElement>(null);
  const hasCenteredInitialViewRef = useRef(false);
  const pendingAutoCenterRef = useRef<{ baselineSignature: string } | null>(null);
  const autoCenterFallbackTimerRef = useRef<number | null>(null);

  const { viewport, setViewport, panState, setPanState, toCanvasPoint, toWorldPoint } = usePipelineCanvasViewport({
    canvasRef
  });
  const nodePositionSignature = useMemo(() => buildNodePositionSignature(nodes), [nodes]);

  const centerViewportOnNodes = useCallback(() => {
    if (nodes.length === 0) {
      return;
    }

    const canvas = canvasRef.current;
    if (!canvas) {
      return;
    }

    const canvasRect = canvas.getBoundingClientRect();
    if (canvasRect.width <= 0 || canvasRect.height <= 0) {
      return;
    }

    let minX = Number.POSITIVE_INFINITY;
    let maxX = Number.NEGATIVE_INFINITY;
    let minY = Number.POSITIVE_INFINITY;
    let maxY = Number.NEGATIVE_INFINITY;

    for (const node of nodes) {
      const nodeHeight = nodeVisualHeight(node);
      minX = Math.min(minX, node.position.x);
      maxX = Math.max(maxX, node.position.x + NODE_WIDTH);
      minY = Math.min(minY, node.position.y);
      maxY = Math.max(maxY, node.position.y + nodeHeight);
    }

    if (!Number.isFinite(minX) || !Number.isFinite(maxX) || !Number.isFinite(minY) || !Number.isFinite(maxY)) {
      return;
    }

    const graphCenterX = (minX + maxX) / 2;
    const graphCenterY = (minY + maxY) / 2;
    const graphWidth = Math.max(1, maxX - minX);
    const graphHeight = Math.max(1, maxY - minY);
    const fitScaleX = Math.max(1, canvasRect.width - VIEWPORT_FIT_PADDING * 2) / graphWidth;
    const fitScaleY = Math.max(1, canvasRect.height - VIEWPORT_FIT_PADDING * 2) / graphHeight;
    const fitScale = clamp(Math.min(fitScaleX, fitScaleY), ZOOM_MIN, ZOOM_MAX);

    setViewport((current) => {
      const nextScale = Math.min(current.scale, fitScale);
      const nextX = Math.round(canvasRect.width / 2 - graphCenterX * nextScale);
      const nextY = Math.round(canvasRect.height / 2 - graphCenterY * nextScale);

      if (
        Math.round(current.x) === nextX &&
        Math.round(current.y) === nextY &&
        Math.abs(current.scale - nextScale) < 0.0001
      ) {
        return current;
      }

      return {
        x: nextX,
        y: nextY,
        scale: nextScale
      };
    });
  }, [nodes, setViewport]);

  const scheduleAutoCenterAfterLayout = useCallback(() => {
    pendingAutoCenterRef.current = { baselineSignature: nodePositionSignature };
    if (autoCenterFallbackTimerRef.current) {
      window.clearTimeout(autoCenterFallbackTimerRef.current);
    }
    autoCenterFallbackTimerRef.current = window.setTimeout(() => {
      if (!pendingAutoCenterRef.current) {
        return;
      }
      centerViewportOnNodes();
      pendingAutoCenterRef.current = null;
      autoCenterFallbackTimerRef.current = null;
    }, AUTO_LAYOUT_CENTER_FALLBACK_MS);
  }, [centerViewportOnNodes, nodePositionSignature]);

  const handleAutoLayout = useCallback(() => {
    if (!onAutoLayout) {
      return;
    }

    scheduleAutoCenterAfterLayout();
    onAutoLayout();
  }, [onAutoLayout, scheduleAutoCenterAfterLayout]);

  const { routeAxisMemoryRef, smartRouteByLinkId, setSmartRouteByLinkId, selectionState, setToolMode, toolMode } =
    usePipelineCanvasInteractions({
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
    onAutoLayout: handleAutoLayout,
    readOnly,
    setViewport,
    panState,
    setPanState,
    toCanvasPoint,
    toWorldPoint
  });

  useEffect(() => {
    const pending = pendingAutoCenterRef.current;
    if (!pending) {
      return;
    }

    if (pending.baselineSignature === nodePositionSignature) {
      return;
    }

    centerViewportOnNodes();
    pendingAutoCenterRef.current = null;

    if (autoCenterFallbackTimerRef.current) {
      window.clearTimeout(autoCenterFallbackTimerRef.current);
      autoCenterFallbackTimerRef.current = null;
    }
  }, [centerViewportOnNodes, nodePositionSignature]);

  useEffect(() => {
    if (hasCenteredInitialViewRef.current || nodes.length === 0) {
      return;
    }

    hasCenteredInitialViewRef.current = true;
    centerViewportOnNodes();
  }, [centerViewportOnNodes, nodes.length]);

  useEffect(() => {
    return () => {
      if (autoCenterFallbackTimerRef.current) {
        window.clearTimeout(autoCenterFallbackTimerRef.current);
      }
    };
  }, []);

  const nodeById = useMemo(() => new Map(nodes.map((node) => [node.id, node])), [nodes]);
  const animatedNodeSet = useMemo(() => new Set(animatedNodeIds), [animatedNodeIds]);
  const animatedLinkSet = useMemo(() => new Set(animatedLinkIds), [animatedLinkIds]);
  const animationEnabled = animatedNodeSet.size > 0 || animatedLinkSet.size > 0;

  const glowReadyTimersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
  const smartRouteRequestIdRef = useRef(0);
  const [glowReadySet, setGlowReadySet] = useState<Set<string>>(new Set());

  useEffect(() => {
    setGlowReadySet((prev) => {
      const next = new Set(prev);

      for (const id of animatedNodeIds) {
        next.add(id);
        const timer = glowReadyTimersRef.current.get(id);
        if (timer) {
          clearTimeout(timer);
          glowReadyTimersRef.current.delete(id);
        }
      }

      for (const id of prev) {
        if (!animatedNodeSet.has(id) && !glowReadyTimersRef.current.has(id)) {
          const timer = setTimeout(() => {
            glowReadyTimersRef.current.delete(id);
            setGlowReadySet((current) => {
              const updated = new Set(current);
              updated.delete(id);
              return updated;
            });
          }, 700);
          glowReadyTimersRef.current.set(id, timer);
        }
      }

      return next;
    });
  }, [animatedNodeIds, animatedNodeSet]);

  const orchestratorLaneByLinkId = useMemo(() => {
    return buildOrchestratorLaneByLinkId({
      links,
      nodeById
    });
  }, [links, nodeById]);

  const reciprocalLaneByLinkId = useMemo(() => {
    return buildReciprocalLaneByLinkId({
      links,
      nodeById
    });
  }, [links, nodeById]);

  useEffect(() => {
    if (links.length === 0) {
      smartRouteRequestIdRef.current += 1;
      setSmartRouteByLinkId((current) => (Object.keys(current).length > 0 ? {} : current));
      return;
    }

    if (!selectionState.canUseSmartRoutes) {
      smartRouteRequestIdRef.current += 1;
      return;
    }

    const requestId = smartRouteRequestIdRef.current + 1;
    smartRouteRequestIdRef.current = requestId;
    const timer = window.setTimeout(() => {
      void computeEdgeRoutesSmart(
        nodes.map((node) => ({
          id: node.id,
          position: {
            x: node.position.x,
            y: node.position.y
          },
          role: node.role,
          enableDelegation: node.enableDelegation,
          delegationCount: node.delegationCount
        })),
        links.map((link) => ({
          id: link.id,
          sourceStepId: link.sourceStepId,
          targetStepId: link.targetStepId,
          condition: link.condition
        }))
      ).then((routes) => {
        if (smartRouteRequestIdRef.current !== requestId) {
          return;
        }
        setSmartRouteByLinkId(routes);
      });
    }, 120);

    return () => {
      window.clearTimeout(timer);
    };
  }, [selectionState.canUseSmartRoutes, links, nodes]);

  const renderedLinks: RenderedLink[] = useMemo(
    () =>
      buildRenderedLinks({
        links,
        nodes,
        nodeById,
        previousAxisByLinkId: routeAxisMemoryRef.current,
        manualRoutePoints: selectionState.manualRoutePoints,
        // Keep existing smart routes visible during drag; invalid endpoints are
        // filtered per-link inside buildRenderedLinks and fall back automatically.
        canUseSmartRoutes: true,
        smartRouteByLinkId,
        orchestratorLaneByLinkId,
        reciprocalLaneByLinkId
      }),
    [
      links,
      selectionState.manualRoutePoints,
      nodeById,
      nodes,
      orchestratorLaneByLinkId,
      reciprocalLaneByLinkId,
      smartRouteByLinkId
    ]
  );

  useEffect(() => {
    syncRouteAxisMemory(routeAxisMemoryRef, renderedLinks);
  }, [renderedLinks]);

  useEffect(() => {
    if (!animationEnabled) {
      return;
    }

    let angle = 0;
    let elapsed = 0;
    let lastTimestamp: number | null = null;
    let frame: number;
    const tick = (timestamp: number) => {
      if (lastTimestamp === null) {
        lastTimestamp = timestamp;
      }
      const deltaSeconds = Math.min((timestamp - lastTimestamp) / 1000, 0.05);
      lastTimestamp = timestamp;
      elapsed += deltaSeconds;

      const speed = 54 + 21 * Math.sin(elapsed * 1.7);
      angle = (angle - speed * deltaSeconds + 360) % 360;
      const glowOpacity = 0.5 + 0.5 * Math.sin(elapsed * 2.3);
      const glowNodes = canvasRef.current?.querySelectorAll<HTMLElement>(".node-border-glow");
      if (glowNodes) {
        for (const el of glowNodes) {
          el.style.setProperty("--border-angle", `${angle}deg`);
          el.style.setProperty("--glow-opacity", glowOpacity.toFixed(3));
        }
      }

      const sweepDur = 2.5;
      const pauseDur = 0.7;
      const totalCycle = sweepDur + pauseDur;
      const shimmerPhase = elapsed % totalCycle;
      const shimmerRawT = Math.min(shimmerPhase / sweepDur, 1.0);
      const shimmerT = shimmerRawT < 0.5
        ? 2 * shimmerRawT * shimmerRawT
        : 1 - Math.pow(-2 * shimmerRawT + 2, 2) / 2;

      const shimmerPaths = canvasRef.current?.querySelectorAll<SVGPathElement>(".link-shimmer-path");
      if (shimmerPaths) {
        const margin = 0.28;
        const center = -margin + shimmerT * (1 + 2 * margin);
        for (const p of shimmerPaths) {
          const d = Number(p.dataset.dashLen ?? "0.3");
          const offset = d / 2 - center;
          p.style.strokeDashoffset = offset.toFixed(4);
        }
      }

      const shimmerGroups = canvasRef.current?.querySelectorAll<SVGGElement>(".link-shimmer-group");
      if (shimmerGroups) {
        const fadeZone = 0.12;
        const fadeIn = Math.min(shimmerRawT / fadeZone, 1);
        const fadeOut = Math.min((1 - shimmerRawT) / fadeZone, 1);
        const opacity = shimmerRawT >= 1 ? 0 : Math.min(fadeIn, fadeOut);
        const val = opacity.toFixed(3);
        for (const g of shimmerGroups) {
          g.setAttribute("opacity", val);
        }
      }

      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame((timestamp) => tick(timestamp));
    return () => cancelAnimationFrame(frame);
  }, [animationEnabled]);

  return (
    <PipelineCanvasContent
      className={className}
      showToolbar={showToolbar}
      onAddNode={onAddNode}
      canvasRef={canvasRef}
      canvasHeight={canvasHeight}
      viewportState={{ viewport, toCanvasPoint, toWorldPoint, panState, setPanState, setViewport }}
      selectionState={selectionState}
      nodes={nodes}
      links={links}
      nodeById={nodeById}
      renderedLinks={renderedLinks}
      selectedNodeId={selectedNodeId}
      selectedNodeIds={selectedNodeIds}
      selectedLinkId={selectedLinkId}
      readOnly={readOnly}
      onSelectionChange={onSelectionChange}
      onConnectNodes={onConnectNodes}
      onDeleteNodes={onDeleteNodes}
      animatedNodeSet={animatedNodeSet}
      animatedLinkSet={animatedLinkSet}
      glowReadySet={glowReadySet}
      runStatus={runStatus}
      toolMode={toolMode}
      marqueeFrame={selectionState.marqueeFrame}
    >
      <PipelineCanvasOverlays
        toolMode={toolMode}
        onToolModeChange={setToolMode}
        onAutoLayout={selectionState.triggerAutoLayout}
        viewportScale={viewport.scale}
        selectedNodeIds={selectedNodeIds}
        selectedLinkId={selectedLinkId}
        canDeleteSelection={selectionState.canDeleteSelection}
        hasDeleteAction={Boolean(onDeleteNodes || onDeleteLink)}
        onDeleteSelection={selectionState.handleDeleteSelection}
        onClearSelection={selectionState.clearSelection}
      />
    </PipelineCanvasContent>
  );
}
