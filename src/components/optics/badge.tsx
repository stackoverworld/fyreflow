import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/cn";

const badgeVariants = cva("inline-flex select-none items-center gap-1 rounded-full px-2 py-0.5 text-[0.625rem] font-medium border border-transparent", {
  variants: {
    variant: {
      neutral: "bg-[var(--badge-neutral-bg)] text-ink-300",
      success: "bg-emerald-500/10 text-emerald-400 border-emerald-500/20",
      running: "bg-ember-500/10 text-ember-300 border-ember-500/25",
      warning: "bg-amber-500/10 text-amber-400 border-amber-500/20",
      danger: "bg-red-500/10 text-red-400 border-red-500/20"
    }
  },
  defaultVariants: {
    variant: "neutral"
  }
});

export interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement>, VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, ...props }: BadgeProps) {
  return <span className={cn(badgeVariants({ variant, className }))} {...props} />;
}

export { Badge };
