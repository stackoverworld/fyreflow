import * as React from "react";
import { cn } from "@/lib/cn";

const Textarea = React.forwardRef<HTMLTextAreaElement, React.TextareaHTMLAttributes<HTMLTextAreaElement>>(
  ({ className, ...props }, ref) => (
    <textarea
      ref={ref}
      className={cn(
        "min-h-[110px] w-full rounded-xl border border-ink-800 bg-ink-950/60 px-3 py-2 text-sm text-ink-50",
        "placeholder:text-ink-500 focus:border-ember-500/60 focus:outline-none focus:ring-2 focus:ring-ember-500/20",
        "transition-colors",
        className
      )}
      {...props}
    />
  )
);

Textarea.displayName = "Textarea";

export { Textarea };
