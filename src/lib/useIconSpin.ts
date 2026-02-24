import { useCallback, useState } from "react";

/**
 * Smooth single-rotation spin for refresh icons.
 * Each `triggerSpin()` call adds 360° — the CSS transition handles the rest.
 *
 * Usage:
 * ```tsx
 * const { rotation, triggerSpin } = useIconSpin();
 * <RefreshCw
 *   className="h-3.5 w-3.5"
 *   style={{ transform: `rotate(${rotation}deg)`, transition: "transform 0.45s ease-in-out" }}
 * />
 * ```
 */
export function useIconSpin() {
  const [rotation, setRotation] = useState(0);
  const triggerSpin = useCallback(() => setRotation((r) => r + 360), []);
  return { rotation, triggerSpin } as const;
}
