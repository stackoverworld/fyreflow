import { useRef, type ReactNode } from "react";
import { AnimatePresence, motion } from "motion/react";
import { cn } from "@/lib/cn";

type Side = "left" | "right";

interface SlidePanelProps {
  open: boolean;
  side: Side;
  children: ReactNode;
  className?: string;
}

const transition = {
  duration: 0.2,
  ease: [0.16, 1, 0.3, 1] as const,
};

export function SlidePanel({ open, side, children, className }: SlidePanelProps) {
  const isLeft = side === "left";
  const frozenRef = useRef<ReactNode>(children);

  if (open) {
    frozenRef.current = children;
  }

  const offX = isLeft ? -40 : 40;

  return (
    <AnimatePresence mode="wait">
      {open ? (
        <motion.aside
          key="slide-panel"
          initial={{ x: offX, opacity: 0 }}
          animate={{ x: 0, opacity: 1 }}
          exit={{ x: offX, opacity: 0 }}
          transition={transition}
          className={cn(
            "glass-panel-dense absolute top-0 z-40 h-full overflow-hidden",
            isLeft ? "left-[56px] border-r border-[var(--panel-border)]" : "right-0 border-l border-[var(--panel-border)]",
            className
          )}
        >
          {frozenRef.current}
        </motion.aside>
      ) : null}
    </AnimatePresence>
  );
}
