import type { PipelinePayload } from "@/lib/types";
import { normalizeRunInputKey } from "@/lib/runInputAliases";
import type { SelectOption } from "@/components/optics/select";

export type CronScheduleRunMode = "smart" | "quick";

export interface CronPreset {
  label: string;
  cron: string;
  timezone: string;
  task: string;
}

export interface NormalizedCronSchedule {
  enabled: boolean;
  cron: string;
  timezone: string;
  task: string;
  runMode: CronScheduleRunMode;
  inputs: Record<string, string>;
}

export const defaultSchedule: NormalizedCronSchedule = {
  enabled: false,
  cron: "",
  timezone: "UTC",
  task: "",
  runMode: "smart",
  inputs: {}
};

export const scheduleModeSegments = [
  { value: "smart" as const, label: "Smart Run" },
  { value: "quick" as const, label: "Quick Run" }
];

export const presets: CronPreset[] = [
  { label: "Hourly", cron: "0 * * * *", timezone: "UTC", task: "Hourly scheduled run" },
  { label: "Daily 09:00", cron: "0 9 * * *", timezone: "UTC", task: "Daily scheduled run" },
  { label: "Weekdays 09:00", cron: "0 9 * * 1-5", timezone: "America/New_York", task: "Weekday morning scheduled run" },
  { label: "Mondays 08:30", cron: "30 8 * * 1", timezone: "UTC", task: "Weekly Monday sync run" }
];

export const TIMEZONE_OPTIONS: SelectOption[] = [
  { value: "UTC", label: "UTC" },
  { value: "America/New_York", label: "America / New York" },
  { value: "America/Chicago", label: "America / Chicago" },
  { value: "America/Denver", label: "America / Denver" },
  { value: "America/Los_Angeles", label: "America / Los Angeles" },
  { value: "Europe/London", label: "Europe / London" },
  { value: "Europe/Berlin", label: "Europe / Berlin" },
  { value: "Europe/Paris", label: "Europe / Paris" },
  { value: "Asia/Tokyo", label: "Asia / Tokyo" },
  { value: "Asia/Shanghai", label: "Asia / Shanghai" },
  { value: "Asia/Kolkata", label: "Asia / Kolkata" },
  { value: "Australia/Sydney", label: "Australia / Sydney" }
];

export function describeCron(cron: string): string | null {
  const parts = cron.trim().split(/\s+/);
  if (parts.length !== 5) return null;

  const [minute, hour, day, month, weekday] = parts;

  if (minute === "0" && hour === "*" && day === "*" && month === "*" && weekday === "*") {
    return "Every hour, on the hour";
  }
  if (minute !== undefined && hour !== undefined && day === "*" && month === "*" && weekday === "*") {
    return `Every day at ${hour.padStart(2, "0")}:${minute.padStart(2, "0")}`;
  }
  if (minute !== undefined && hour !== undefined && day === "*" && month === "*" && weekday === "1-5") {
    return `Weekdays at ${hour.padStart(2, "0")}:${minute.padStart(2, "0")}`;
  }
  if (minute !== undefined && hour !== undefined && day === "*" && month === "*" && weekday === "1") {
    return `Every Monday at ${hour.padStart(2, "0")}:${minute.padStart(2, "0")}`;
  }
  if (minute !== undefined && hour !== undefined && day === "*" && month === "*" && weekday === "0") {
    return `Every Sunday at ${hour.padStart(2, "0")}:${minute.padStart(2, "0")}`;
  }
  if (minute !== undefined && hour !== undefined && day === "*" && month === "*" && weekday === "6") {
    return `Every Saturday at ${hour.padStart(2, "0")}:${minute.padStart(2, "0")}`;
  }
  if (minute !== undefined && hour !== undefined && day === "1" && month === "*" && weekday === "*") {
    return `1st of every month at ${hour.padStart(2, "0")}:${minute.padStart(2, "0")}`;
  }

  return null;
}

function normalizeScheduleInputs(raw: unknown): Record<string, string> {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return {};
  }

  const normalized: Record<string, string> = {};
  for (const [rawKey, rawValue] of Object.entries(raw)) {
    const key = normalizeRunInputKey(rawKey);
    if (key.length === 0) {
      continue;
    }
    if (typeof rawValue === "string") {
      normalized[key] = rawValue;
      continue;
    }
    if (rawValue === null || rawValue === undefined) {
      continue;
    }
    normalized[key] = String(rawValue);
  }

  return normalized;
}

export function normalizeSchedule(raw: PipelinePayload["schedule"]): NormalizedCronSchedule {
  const cron = typeof raw?.cron === "string" ? raw.cron.trim() : "";
  const timezone = typeof raw?.timezone === "string" && raw.timezone.trim().length > 0 ? raw.timezone.trim() : "UTC";
  const task = typeof raw?.task === "string" ? raw.task : "";
  const runMode: CronScheduleRunMode = raw?.runMode === "quick" ? "quick" : "smart";
  const inputs = normalizeScheduleInputs(raw?.inputs);

  return {
    enabled: raw?.enabled === true && cron.length > 0,
    cron,
    timezone,
    task,
    runMode,
    inputs
  };
}

export function withSchedule(
  draft: PipelinePayload,
  patch: Partial<PipelinePayload["schedule"]>
): PipelinePayload {
  const current = normalizeSchedule(draft.schedule);
  return {
    ...draft,
    schedule: {
      ...current,
      ...patch
    }
  };
}

export function withScheduleInput(
  draft: PipelinePayload,
  key: string,
  value: string
): PipelinePayload {
  const current = normalizeSchedule(draft.schedule);
  return {
    ...draft,
    schedule: {
      ...current,
      inputs: {
        ...current.inputs,
        [normalizeRunInputKey(key)]: value
      }
    }
  };
}

export function isPresetActive(preset: CronPreset, schedule: NormalizedCronSchedule): boolean {
  return schedule.cron === preset.cron && schedule.timezone === preset.timezone;
}
