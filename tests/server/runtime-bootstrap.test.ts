import { describe, expect, it, vi } from "vitest";

import { initializeRuntimeBootstrap, type SchedulerTimerHandle } from "../../server/runtime/bootstrap.js";

describe("runtime bootstrap", () => {
  it("runs startup sequence and starts scheduler loop when enabled", async () => {
    const calls: string[] = [];
    const schedulerHandle: SchedulerTimerHandle = {
      unref: vi.fn()
    };
    const setIntervalFn = vi.fn(() => schedulerHandle);
    const clearIntervalFn = vi.fn();

    const handle = await initializeRuntimeBootstrap({
      enableScheduler: true,
      enableRecovery: true,
      ensureSchedulerMarkersLoaded: async () => {
        calls.push("ensure-markers");
      },
      recoverInterruptedRuns: async () => {
        calls.push("recover");
      },
      tickPipelineSchedules: async () => {
        calls.push("tick");
      },
      schedulerPollIntervalMs: 15_000,
      setIntervalFn,
      clearIntervalFn
    });

    expect(calls).toEqual(["ensure-markers", "recover", "tick"]);
    expect(setIntervalFn).toHaveBeenCalledTimes(1);
    expect(setIntervalFn).toHaveBeenCalledWith(expect.any(Function), 15_000);
    expect(schedulerHandle.unref).toHaveBeenCalledTimes(1);

    handle.dispose();
    expect(clearIntervalFn).toHaveBeenCalledTimes(1);
    expect(clearIntervalFn).toHaveBeenCalledWith(schedulerHandle);
  });

  it("skips recovery and scheduler calls when disabled", async () => {
    const ensureSchedulerMarkersLoaded = vi.fn(async () => {});
    const recoverInterruptedRuns = vi.fn(async () => {});
    const tickPipelineSchedules = vi.fn(async () => {});
    const setIntervalFn = vi.fn(() => ({}));
    const clearIntervalFn = vi.fn();

    const handle = await initializeRuntimeBootstrap({
      enableScheduler: false,
      enableRecovery: false,
      ensureSchedulerMarkersLoaded,
      recoverInterruptedRuns,
      tickPipelineSchedules,
      schedulerPollIntervalMs: 15_000,
      setIntervalFn,
      clearIntervalFn
    });

    expect(ensureSchedulerMarkersLoaded).not.toHaveBeenCalled();
    expect(recoverInterruptedRuns).not.toHaveBeenCalled();
    expect(tickPipelineSchedules).not.toHaveBeenCalled();
    expect(setIntervalFn).not.toHaveBeenCalled();

    handle.dispose();
    expect(clearIntervalFn).not.toHaveBeenCalled();
  });
});
