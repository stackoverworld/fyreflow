import { Hand, MousePointer2, Trash2, Unlink } from "lucide-react";
import {
  FloatingToolbar,
  FloatingToolbarButton,
  FloatingToolbarDivider,
  FloatingToolbarText
} from "@/components/optics/floating-toolbar";
import type { OverlayLayerProps } from "./types";

export function OverlayLayer({
  toolMode,
  onToolModeChange,
  onAutoLayout,
  viewportScale,
  selectedNodeIds,
  selectedLinkId,
  canDeleteSelection,
  hasDeleteAction,
  onDeleteSelection,
  onClearSelection
}: OverlayLayerProps) {
  return (
    <FloatingToolbar>
      <FloatingToolbarButton active={toolMode === "select"} onClick={() => onToolModeChange("select")} shortcut="V">
        <MousePointer2 className="h-3.5 w-3.5" /> Select
      </FloatingToolbarButton>

      <FloatingToolbarButton active={toolMode === "pan"} onClick={() => onToolModeChange("pan")} shortcut="H">
        <Hand className="h-3.5 w-3.5" /> Pan
      </FloatingToolbarButton>

      <FloatingToolbarDivider />

      {onAutoLayout ? (
        <>
          <FloatingToolbarButton onClick={onAutoLayout} shortcut="L">
            Auto layout
          </FloatingToolbarButton>
          <FloatingToolbarDivider />
        </>
      ) : null}

      <FloatingToolbarText muted className="px-2 tabular-nums">
        {Math.round(viewportScale * 100)}%
      </FloatingToolbarText>

      {(selectedNodeIds.length > 0 || selectedLinkId) && (
        <>
          <FloatingToolbarDivider />

          <FloatingToolbarText>
            {selectedLinkId ? "1 link" : `${selectedNodeIds.length} node${selectedNodeIds.length > 1 ? "s" : ""}`}
          </FloatingToolbarText>

          <FloatingToolbarButton
            danger
            disabled={!canDeleteSelection || !hasDeleteAction}
            onClick={onDeleteSelection}
          >
            {selectedLinkId ? <Unlink className="h-3 w-3" /> : <Trash2 className="h-3 w-3" />}
          </FloatingToolbarButton>

          <FloatingToolbarButton onClick={onClearSelection}>
            Clear
          </FloatingToolbarButton>
        </>
      )}
    </FloatingToolbar>
  );
}

