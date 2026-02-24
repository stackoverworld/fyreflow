import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "motion/react";
import { ChevronDown, Check } from "lucide-react";
import { cn } from "@/lib/cn";
import { SELECT_DROPDOWN_CONTENT_CLASS } from "@/components/optics/overlay-classes";

export interface SelectOption {
  value: string;
  label: string;
}

interface SelectProps {
  value: string;
  onValueChange: (value: string) => void;
  options: SelectOption[];
  placeholder?: string;
  className?: string;
  disabled?: boolean;
}

export function Select({ value, onValueChange, options, placeholder, className, disabled }: SelectProps) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const [dropdownStyle, setDropdownStyle] = useState<React.CSSProperties>({});

  const selected = options.find((o) => o.value === value);

  useEffect(() => {
    if (disabled && open) {
      setOpen(false);
    }
  }, [disabled, open]);

  const [openAbove, setOpenAbove] = useState(false);

  // Position the dropdown relative to the trigger using fixed positioning
  useLayoutEffect(() => {
    if (!open || !triggerRef.current) return;

    const updatePosition = () => {
      const rect = triggerRef.current?.getBoundingClientRect();
      if (!rect) return;

      const listHeight = listRef.current?.offsetHeight ?? 224;
      const gap = 6;
      const spaceBelow = window.innerHeight - rect.bottom - gap;
      const spaceAbove = rect.top - gap;
      const shouldOpenAbove = spaceBelow < listHeight && spaceAbove > spaceBelow;

      setOpenAbove(shouldOpenAbove);

      if (shouldOpenAbove) {
        setDropdownStyle({
          position: "fixed",
          bottom: window.innerHeight - rect.top + gap,
          left: rect.left,
          width: rect.width,
          zIndex: 9999
        });
      } else {
        setDropdownStyle({
          position: "fixed",
          top: rect.bottom + gap,
          left: rect.left,
          width: rect.width,
          zIndex: 9999
        });
      }
    };

    updatePosition();
    // Recalculate after the dropdown renders and we know its height
    requestAnimationFrame(updatePosition);

    // Reposition on scroll/resize so it follows the trigger
    window.addEventListener("scroll", updatePosition, true);
    window.addEventListener("resize", updatePosition);
    return () => {
      window.removeEventListener("scroll", updatePosition, true);
      window.removeEventListener("resize", updatePosition);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
      }
    };

    const onClickOutside = (event: MouseEvent) => {
      const target = event.target as Node;
      if (
        containerRef.current && !containerRef.current.contains(target) &&
        listRef.current && !listRef.current.contains(target)
      ) {
        setOpen(false);
      }
    };

    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("mousedown", onClickOutside);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("mousedown", onClickOutside);
    };
  }, [open]);

  useEffect(() => {
    if (open && listRef.current) {
      const active = listRef.current.querySelector("[data-active]");
      if (active) {
        active.scrollIntoView({ block: "nearest" });
      }
    }
  }, [open]);

  const dropdownContent = (
    <AnimatePresence>
      {open && !disabled && (
        <motion.div
          ref={listRef}
          initial={{ opacity: 0, scale: 0.95, y: openAbove ? 4 : -4 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.95, y: openAbove ? 4 : -4 }}
          transition={{ duration: 0.15, ease: [0.16, 1, 0.3, 1] }}
          style={dropdownStyle}
          className={cn(
            SELECT_DROPDOWN_CONTENT_CLASS,
            openAbove ? "origin-bottom" : "origin-top"
          )}
        >
          <div className="space-y-0.5">
            {options.map((option) => {
              const isActive = option.value === value;
              return (
                <button
                  key={option.value}
                  type="button"
                  data-active={isActive || undefined}
                  onClick={() => {
                    onValueChange(option.value);
                    setOpen(false);
                  }}
                  className={cn(
                    "flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-sm transition-colors cursor-pointer",
                    isActive
                      ? "bg-ember-500/10 text-ember-300"
                      : "text-ink-200 hover:bg-[var(--surface-raised)]"
                  )}
                >
                  <Check
                    className={cn(
                      "h-3.5 w-3.5 shrink-0",
                      isActive ? "opacity-100" : "opacity-0"
                    )}
                  />
                  <span className="truncate">{option.label}</span>
                </button>
              );
            })}
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );

  return (
    <div ref={containerRef} className={cn("relative", className)}>
      <button
        ref={triggerRef}
        type="button"
        disabled={disabled}
        onClick={() => {
          if (disabled) {
            return;
          }
          setOpen((v) => !v);
        }}
        className={cn(
          "flex h-9 w-full select-none items-center justify-between rounded-xl border border-[var(--input-border)] bg-[var(--input-bg)] px-3 text-sm text-ink-50",
          "focus:border-ember-500/60 focus:outline-none focus:ring-2 focus:ring-ember-500/20",
          "transition-colors cursor-pointer",
          open && "border-ember-500/60 ring-2 ring-ember-500/20",
          disabled && "cursor-not-allowed opacity-55"
        )}
      >
        <span className={cn("truncate", !selected && "text-ink-500")}>
          {selected?.label ?? placeholder ?? "Select..."}
        </span>
        <motion.span
          className="ml-2 inline-flex items-center justify-center"
          animate={{ rotate: open ? 180 : 0 }}
          transition={{ type: "spring", stiffness: 300, damping: 20 }}
        >
          <ChevronDown className="h-3.5 w-3.5 shrink-0 text-ink-500" />
        </motion.span>
      </button>

      {createPortal(dropdownContent, document.body)}
    </div>
  );
}
