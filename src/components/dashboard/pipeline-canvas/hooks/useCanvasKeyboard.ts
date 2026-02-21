import { useEffect } from "react";

export interface UseCanvasKeyboardOptions {
  readOnly: boolean;
  selectedLinkId: string | null;
  onAutoLayout?: () => void;
  setToolMode: (toolMode: "select" | "pan") => void;
  triggerAutoLayout: () => void;
  undoManualRoutePlacement: () => boolean;
  redoManualRoutePlacement: () => boolean;
}

export function useCanvasKeyboard({
  readOnly,
  selectedLinkId,
  onAutoLayout,
  setToolMode,
  triggerAutoLayout,
  undoManualRoutePlacement,
  redoManualRoutePlacement
}: UseCanvasKeyboardOptions): void {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        target instanceof HTMLSelectElement ||
        target?.isContentEditable === true
      ) {
        return;
      }

      const isUndoShortcut = (event.metaKey || event.ctrlKey) && !event.altKey && event.key.toLowerCase() === "z";
      if (readOnly && isUndoShortcut) {
        return;
      }

      if (isUndoShortcut && selectedLinkId) {
        const handled = event.shiftKey ? redoManualRoutePlacement() : undoManualRoutePlacement();
        if (handled) {
          event.preventDefault();
          event.stopPropagation();
          event.stopImmediatePropagation();
          return;
        }
      }

      if (event.key === "v" || event.key === "V") {
        setToolMode("select");
      } else if (event.key === "h" || event.key === "H") {
        setToolMode("pan");
      } else if ((event.key === "l" || event.key === "L") && onAutoLayout && !readOnly) {
        event.preventDefault();
        triggerAutoLayout();
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [
    onAutoLayout,
    readOnly,
    redoManualRoutePlacement,
    selectedLinkId,
    setToolMode,
    triggerAutoLayout,
    undoManualRoutePlacement
  ]);
}
