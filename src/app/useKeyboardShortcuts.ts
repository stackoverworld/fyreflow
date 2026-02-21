import { useCallback, useEffect } from "react";

export interface KeyboardShortcutOptions {
  canUndo: boolean;
  canRedo: boolean;
  undoDraftChange: () => void;
  redoDraftChange: () => void;
  disabled: boolean;
}

export function useKeyboardShortcuts({
  canUndo,
  canRedo,
  undoDraftChange,
  redoDraftChange,
  disabled
}: KeyboardShortcutOptions): void {
  const onKeyDown = useCallback(
    (event: KeyboardEvent) => {
      if (disabled) {
        return;
      }

      const target = event.target as HTMLElement | null;
      const isTypingField =
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        target instanceof HTMLSelectElement ||
        target?.isContentEditable === true;

      if (isTypingField) {
        return;
      }

      if (!(event.metaKey || event.ctrlKey) || event.altKey) {
        return;
      }

      if (event.key.toLowerCase() !== "z") {
        return;
      }

      if (event.shiftKey) {
        if (!canRedo) {
          return;
        }

        event.preventDefault();
        redoDraftChange();
        return;
      }

      if (!canUndo) {
        return;
      }

      event.preventDefault();
      undoDraftChange();
    },
    [canRedo, canUndo, disabled, redoDraftChange, undoDraftChange]
  );

  useEffect(() => {
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onKeyDown]);
}
