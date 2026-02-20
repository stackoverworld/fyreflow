import { type ReactNode, createContext, useContext, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { cn } from "@/lib/cn";

const ToolbarIdContext = createContext<string>("ftb");

interface FloatingToolbarProps {
  children: ReactNode;
  className?: string;
}

let toolbarCounter = 0;

export function FloatingToolbar({ children, className }: FloatingToolbarProps) {
  const [id] = useState(() => `ftb-${++toolbarCounter}`);
  return (
    <ToolbarIdContext.Provider value={id}>
      <div className={cn("absolute bottom-4 left-1/2 z-20 -translate-x-1/2", className)}>
        <motion.div
          layout
          transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
          className="glass-panel-dense flex items-center gap-1 rounded-full border border-ink-700/50 px-1.5 py-1 shadow-panel"
        >
          {children}
        </motion.div>
      </div>
    </ToolbarIdContext.Provider>
  );
}

interface FloatingToolbarButtonProps {
  active?: boolean;
  danger?: boolean;
  disabled?: boolean;
  shortcut?: string;
  onClick?: () => void;
  children: ReactNode;
  className?: string;
}

export function FloatingToolbarButton({
  active,
  danger,
  disabled,
  shortcut,
  onClick,
  children,
  className,
}: FloatingToolbarButtonProps) {
  const toolbarId = useContext(ToolbarIdContext);
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "relative flex items-center gap-1.5 rounded-full px-2.5 py-1.5 text-xs font-medium transition-colors duration-150 cursor-pointer",
        danger
          ? "text-red-400 hover:bg-red-500/10 disabled:opacity-40 disabled:cursor-not-allowed"
          : active
            ? "text-ink-50"
            : "text-ink-400 hover:text-ink-200",
        className
      )}
    >
      <AnimatePresence>
        {active && !danger && (
          <motion.span
            layoutId={`${toolbarId}-active-pill`}
            className="absolute inset-0 rounded-full bg-ink-700/70"
            transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
          />
        )}
      </AnimatePresence>
      <span className="relative z-10 flex items-center gap-1.5">
        {children}
        {shortcut && <Kbd>{shortcut}</Kbd>}
      </span>
    </button>
  );
}

export function FloatingToolbarDivider() {
  return <div className="mx-0.5 h-4 w-px bg-ink-700/60" />;
}

interface FloatingToolbarTextProps {
  children: ReactNode;
  muted?: boolean;
  className?: string;
}

export function FloatingToolbarText({ children, muted, className }: FloatingToolbarTextProps) {
  return (
    <span
      className={cn(
        "px-1.5 text-[11px]",
        muted ? "text-ink-500" : "text-ink-400",
        className
      )}
    >
      {children}
    </span>
  );
}

interface KbdProps {
  children: ReactNode;
  className?: string;
}

export function Kbd({ children, className }: KbdProps) {
  return (
    <kbd
      className={cn(
        "ml-1 inline-flex h-4 min-w-4 items-center justify-center rounded border border-ink-600/40 bg-ink-950/70 px-1 text-[10px] font-medium leading-none text-ink-400",
        className
      )}
    >
      {children}
    </kbd>
  );
}
