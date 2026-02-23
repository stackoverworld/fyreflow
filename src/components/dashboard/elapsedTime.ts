export function parseStartedAtMs(startedAt: string | undefined): number | null {
  if (!startedAt) {
    return null;
  }

  const parsed = Date.parse(startedAt);
  return Number.isNaN(parsed) ? null : parsed;
}

export function formatElapsed(ms: number): string {
  if (ms < 0) {
    return "0s";
  }

  const totalSeconds = Math.floor(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (hours > 0) {
    return `${hours}h ${String(minutes).padStart(2, "0")}m`;
  }

  if (minutes > 0) {
    return `${minutes}m ${String(seconds).padStart(2, "0")}s`;
  }

  return `${seconds}s`;
}

export function applyPauseOffset(
  adjustedStartMs: number | null,
  pauseStartedAtMs: number | null,
  resumedAtMs: number,
  fallbackStartMs: number
): number {
  const baseStart = adjustedStartMs ?? fallbackStartMs;
  if (pauseStartedAtMs === null) {
    return baseStart;
  }

  const pausedDurationMs = Math.max(0, resumedAtMs - pauseStartedAtMs);
  return baseStart + pausedDurationMs;
}

export function computeElapsedMs(
  adjustedStartMs: number,
  nowMs: number,
  pauseStartedAtMs: number | null
): number {
  const effectiveNow = pauseStartedAtMs ?? nowMs;
  return Math.max(0, effectiveNow - adjustedStartMs);
}
