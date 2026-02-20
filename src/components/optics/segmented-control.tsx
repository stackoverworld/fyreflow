import { type ReactNode, useEffect, useRef, useState } from "react";
import { motion } from "motion/react";
import { cn } from "@/lib/cn";

export interface Segment<T extends string = string> {
  value: T;
  label: string;
  icon?: ReactNode;
}

interface SegmentedControlProps<T extends string = string> {
  segments: Segment<T>[];
  value: T;
  onValueChange: (value: T) => void;
  className?: string;
}

export function SegmentedControl<T extends string = string>({
  segments,
  value,
  onValueChange,
  className
}: SegmentedControlProps<T>) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [indicator, setIndicator] = useState({ left: 0, width: 0 });

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const index = segments.findIndex((s) => s.value === value);
    const buttons = container.querySelectorAll<HTMLButtonElement>("[data-segment]");
    const active = buttons[index];

    if (active) {
      setIndicator({
        left: active.offsetLeft,
        width: active.offsetWidth
      });
    }
  }, [value, segments]);

  return (
    <div
      ref={containerRef}
      className={cn(
        "relative flex rounded-xl bg-ink-900/80 p-1",
        className
      )}
    >
      <motion.div
        className="absolute top-1 h-[calc(100%-8px)] rounded-lg bg-ink-700/70 shadow-sm"
        animate={{ left: indicator.left, width: indicator.width }}
        transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
      />

      {segments.map((segment) => {
        const isActive = segment.value === value;
        return (
          <button
            key={segment.value}
            type="button"
            data-segment
            onClick={() => onValueChange(segment.value)}
            className={cn(
              "relative z-10 flex flex-1 items-center justify-center gap-2 rounded-lg px-3 py-2 text-[13px] font-medium transition-colors duration-150 cursor-pointer",
              isActive ? "text-ink-50" : "text-ink-500 hover:text-ink-300"
            )}
          >
            {segment.icon}
            {segment.label}
          </button>
        );
      })}
    </div>
  );
}
