import { type ReactNode, useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "motion/react";
import { cn } from "@/lib/cn";
import {
  computeTooltipArrowLeft,
  type TooltipCoords,
  type TooltipHorizontalBounds,
  type TooltipSide,
  clampTooltipHorizontal,
  computeTooltipPosition
} from "./tooltip-positioning";

interface TooltipProps {
  content: string;
  side?: TooltipSide;
  children: ReactNode;
  className?: string;
}

const HORIZONTAL_EDGE_GUTTER = 8;

const arrowStyles: Record<TooltipSide, string> = {
  top: "top-full -translate-x-1/2 border-t-[var(--tooltip-bg)] border-x-transparent border-b-transparent border-[4px]",
  bottom: "bottom-full -translate-x-1/2 border-b-[var(--tooltip-bg)] border-x-transparent border-t-transparent border-[4px]",
  left: "left-full top-1/2 -translate-y-1/2 border-l-[var(--tooltip-bg)] border-y-transparent border-r-transparent border-[4px]",
  right: "right-full top-1/2 -translate-y-1/2 border-r-[var(--tooltip-bg)] border-y-transparent border-l-transparent border-[4px]"
};

const originBySide: Record<TooltipSide, { x: number; y: number }> = {
  top: { x: 0, y: 4 },
  bottom: { x: 0, y: -4 },
  left: { x: 4, y: 0 },
  right: { x: -4, y: 0 },
};

function resolveHorizontalBounds(): TooltipHorizontalBounds {
  const viewportBounds = { left: 0, right: window.innerWidth };
  const root = document.getElementById("root");

  if (!root) {
    return viewportBounds;
  }

  const rootRect = root.getBoundingClientRect();
  if (rootRect.width <= 0) {
    return viewportBounds;
  }

  return { left: rootRect.left, right: rootRect.right };
}

export function Tooltip({ content, side = "right", children, className }: TooltipProps) {
  const [visible, setVisible] = useState(false);
  const [coords, setCoords] = useState<TooltipCoords>({ top: 0, left: 0 });
  const [arrowLeft, setArrowLeft] = useState<number | null>(null);
  const triggerRef = useRef<HTMLDivElement>(null);
  const tipRef = useRef<HTMLDivElement>(null);
  const timeout = useRef<ReturnType<typeof setTimeout>>();

  const show = () => {
    clearTimeout(timeout.current);
    timeout.current = setTimeout(() => setVisible(true), 400);
  };

  const hide = () => {
    clearTimeout(timeout.current);
    setVisible(false);
  };

  const updatePosition = useCallback(() => {
    if (triggerRef.current && tipRef.current) {
      const triggerRect = triggerRef.current.getBoundingClientRect();
      const tipRect = tipRef.current.getBoundingClientRect();
      const rawPosition = computeTooltipPosition(triggerRect, tipRect, side);
      const bounds = resolveHorizontalBounds();
      const clampedPosition = clampTooltipHorizontal(rawPosition, tipRect.width, bounds, HORIZONTAL_EDGE_GUTTER);
      setCoords(clampedPosition);
      if (side === "top" || side === "bottom") {
        setArrowLeft(computeTooltipArrowLeft(triggerRect, clampedPosition.left, tipRect.width));
      } else {
        setArrowLeft(null);
      }
    }
  }, [side]);

  useEffect(() => {
    if (!visible) {
      return;
    }

    requestAnimationFrame(updatePosition);

    const handleReposition = () => updatePosition();
    window.addEventListener("resize", handleReposition);
    window.addEventListener("scroll", handleReposition, true);

    return () => {
      window.removeEventListener("resize", handleReposition);
      window.removeEventListener("scroll", handleReposition, true);
    };
  }, [visible, updatePosition]);

  const offset = originBySide[side];
  const arrowStyle =
    side === "top" || side === "bottom"
      ? {
          left: arrowLeft ?? "50%",
        }
      : undefined;

  return (
    <>
      <div
        ref={triggerRef}
        className={cn("inline-flex", className)}
        onMouseEnter={show}
        onMouseLeave={hide}
        onFocus={show}
        onBlur={hide}
      >
        {children}
      </div>

      {createPortal(
        <AnimatePresence>
          {visible && (
            <motion.div
              ref={tipRef}
              initial={{ opacity: 0, x: offset.x, y: offset.y }}
              animate={{ opacity: 1, x: 0, y: 0 }}
              exit={{ opacity: 0, x: offset.x, y: offset.y }}
              transition={{ duration: 0.15, ease: "easeOut" }}
              className="pointer-events-none fixed z-[9999] max-w-[min(26rem,calc(100vw-16px))] select-none whitespace-normal break-words rounded-md bg-[var(--tooltip-bg)] px-2.5 py-1.5 text-xs font-medium text-[var(--tooltip-fg)] shadow-lg"
              style={{ top: coords.top, left: coords.left }}
              role="tooltip"
            >
              {content}
              <span className={cn("absolute", arrowStyles[side])} style={arrowStyle} />
            </motion.div>
          )}
        </AnimatePresence>,
        document.body
      )}
    </>
  );
}
