import { describe, expect, it } from "vitest";

import { applyPauseOffset, computeElapsedMs, formatElapsed, parseStartedAtMs } from "../../src/components/dashboard/elapsedTime.ts";

describe("elapsed time utilities", () => {
  it("parses startedAt values safely", () => {
    expect(parseStartedAtMs(undefined)).toBeNull();
    expect(parseStartedAtMs("not-a-date")).toBeNull();
    expect(parseStartedAtMs("2026-02-22T12:00:00.000Z")).toBe(Date.parse("2026-02-22T12:00:00.000Z"));
  });

  it("formats elapsed strings for seconds, minutes, and hours", () => {
    expect(formatElapsed(-1)).toBe("0s");
    expect(formatElapsed(9_000)).toBe("9s");
    expect(formatElapsed(61_000)).toBe("1m 01s");
    expect(formatElapsed(3_661_000)).toBe("1h 01m");
  });

  it("freezes elapsed during pause and excludes pause after resume", () => {
    const startedAtMs = 1_000;
    let adjustedStartMs = startedAtMs;
    const pauseStartedAtMs = 6_000;

    expect(computeElapsedMs(adjustedStartMs, 9_000, pauseStartedAtMs)).toBe(5_000);

    adjustedStartMs = applyPauseOffset(adjustedStartMs, pauseStartedAtMs, 16_000, startedAtMs);

    expect(computeElapsedMs(adjustedStartMs, 16_000, null)).toBe(5_000);
    expect(computeElapsedMs(adjustedStartMs, 18_000, null)).toBe(7_000);
  });

  it("uses fallback start when adjusted start is not initialized", () => {
    expect(applyPauseOffset(null, 5_000, 8_000, 1_000)).toBe(4_000);
  });
});
