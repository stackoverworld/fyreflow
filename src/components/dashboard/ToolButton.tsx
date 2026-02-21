import { type ReactNode } from "react";
import { Tooltip } from "@/components/optics/tooltip";
import { cn } from "@/lib/cn";

export interface ToolButtonProps {
  active?: boolean;
  disabled?: boolean;
  label: string;
  variant?: "default" | "accent";
  onClick: () => void;
  children: ReactNode;
}

export function ToolButton({ active, disabled, label, variant = "default", onClick, children }: ToolButtonProps) {
  return (
    <Tooltip content={label} side="right">
      <button
        type="button"
        onClick={onClick}
        disabled={disabled}
        className={cn(
          "flex h-10 w-10 select-none items-center justify-center rounded-xl transition-colors focus:outline-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ember-500/40",
          disabled
            ? "text-ink-700 cursor-not-allowed"
            : variant === "accent"
              ? active
                ? "bg-gradient-to-b from-ember-500/25 to-ember-600/20 text-[var(--accent-active-fg)] shadow-[inset_0_1px_0_0_rgba(217,119,87,0.15)] cursor-pointer"
                : "text-ember-400 hover:bg-ember-500/10 hover:text-[var(--accent-active-fg-strong)] cursor-pointer"
              : active
                ? "bg-ember-500/15 text-[var(--accent-active-fg-strong)] cursor-pointer"
                : "text-ink-500 hover:bg-ink-700/40 hover:text-ink-200 cursor-pointer"
        )}
        aria-label={label}
      >
        {children}
      </button>
    </Tooltip>
  );
}
