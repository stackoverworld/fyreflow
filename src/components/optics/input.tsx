import * as React from "react";
import { cn } from "@/lib/cn";

const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
  ({ className, ...props }, ref) => (
    <input
      ref={ref}
      className={cn(
        "h-9 w-full rounded-xl border border-ink-800 bg-ink-950/60 px-3 text-sm text-ink-50",
        "placeholder:text-ink-500 focus:border-ember-500/60 focus:outline-none focus:ring-2 focus:ring-ember-500/20",
        "transition-colors",
        className
      )}
      {...props}
    />
  )
);

Input.displayName = "Input";

export { Input };
