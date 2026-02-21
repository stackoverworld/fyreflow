import { ChevronDown } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

interface CollapsibleSectionProps {
  icon: ReactNode;
  label: string;
  collapsed: boolean;
  onToggle: () => void;
  children: ReactNode;
  badge?: ReactNode;
}

export function CollapsibleSection({
  icon, label, collapsed, onToggle, children, badge
}: CollapsibleSectionProps) {
  return (
    <div className="border-b border-[var(--divider)]">
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-center gap-2.5 px-4 py-2.5 text-left transition-colors hover:bg-[var(--surface-raised)] cursor-pointer"
      >
        <span className="text-ink-400">{icon}</span>
        <span className="flex-1 text-[12px] font-semibold uppercase tracking-wider text-ink-300">
          {label}
        </span>
        {badge}
        <ChevronDown
          className={cn(
            "h-3.5 w-3.5 text-ink-500 transition-transform duration-200",
            !collapsed && "rotate-180"
          )}
        />
      </button>
      <AnimatePresence initial={false}>
        {!collapsed && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
            className="overflow-hidden"
          >
            <div className="px-4 pb-4 pt-1">
              {children}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
