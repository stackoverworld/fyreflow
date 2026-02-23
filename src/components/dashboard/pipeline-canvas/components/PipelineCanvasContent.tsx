import { PlusCircle } from "lucide-react";
import type { ReactNode, RefObject } from "react";
import { Button } from "@/components/optics/button";
import { cn } from "@/lib/cn";
import type { FlowLink, FlowNode, PipelineCanvasSelection, RenderedLink, CanvasToolMode } from "../types";
import type { UseCanvasSelectionResult } from "../hooks/useCanvasSelection";
import type { UseCanvasViewportResult } from "../hooks/useCanvasViewport";
import { CanvasLayers } from "../render/CanvasLayers";

interface MarqueeFrame {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

interface PipelineCanvasContentProps {
  className?: string;
  showToolbar: boolean;
  onAddNode: () => void;
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
  runStatus?: "running" | "paused" | "queued" | "awaiting_approval" | null;
  toolMode: CanvasToolMode;
  marqueeFrame: MarqueeFrame | null;
  children?: ReactNode;
}

export function PipelineCanvasContent({
  className,
  showToolbar,
  onAddNode,
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
  runStatus,
  toolMode,
  marqueeFrame,
  children
}: PipelineCanvasContentProps) {
  return (
    <div className={cn("space-y-3", className)}>
      {showToolbar ? (
        <div className="flex items-center justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-ink-400">Flow Canvas</p>
            <p className="text-xs text-ink-500">
              Select mode: drag to multi-select. Pan mode/Alt-drag to move viewport. Wheel to zoom.
            </p>
          </div>
          <Button size="sm" variant="secondary" onClick={onAddNode}>
            <PlusCircle className="mr-1 h-4 w-4" /> Add step
          </Button>
        </div>
      ) : null}

      <CanvasLayers
        canvasRef={canvasRef}
        canvasHeight={canvasHeight}
        viewportState={viewportState}
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
        marqueeFrame={marqueeFrame}
      >
        {children}
      </CanvasLayers>
    </div>
  );
}
