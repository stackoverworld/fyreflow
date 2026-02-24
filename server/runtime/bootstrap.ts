export interface SchedulerTimerHandle {
  unref?: () => void;
}

type SetIntervalFn = (handler: () => void, timeoutMs: number) => SchedulerTimerHandle;
type ClearIntervalFn = (handle: SchedulerTimerHandle) => void;

export interface RuntimeBootstrapDependencies {
  enableScheduler: boolean;
  enableRecovery: boolean;
  ensureSchedulerMarkersLoaded: () => Promise<void>;
  tickPipelineSchedules: () => Promise<void>;
  recoverInterruptedRuns: () => Promise<void>;
  schedulerPollIntervalMs: number;
  setIntervalFn?: SetIntervalFn;
  clearIntervalFn?: ClearIntervalFn;
}

export interface RuntimeBootstrapHandle {
  dispose: () => void;
}

const defaultSetInterval: SetIntervalFn = (handler, timeoutMs) =>
  setInterval(handler, timeoutMs) as unknown as SchedulerTimerHandle;
const defaultClearInterval: ClearIntervalFn = (handle) => clearInterval(handle as unknown as NodeJS.Timeout);

export async function initializeRuntimeBootstrap(
  deps: RuntimeBootstrapDependencies
): Promise<RuntimeBootstrapHandle> {
  const setIntervalFn = deps.setIntervalFn ?? defaultSetInterval;
  const clearIntervalFn = deps.clearIntervalFn ?? defaultClearInterval;
  let schedulerHandle: SchedulerTimerHandle | null = null;

  if (deps.enableScheduler) {
    await deps.ensureSchedulerMarkersLoaded();
  }

  if (deps.enableRecovery) {
    await deps.recoverInterruptedRuns();
  }

  if (deps.enableScheduler) {
    await deps.tickPipelineSchedules();
    schedulerHandle = setIntervalFn(() => {
      void deps.tickPipelineSchedules();
    }, deps.schedulerPollIntervalMs);

    if (typeof schedulerHandle.unref === "function") {
      schedulerHandle.unref();
    }
  }

  return {
    dispose: () => {
      if (!schedulerHandle) {
        return;
      }

      clearIntervalFn(schedulerHandle);
      schedulerHandle = null;
    }
  };
}
