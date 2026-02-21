import type { ReactNode } from "react";
import { AnimatePresence, motion } from "motion/react";
import { X } from "lucide-react";

import { SlidePanel } from "@/components/optics/slide-panel";

export interface LeftPanelRouteWrapperProps {
  open: boolean;
  title: string;
  compact?: boolean;
  onClose: () => void;
  children: ReactNode;
}

export function LeftPanelRouteWrapper({
  open,
  title,
  compact = false,
  onClose,
  children
}: LeftPanelRouteWrapperProps) {
  return (
    <SlidePanel
      open={open}
      side="left"
      className="top-[38px] h-[calc(100%-38px)] w-full max-w-[390px]"
    >
      <button
        type="button"
        onClick={() => onClose()}
        className="flex h-12 w-full select-none items-center justify-between border-b border-ink-800 px-3 text-left cursor-pointer"
      >
        <p className="text-xs font-semibold uppercase tracking-wide text-ink-300">{title}</p>
        <X className="h-4 w-4 text-ink-500" />
      </button>

      <div className={compact ? "h-[calc(100%-48px)]" : "h-[calc(100%-48px)] overflow-y-auto p-3"}>{children}</div>
    </SlidePanel>
  );
}

export interface RightPanelRouteWrapperProps {
  open: boolean;
  onClose: () => void;
  children: ReactNode;
}

export function RightPanelRouteWrapper({
  open,
  onClose,
  children
}: RightPanelRouteWrapperProps) {
  return (
    <SlidePanel
      open={open}
      side="right"
      className="top-[38px] h-[calc(100%-38px)] w-full max-w-[390px]"
    >
      <div className="flex h-12 select-none items-center justify-between border-b border-ink-800 px-3">
        <p className="text-xs font-semibold uppercase tracking-wide text-ink-300">Run</p>
        <button
          type="button"
          onClick={() => onClose()}
          className="rounded-md p-1.5 text-ink-500 hover:bg-ink-800 hover:text-ink-100 cursor-pointer"
          aria-label="Close panel"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="h-[calc(100%-48px)] overflow-y-auto p-3">{children}</div>
    </SlidePanel>
  );
}

export interface ShellNoticeBannerProps {
  notice: string | null;
}

export function ShellNoticeBanner({ notice }: ShellNoticeBannerProps) {
  return (
    <AnimatePresence>
      {notice ? (
        <motion.div
          key={notice}
          initial={{ opacity: 0, y: 8, scale: 0.96 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 4, scale: 0.98 }}
          transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
          className="glass-panel-dense pointer-events-none fixed bottom-5 right-4 z-[100] rounded-xl border border-ink-700/40 px-4 py-2 text-xs text-ink-200 shadow-lg"
        >
          {notice}
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}
