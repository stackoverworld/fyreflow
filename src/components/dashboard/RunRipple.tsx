import { useCallback, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";

interface RippleOrigin {
  x: number;
  y: number;
  id: number;
}

/**
 * Hook for the expanding run ripple + border flash effect.
 *
 * - `trigger(e)` — fire from a click event (uses button position)
 * - `triggerFromRef(ref)` — fire from a ref'd element's position (for programmatic triggers like mock run)
 * - `runButtonRef` — attach to the Run button wrapper so mock-run can locate it
 */
export function useRunRipple() {
  const [ripple, setRipple] = useState<RippleOrigin | null>(null);
  const counter = useRef(0);
  const runButtonRef = useRef<HTMLDivElement>(null);

  const fire = useCallback((x: number, y: number) => {
    counter.current += 1;
    setRipple({ x, y, id: counter.current });
  }, []);

  const trigger = useCallback((e: React.MouseEvent) => {
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    fire(rect.left + rect.width / 2, rect.top + rect.height / 2);
  }, [fire]);

  const triggerFromRunButton = useCallback(() => {
    const el = runButtonRef.current;
    if (el) {
      const rect = el.getBoundingClientRect();
      fire(rect.left + rect.width / 2, rect.top + rect.height / 2);
    } else {
      fire(window.innerWidth - 80, 60);
    }
  }, [fire]);

  const clear = useCallback(() => {
    setRipple(null);
  }, []);

  return { ripple, runButtonRef, trigger, triggerFromRunButton, clear } as const;
}

interface RunRippleProps {
  ripple: RippleOrigin | null;
  onComplete: () => void;
}

export function RunRipple({ ripple, onComplete }: RunRippleProps) {
  if (!ripple) {
    return null;
  }

  const maxRadius = Math.hypot(
    Math.max(ripple.x, window.innerWidth - ripple.x),
    Math.max(ripple.y, window.innerHeight - ripple.y)
  );

  const diameter = maxRadius * 2;

  return (
    <AnimatePresence>
      {/* ── Expanding circle ── */}
      <motion.div
        key={`circle-${ripple.id}`}
        initial={{ scale: 0, opacity: 1 }}
        animate={{ scale: 1, opacity: 0 }}
        transition={{ duration: 0.7, ease: [0.22, 1, 0.36, 1] }}
        style={{
          position: "fixed",
          left: ripple.x - maxRadius,
          top: ripple.y - maxRadius,
          width: diameter,
          height: diameter,
          borderRadius: "50%",
          background: `radial-gradient(circle, rgba(217,119,87,0.32) 0%, rgba(217,119,87,0.12) 30%, rgba(217,119,87,0.03) 55%, transparent 70%)`,
          pointerEvents: "none"
        }}
        className="z-[200]"
      />

      {/* ── Border flash — matches canvas bounds (sidebar 56px, titlebar 38px) ── */}
      <motion.div
        key={`border-${ripple.id}`}
        initial={{ opacity: 0 }}
        animate={{ opacity: [0, 0.85, 0] }}
        transition={{
          duration: 1.1,
          times: [0, 0.35, 1],
          ease: [0.16, 1, 0.3, 1],
          delay: 0.25
        }}
        onAnimationComplete={onComplete}
        style={{
          position: "fixed",
          top: 38,
          left: 56,
          right: 0,
          bottom: 0,
          borderRadius: "16px 0 0 0",
          border: "1.5px solid rgba(217,119,87,0.6)",
          boxShadow:
            "inset 0 0 30px 4px rgba(217,119,87,0.12), 0 0 20px 2px rgba(217,119,87,0.06)",
          pointerEvents: "none"
        }}
        className="z-[200]"
      />
    </AnimatePresence>
  );
}
