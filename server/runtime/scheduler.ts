import { getZonedMinuteKey, matchesCronExpression, parseCronExpression } from "../cron.js";
import { normalizeRunInputs } from "../runInputs.js";
import { loadSchedulerMarkers, saveSchedulerMarkers } from "../schedulerState.js";
import { getPipelineSecureInputs, mergeRunInputsWithSecure } from "../secureInputs.js";
import type { LocalStore } from "../storage.js";
import { buildSmartRunPlan } from "../smartRun.js";
import type { PipelineRun, SmartRunCheck } from "../types.js";
import {
  formatFailedPreflightCheck,
  type QueuePipelineRunOptions
} from "./runQueue.js";

export const schedulerPollIntervalMs = 15_000;
const schedulerDefaultTimezone = "UTC";
const schedulerDefaultTaskPrefix = "Scheduled run for";
const schedulerCatchUpWindowMinutes = (() => {
  const raw = Number.parseInt(process.env.SCHEDULER_CATCHUP_WINDOW_MINUTES ?? "15", 10);
  if (!Number.isFinite(raw)) {
    return 15;
  }

  return Math.max(0, Math.min(720, raw));
})();

export interface SchedulerRuntimeDependencies {
  store: LocalStore;
  queuePipelineRun: (options: QueuePipelineRunOptions) => Promise<PipelineRun>;
  listActivePipelineIds: () => Set<string>;
  isRunPreflightError: (error: unknown) => error is { failedChecks: SmartRunCheck[] };
}

function buildSchedulerSlots(now: Date): Date[] {
  const slots: Date[] = [];
  for (let offset = schedulerCatchUpWindowMinutes; offset >= 0; offset -= 1) {
    const slot = new Date(now.getTime() - offset * 60_000);
    slot.setSeconds(0, 0);
    slots.push(slot);
  }
  return slots;
}

export function createSchedulerRuntime(deps: SchedulerRuntimeDependencies): {
  ensureSchedulerMarkersLoaded: () => Promise<void>;
  tickPipelineSchedules: () => Promise<void>;
} {
  const scheduledRunMarkerByPipeline = new Map<string, string>();
  let schedulerTickActive = false;
  let schedulerMarkersLoaded = false;

  async function ensureSchedulerMarkersLoaded(): Promise<void> {
    if (schedulerMarkersLoaded) {
      return;
    }

    try {
      const loaded = await loadSchedulerMarkers();
      scheduledRunMarkerByPipeline.clear();
      for (const [pipelineId, marker] of loaded.entries()) {
        scheduledRunMarkerByPipeline.set(pipelineId, marker);
      }
    } catch (error) {
      console.error("[scheduler-state-load-error]", error);
    } finally {
      schedulerMarkersLoaded = true;
    }
  }

  async function tickPipelineSchedules(): Promise<void> {
    if (schedulerTickActive) {
      return;
    }

    schedulerTickActive = true;

    try {
      await ensureSchedulerMarkersLoaded();

      const now = new Date();
      const slots = buildSchedulerSlots(now);
      const pipelines = deps.store.listPipelines();
      const stateSnapshot = deps.store.getState();
      const knownIds = new Set(pipelines.map((pipeline) => pipeline.id));
      let markersDirty = false;

      for (const pipelineId of [...scheduledRunMarkerByPipeline.keys()]) {
        if (!knownIds.has(pipelineId)) {
          scheduledRunMarkerByPipeline.delete(pipelineId);
          markersDirty = true;
        }
      }

      const activePipelineIds = deps.listActivePipelineIds();

      for (const pipeline of pipelines) {
        const schedule = pipeline.schedule;
        const cron = schedule?.cron?.trim() ?? "";

        if (!schedule?.enabled || cron.length === 0) {
          if (scheduledRunMarkerByPipeline.delete(pipeline.id)) {
            markersDirty = true;
          }
          continue;
        }

        const parseResult = parseCronExpression(cron);
        if (!parseResult.ok) {
          const invalidMarker = `invalid-cron:${cron}`;
          if (scheduledRunMarkerByPipeline.get(pipeline.id) !== invalidMarker) {
            scheduledRunMarkerByPipeline.set(pipeline.id, invalidMarker);
            markersDirty = true;
            console.warn(`[scheduler] Skipping ${pipeline.name}: invalid cron "${cron}" (${parseResult.error}).`);
          }
          continue;
        }

        const timezone =
          typeof schedule.timezone === "string" && schedule.timezone.trim().length > 0
            ? schedule.timezone.trim()
            : schedulerDefaultTimezone;
        if (!getZonedMinuteKey(now, timezone)) {
          const invalidMarker = `invalid-timezone:${timezone}`;
          if (scheduledRunMarkerByPipeline.get(pipeline.id) !== invalidMarker) {
            scheduledRunMarkerByPipeline.set(pipeline.id, invalidMarker);
            markersDirty = true;
            console.warn(`[scheduler] Skipping ${pipeline.name}: invalid timezone "${timezone}".`);
          }
          continue;
        }

        for (const slot of slots) {
          const slotMinuteKey = getZonedMinuteKey(slot, timezone);
          if (!slotMinuteKey) {
            continue;
          }

          const matches = matchesCronExpression(parseResult.expression, slot, timezone);
          if (!matches) {
            continue;
          }

          const marker = `${slotMinuteKey}|${cron}|${timezone}`;
          if (scheduledRunMarkerByPipeline.get(pipeline.id) === marker) {
            continue;
          }

          scheduledRunMarkerByPipeline.set(pipeline.id, marker);
          markersDirty = true;

          if (activePipelineIds.has(pipeline.id)) {
            console.info(
              `[scheduler] Skipping scheduled run for "${pipeline.name}" at ${slotMinuteKey} (${timezone}) because a run is already active.`
            );
            continue;
          }

          const task =
            typeof schedule.task === "string" && schedule.task.trim().length > 0
              ? schedule.task.trim()
              : `${schedulerDefaultTaskPrefix} "${pipeline.name}"`;
          const runMode = schedule.runMode === "quick" ? "quick" : "smart";
          const scheduleInputs = runMode === "smart" ? normalizeRunInputs(schedule.inputs ?? {}) : {};

          try {
            const secureInputs = await getPipelineSecureInputs(pipeline.id);
            const preflightInputs = mergeRunInputsWithSecure(scheduleInputs, secureInputs);
            const preflightPlan = await buildSmartRunPlan(pipeline, stateSnapshot, preflightInputs);
            const failedChecks = preflightPlan.checks.filter((check) => check.status === "fail");

            if (failedChecks.length > 0) {
              const failureMessage = formatFailedPreflightCheck(failedChecks[0]);
              console.warn(
                `[scheduler] Skipping scheduled run for "${pipeline.name}" (${runMode}) at ${slotMinuteKey} (${timezone}) because preflight failed: ${failureMessage}`
              );
              continue;
            }

            const run = await deps.queuePipelineRun({
              pipeline,
              task,
              rawInputs: scheduleInputs,
              persistSensitiveInputs: false
            });
            activePipelineIds.add(pipeline.id);
            console.info(`[scheduler] Triggered "${pipeline.name}" at ${slotMinuteKey} (${timezone}) as run ${run.id}.`);
          } catch (error) {
            if (deps.isRunPreflightError(error)) {
              const failureMessage = formatFailedPreflightCheck(error.failedChecks[0]);
              console.warn(
                `[scheduler] Skipping scheduled run for "${pipeline.name}" (${runMode}) at ${slotMinuteKey} (${timezone}) because queue preflight failed: ${failureMessage}`
              );
              continue;
            }

            scheduledRunMarkerByPipeline.delete(pipeline.id);
            markersDirty = true;
            console.error(`[scheduler] Failed to trigger scheduled run for "${pipeline.name}".`, error);
          }
        }
      }

      if (markersDirty) {
        await saveSchedulerMarkers(scheduledRunMarkerByPipeline);
      }
    } catch (error) {
      console.error("[scheduler-error]", error);
    } finally {
      schedulerTickActive = false;
    }
  }

  return {
    ensureSchedulerMarkersLoaded,
    tickPipelineSchedules
  };
}
