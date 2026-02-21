import { CalendarClock, Clock3, Zap } from "lucide-react";
import { normalizeSmartRunInputs } from "@/lib/smartRunInputs";
import { Input } from "@/components/optics/input";
import { SegmentedControl } from "@/components/optics/segmented-control";
import { Select, type SelectOption } from "@/components/optics/select";
import { Switch } from "@/components/optics/switch";
import { Textarea } from "@/components/optics/textarea";
import type { PipelineScheduleConfig } from "@/lib/types";
import { type ScheduleSectionProps } from "../types";

const scheduleModeSegments = [
  { value: "smart" as const, label: "Smart Run" },
  { value: "quick" as const, label: "Quick Run" }
];

const TIMEZONE_OPTIONS: SelectOption[] = [
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

function normalizeSchedule(schedule: ScheduleSectionProps["draft"]["schedule"]): PipelineScheduleConfig {
  const normalizedInputs = normalizeSmartRunInputs(schedule?.inputs);
  return {
    enabled: schedule?.enabled === true,
    cron: typeof schedule?.cron === "string" ? schedule.cron : "",
    timezone: typeof schedule?.timezone === "string" && schedule.timezone.trim().length > 0 ? schedule.timezone : "UTC",
    task: typeof schedule?.task === "string" ? schedule.task : "",
    runMode: schedule?.runMode === "quick" ? "quick" : "smart",
    inputs: normalizedInputs
  };
}

function formatInputs(rawInputs: Record<string, string>): string {
  const entries = Object.entries(rawInputs)
    .map(([key, value]) => `${key}=${value}`)
    .sort((left, right) => left.localeCompare(right));

  return entries.join("\n");
}

function parseInputs(raw: string): Record<string, string> {
  const entries = raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line) => {
      const separatorIndex = line.indexOf("=");
      if (separatorIndex === -1) {
        return null;
      }
      const key = line.slice(0, separatorIndex).trim();
      if (key.length === 0) {
        return null;
      }
      return {
        key: key,
        value: line.slice(separatorIndex + 1).trim()
      };
    })
    .filter((entry): entry is { key: string; value: string } => entry !== null);

  const output: Record<string, string> = {};
  for (const { key, value } of entries) {
    output[key] = value;
  }
  return normalizeSmartRunInputs(output);
}

export function ScheduleSection({ draft, readOnly, onChange }: ScheduleSectionProps) {
  const schedule = normalizeSchedule(draft.schedule);
  const hasTimezones = TIMEZONE_OPTIONS.some((option) => option.value === schedule.timezone);
  const timezoneInUse = schedule.timezone.trim().length > 0 ? schedule.timezone : "UTC";
  const smartInputs = schedule.inputs;
  const defaultTask = `Scheduled run for "${draft.name || "Flow"}"`;
  const timezoneKnown = hasTimezones;

  const updateSchedule = (patch: Partial<typeof schedule>) => {
    onChange({
      ...draft,
      schedule: {
        ...schedule,
        ...patch
      }
    });
  };

  const isCronValid = schedule.cron.trim().split(/\s+/).filter(Boolean).length === 5;

  return (
    <div className="space-y-3">
      <section className="space-y-2.5">
        <div className="flex items-center gap-2 text-ink-400">
          <Clock3 className="h-3.5 w-3.5" />
          <span className="text-[11px] font-semibold uppercase tracking-wider">Run mode</span>
        </div>

        <SegmentedControl
          segments={scheduleModeSegments}
          value={schedule.runMode}
          disabled={readOnly}
          onValueChange={(value) => {
            updateSchedule({
              runMode: value as "smart" | "quick",
              enabled: false
            });
          }}
        />
        <p className="text-[11px] text-ink-500">
          Smart mode uses run-input values from schedule inputs; quick mode keeps runs fully default.
        </p>
      </section>

      <div className="my-5 h-px bg-[var(--divider)]" />

      <section className="space-y-3 rounded-xl border border-ink-800 bg-[var(--surface-inset)] px-3 py-3">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <Switch
              checked={schedule.enabled}
              disabled={readOnly}
              onChange={(checked) => {
                if (checked && !isCronValid) {
                  return;
                }
                if (checked && schedule.cron.trim().length === 0) {
                  updateSchedule({
                    enabled: true,
                    cron: "0 9 * * 1-5",
                    timezone: "America/New_York",
                    task: schedule.task.length > 0 ? schedule.task : defaultTask,
                    inputs: schedule.runMode === "quick" ? {} : schedule.inputs
                  });
                  return;
                }
                updateSchedule({ enabled: checked });
              }}
            />
            <div>
              <p className="text-[13px] text-ink-100">Enable scheduled runs</p>
              <p className="text-[11px] text-ink-500">Scheduler checks the cron expression while enabled.</p>
            </div>
          </div>
        </div>
        {!schedule.enabled && !isCronValid && schedule.cron.trim().length > 0 ? (
          <p className="text-[11px] text-amber-400">
            Cron format must be valid before enabling schedule.
          </p>
        ) : null}
      </section>

      <section className="space-y-3">
        <div className="flex items-center gap-2 text-ink-400">
          <CalendarClock className="h-3.5 w-3.5" />
          <span className="text-[11px] font-semibold uppercase tracking-wider">Expression</span>
        </div>

        <label className="block space-y-1.5">
          <Input
            value={schedule.cron}
            disabled={!schedule.enabled || readOnly}
            onChange={(event) => updateSchedule({ cron: event.target.value })}
            placeholder="0 9 * * 1-5"
            className="font-mono"
          />
          <p className="text-[11px] text-ink-600">
            Format: <code className="text-ink-500">minute hour day month weekday</code>
          </p>
        </label>

        <label className="block space-y-1.5">
          <span className="text-xs text-ink-400">Timezone</span>
          {timezoneKnown ? (
            <Select
              value={timezoneInUse}
              onValueChange={(value) => updateSchedule({ timezone: value })}
              options={TIMEZONE_OPTIONS}
              disabled={!schedule.enabled || readOnly}
            />
          ) : (
            <Input
              value={timezoneInUse}
              disabled={!schedule.enabled || readOnly}
              onChange={(event) => updateSchedule({ timezone: event.target.value })}
              placeholder="IANA timezone"
            />
          )}
        </label>

        <label className="block space-y-1.5">
          <span className="text-xs text-ink-400">Run title</span>
          <Input
            value={schedule.task}
            disabled={!schedule.enabled || readOnly}
            onChange={(event) => updateSchedule({ task: event.target.value })}
            placeholder={defaultTask}
          />
        </label>
      </section>

      {schedule.runMode === "smart" ? (
        <section className="space-y-3">
          <div className="flex items-center gap-2 text-ink-400">
            <Clock3 className="h-3.5 w-3.5" />
            <span className="text-[11px] font-semibold uppercase tracking-wider">Smart run inputs</span>
          </div>
          <label className="block space-y-1.5">
            <span className="text-xs text-ink-500">
              Define key/value pairs consumed by cron smart runs. One pair per line: <code>key=value</code>
            </span>
            <Textarea
              className="min-h-[84px]"
              value={formatInputs(smartInputs)}
              disabled={!schedule.enabled || readOnly}
              onChange={(event) => updateSchedule({ inputs: parseInputs(event.target.value) })}
            />
          </label>
          {Object.keys(smartInputs).length > 0 ? (
            <p className="text-[11px] text-ink-500">
              {Object.keys(smartInputs).map((key) => `• ${key}`).join(" ")}
            </p>
          ) : (
            <p className="rounded-lg bg-[var(--surface-raised)] px-3 py-2.5 text-[11px] text-ink-500">No smart inputs configured yet.</p>
          )}
        </section>
      ) : (
        <section className="space-y-2.5">
          <div className="flex items-center gap-2 text-ink-400">
            <Zap className="h-3.5 w-3.5" />
            <span className="text-[11px] font-semibold uppercase tracking-wider">Quick run mode</span>
          </div>
          <p className="rounded-lg bg-[var(--surface-raised)] px-3 py-2.5 text-[11px] text-ink-500">
            Quick mode runs without custom schedule input payload.
          </p>
        </section>
      )}
    </div>
  );
}
