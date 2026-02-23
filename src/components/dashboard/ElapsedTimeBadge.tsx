import { memo, useEffect, useMemo, useRef, useState } from "react";

import { applyPauseOffset, computeElapsedMs, formatElapsed, parseStartedAtMs } from "./elapsedTime";

interface ElapsedTimeBadgeProps {
  startedAt: string | undefined;
  paused?: boolean;
}

/**
 * Self-contained elapsed-time display. Re-renders itself once per second while
 * running, stays frozen while paused, and does not count paused duration.
 */
function ElapsedTimeBadgeImpl({ startedAt, paused }: ElapsedTimeBadgeProps) {
  const startedAtMs = useMemo(() => parseStartedAtMs(startedAt), [startedAt]);
  const [now, setNow] = useState(() => Date.now());
  const [adjustedStartMs, setAdjustedStartMs] = useState<number | null>(startedAtMs);
  const pauseStartedAtRef = useRef<number | null>(null);
  const lastStartedAtMsRef = useRef<number | null>(startedAtMs);

  useEffect(() => {
    if (lastStartedAtMsRef.current === startedAtMs) {
      return;
    }

    lastStartedAtMsRef.current = startedAtMs;

    if (startedAtMs === null) {
      pauseStartedAtRef.current = null;
      setAdjustedStartMs(null);
      return;
    }

    const snapshotNow = Date.now();
    pauseStartedAtRef.current = paused ? snapshotNow : null;
    setAdjustedStartMs(startedAtMs);
    setNow(snapshotNow);
  }, [startedAtMs, paused]);

  useEffect(() => {
    if (startedAtMs === null) {
      return;
    }

    if (paused) {
      if (pauseStartedAtRef.current === null) {
        const snapshotNow = Date.now();
        pauseStartedAtRef.current = snapshotNow;
        setNow(snapshotNow);
      }
      return;
    }

    if (pauseStartedAtRef.current !== null) {
      const pauseStartedAt = pauseStartedAtRef.current;
      const resumedAt = Date.now();
      setAdjustedStartMs((previous) => applyPauseOffset(previous, pauseStartedAt, resumedAt, startedAtMs));
      pauseStartedAtRef.current = null;
      setNow(resumedAt);
    }

    const id = window.setInterval(() => {
      setNow(Date.now());
    }, 1000);

    return () => {
      window.clearInterval(id);
    };
  }, [startedAtMs, paused]);

  if (startedAtMs === null || adjustedStartMs === null) {
    return null;
  }

  const text = formatElapsed(computeElapsedMs(adjustedStartMs, now, pauseStartedAtRef.current));

  return <span className="ml-0.5 tabular-nums text-ink-500">{text}</span>;
}

export const ElapsedTimeBadge = memo(ElapsedTimeBadgeImpl);
ElapsedTimeBadge.displayName = "ElapsedTimeBadge";
