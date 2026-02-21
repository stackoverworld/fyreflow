import { defaultSchedule } from "../constants.js";
import type { FlowSchedule } from "../constants.js";

export function normalizeSchedule(schedule: Partial<FlowSchedule> | undefined): FlowSchedule {
  const cron = typeof schedule?.cron === "string" ? schedule.cron.trim() : "";
  const timezone =
    typeof schedule?.timezone === "string" && schedule.timezone.trim().length > 0
      ? schedule.timezone.trim()
      : defaultSchedule.timezone;
  const task = typeof schedule?.task === "string" ? schedule.task.trim() : "";
  const runMode = schedule?.runMode === "quick" ? "quick" : "smart";
  const inputsRaw = typeof schedule?.inputs === "object" && schedule.inputs !== null ? schedule.inputs : {};
  const inputs: Record<string, string> = {};

  for (const [rawKey, rawValue] of Object.entries(inputsRaw)) {
    const key = rawKey.trim().toLowerCase();
    if (key.length === 0) {
      continue;
    }
    if (typeof rawValue === "string") {
      inputs[key] = rawValue;
      continue;
    }
    if (rawValue === null || rawValue === undefined) {
      continue;
    }
    inputs[key] = String(rawValue);
  }

  return {
    enabled: schedule?.enabled === true && cron.length > 0,
    cron,
    timezone,
    task,
    runMode,
    inputs
  };
}
