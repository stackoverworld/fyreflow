import { type ReactNode, useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "motion/react";
import { cn } from "@/lib/cn";

type Side = "top" | "right" | "bottom" | "left";

interface TooltipProps {
  content: string;
  side?: Side;
  children: ReactNode;
  className?: string;
}

interface Coords {
  top: number;
  left: number;
}

const OFFSET = 8;

function computePosition(trigger: HTMLElement, tip: HTMLElement, side: Side): Coords {
  const r = trigger.getBoundingClientRect();
  const t = tip.getBoundingClientRect();

  switch (side) {
    case "right":
      return { top: r.top + r.height / 2 - t.height / 2, left: r.right + OFFSET };
    case "left":
      return { top: r.top + r.height / 2 - t.height / 2, left: r.left - t.width - OFFSET };
    case "top":
      return { top: r.top - t.height - OFFSET, left: r.left + r.width / 2 - t.width / 2 };
    case "bottom":
      return { top: r.bottom + OFFSET, left: r.left + r.width / 2 - t.width / 2 };
  }
}

const arrowStyles: Record<Side, string> = {
  top: "top-full left-1/2 -translate-x-1/2 border-t-[var(--tooltip-bg)] border-x-transparent border-b-transparent border-[4px]",
  bottom: "bottom-full left-1/2 -translate-x-1/2 border-b-[var(--tooltip-bg)] border-x-transparent border-t-transparent border-[4px]",
  left: "left-full top-1/2 -translate-y-1/2 border-l-[var(--tooltip-bg)] border-y-transparent border-r-transparent border-[4px]",
  right: "right-full top-1/2 -translate-y-1/2 border-r-[var(--tooltip-bg)] border-y-transparent border-l-transparent border-[4px]"
};

const originBySide: Record<Side, { x: number; y: number }> = {
  top: { x: 0, y: 4 },
  bottom: { x: 0, y: -4 },
  left: { x: 4, y: 0 },
  right: { x: -4, y: 0 },
};

export function Tooltip({ content, side = "right", children, className }: TooltipProps) {
  const [visible, setVisible] = useState(false);
  const [coords, setCoords] = useState<Coords>({ top: 0, left: 0 });
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
      setCoords(computePosition(triggerRef.current, tipRef.current, side));
    }
  }, [side]);

  useEffect(() => {
    if (visible) {
      requestAnimationFrame(updatePosition);
    }
  }, [visible, updatePosition]);

  const offset = originBySide[side];

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
              className="pointer-events-none fixed z-[9999] select-none whitespace-nowrap rounded-md bg-[var(--tooltip-bg)] px-2.5 py-1.5 text-xs font-medium text-[var(--tooltip-fg)] shadow-lg"
              style={{ top: coords.top, left: coords.left }}
              role="tooltip"
            >
              {content}
              <span className={cn("absolute", arrowStyles[side])} />
            </motion.div>
          )}
        </AnimatePresence>,
        document.body
      )}
    </>
  );
}
