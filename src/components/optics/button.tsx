import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/cn";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-1.5 rounded-xl text-sm font-medium transition-all duration-150 active:scale-[0.97] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ember-500/30 disabled:pointer-events-none disabled:opacity-50 select-none cursor-pointer",
  {
    variants: {
      variant: {
        primary: "bg-ink-50 text-ink-950 shadow-sm hover:bg-ink-200 border border-transparent",
        secondary: "bg-[var(--btn-secondary-bg)] text-ink-100 border border-[var(--btn-secondary-border)] shadow-sm hover:bg-[var(--btn-secondary-bg-hover)]",
        ghost: "text-ink-400 hover:bg-ink-800 hover:text-ink-50",
        danger: "bg-red-500/10 text-red-400 hover:bg-red-500/20 border border-red-500/20"
      },
      size: {
        md: "h-9 px-4",
        sm: "h-8 px-3 text-xs",
        lg: "h-10 px-5"
      }
    },
    defaultVariants: {
      variant: "primary",
      size: "md"
    }
  }
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(({ className, variant, size, ...props }, ref) => (
  <button ref={ref} className={cn(buttonVariants({ variant, size, className }))} {...props} />
));

Button.displayName = "Button";

export { Button, buttonVariants };
