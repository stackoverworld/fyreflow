import { type ReactNode, createContext, useContext, useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { cn } from "@/lib/cn";

const CloseContext = createContext<() => void>(() => {});

interface DropdownMenuProps {
  trigger: ReactNode;
  children: ReactNode;
  align?: "left" | "right";
  className?: string;
}

export function DropdownMenu({ trigger, children, align = "right", className }: DropdownMenuProps) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;

    const handleClickOutside = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    };

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("keydown", handleEscape);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleEscape);
    };
  }, [open]);

  const close = () => setOpen(false);

  return (
    <CloseContext.Provider value={close}>
      <div ref={containerRef} className={cn("relative", className)}>
        <div onClick={() => setOpen((prev) => !prev)}>{trigger}</div>

        <AnimatePresence>
          {open && (
            <motion.div
              initial={{ opacity: 0, y: -4, scale: 0.96 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -4, scale: 0.96 }}
              transition={{ duration: 0.15, ease: [0.16, 1, 0.3, 1] }}
              className={cn(
                "absolute top-full z-50 mt-1.5 min-w-[200px] rounded-xl border border-ink-700/50 bg-[var(--surface-overlay)] p-1 shadow-xl",
                align === "right" ? "right-0" : "left-0"
              )}
            >
              {children}
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </CloseContext.Provider>
  );
}

interface DropdownMenuItemProps {
  icon?: ReactNode;
  label: string;
  description?: string;
  danger?: boolean;
  disabled?: boolean;
  onClick: (e: React.MouseEvent) => void;
}

export function DropdownMenuItem({ icon, label, description, danger, disabled, onClick }: DropdownMenuItemProps) {
  const close = useContext(CloseContext);

  return (
    <button
      type="button"
      disabled={disabled}
      onClick={(e) => {
        onClick(e);
        close();
      }}
      className={cn(
        "flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left transition-colors cursor-pointer",
        danger
          ? "text-red-400 hover:bg-red-500/10"
          : "text-ink-200 hover:bg-ink-800/60",
        disabled && "cursor-not-allowed opacity-40"
      )}
    >
      {icon ? <span className="shrink-0 text-ink-500">{icon}</span> : null}
      <div className="min-w-0 flex-1">
        <p className="text-xs font-medium">{label}</p>
        {description ? <p className="mt-0.5 text-[11px] text-ink-500">{description}</p> : null}
      </div>
    </button>
  );
}

export function DropdownMenuDivider() {
  return <div className="my-1 h-px bg-ink-700/50" />;
}
