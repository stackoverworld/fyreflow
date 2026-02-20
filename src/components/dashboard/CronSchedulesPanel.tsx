import { CalendarClock, Clock3, Info, Loader2, PlayCircle, RefreshCw, ShieldCheck, Zap } from "lucide-react";
import type { PipelinePayload, SmartRunPlan } from "@/lib/types";
import { Badge } from "@/components/optics/badge";
import { Button } from "@/components/optics/button";
import { Input } from "@/components/optics/input";
import { SegmentedControl } from "@/components/optics/segmented-control";
import { Select, type SelectOption } from "@/components/optics/select";
import { Switch } from "@/components/optics/switch";
import { Textarea } from "@/components/optics/textarea";
import { cn } from "@/lib/cn";
import { getRunInputValue, normalizeRunInputKey } from "@/lib/runInputAliases";

type ScheduleRunMode = "smart" | "quick";

interface CronSchedulesPanelProps {
  draft: PipelinePayload;
  pipelineId?: string;
  smartRunPlan: SmartRunPlan | null;
  loadingSmartRunPlan?: boolean;
  readOnly?: boolean;
  onChange: (next: PipelinePayload) => void;
  onRefreshSmartRunPlan?: (
    runMode: ScheduleRunMode,
    inputs?: Record<string, string>,
    options?: { force?: boolean }
  ) => Promise<void>;
}

interface CronPreset {
  label: string;
  cron: string;
  timezone: string;
  task: string;
}

const defaultSchedule = {
  enabled: false,
  cron: "",
  timezone: "UTC",
  task: "",
  runMode: "smart" as const,
  inputs: {} as Record<string, string>
};

const scheduleModeSegments = [
  { value: "smart" as const, label: "Smart Run" },
  { value: "quick" as const, label: "Quick Run" }
];

const presets: CronPreset[] = [
  { label: "Hourly", cron: "0 * * * *", timezone: "UTC", task: "Hourly scheduled run" },
  { label: "Daily 09:00", cron: "0 9 * * *", timezone: "UTC", task: "Daily scheduled run" },
  { label: "Weekdays 09:00", cron: "0 9 * * 1-5", timezone: "America/New_York", task: "Weekday morning scheduled run" },
  { label: "Mondays 08:30", cron: "30 8 * * 1", timezone: "UTC", task: "Weekly Monday sync run" }
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

function describeCron(cron: string): string | null {
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

function normalizeSchedule(raw: PipelinePayload["schedule"]) {
  const cron = typeof raw?.cron === "string" ? raw.cron.trim() : "";
  const timezone = typeof raw?.timezone === "string" && raw.timezone.trim().length > 0 ? raw.timezone.trim() : "UTC";
  const task = typeof raw?.task === "string" ? raw.task : "";
  const runMode: ScheduleRunMode = raw?.runMode === "quick" ? "quick" : "smart";
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

function withSchedule(draft: PipelinePayload, patch: Partial<PipelinePayload["schedule"]>): PipelinePayload {
  const current = normalizeSchedule(draft.schedule);
  return {
    ...draft,
    schedule: {
      ...current,
      ...patch
    }
  };
}

function withScheduleInput(
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

function isPresetActive(preset: CronPreset, schedule: ReturnType<typeof normalizeSchedule>): boolean {
  return schedule.cron === preset.cron && schedule.timezone === preset.timezone;
}

export function CronSchedulesPanel({
  draft,
  pipelineId,
  smartRunPlan,
  loadingSmartRunPlan = false,
  readOnly = false,
  onChange,
  onRefreshSmartRunPlan
}: CronSchedulesPanelProps) {
  const schedule = normalizeSchedule(draft.schedule);
  const cronDescription = describeCron(schedule.cron);
  const timezoneInList = TIMEZONE_OPTIONS.some((o) => o.value === schedule.timezone);
  const passCount = (smartRunPlan?.checks ?? []).filter((check) => check.status === "pass").length;
  const totalChecks = (smartRunPlan?.checks ?? []).length;
  const failedChecks = (smartRunPlan?.checks ?? []).filter((check) => check.status === "fail");
  const firstFailure = failedChecks[0];
  const scheduleReady = Boolean(pipelineId && smartRunPlan && failedChecks.length === 0);
  const canEnableSchedule = scheduleReady && !loadingSmartRunPlan;
  const toggleDisabled = readOnly || (!schedule.enabled && !canEnableSchedule);

  let preflightMessage = "";
  if (!pipelineId) {
    preflightMessage = "Save this flow first. Cron can run only for saved flows.";
  } else if (loadingSmartRunPlan) {
    preflightMessage = "Validating Smart/Quick Run requirements for cron...";
  } else if (!smartRunPlan) {
    preflightMessage = "Preflight not loaded yet.";
  } else if (firstFailure) {
    preflightMessage = `${firstFailure.title}: ${firstFailure.message}`;
  } else {
    preflightMessage = "Preflight passed. Cron can be enabled.";
  }

  return (
    <div className="space-y-5">
      {readOnly && (
        <p className="rounded-lg bg-amber-500/8 px-3 py-2 text-[11px] text-amber-300">
          This flow is running. Schedule edits are locked until the run finishes or is stopped.
        </p>
      )}

      <fieldset disabled={readOnly} className={readOnly ? "space-y-5 opacity-70" : "space-y-5"}>
        <section className="space-y-2.5">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 text-ink-400">
              <ShieldCheck className="h-3.5 w-3.5" />
              <span className="text-[11px] font-semibold uppercase tracking-wider">Run mode for cron</span>
            </div>
            <Button
              size="sm"
              variant="secondary"
              disabled={!pipelineId || loadingSmartRunPlan}
              onClick={async () => {
                if (!onRefreshSmartRunPlan) {
                  return;
                }
                await onRefreshSmartRunPlan(schedule.runMode, schedule.runMode === "smart" ? schedule.inputs : {}, { force: true });
              }}
            >
              {loadingSmartRunPlan ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
              Refresh
            </Button>
          </div>

          <SegmentedControl
            segments={scheduleModeSegments}
            value={schedule.runMode}
            disabled={readOnly}
            onValueChange={(value) => {
              onChange(
                withSchedule(draft, {
                  runMode: value as ScheduleRunMode,
                  enabled: false
                })
              );
            }}
          />

          <p className={cn("text-[11px]", firstFailure ? "text-red-400" : "text-ink-500")}>{preflightMessage}</p>
          {smartRunPlan && !loadingSmartRunPlan ? (
            <p className="text-[11px] text-ink-600">{passCount}/{totalChecks} preflight checks passed.</p>
          ) : null}
        </section>

        <div className="rounded-xl border border-ink-800 bg-ink-950/55 px-3 py-3">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2.5">
              <Switch
                checked={schedule.enabled}
                disabled={toggleDisabled}
                onChange={(checked) => {
                  if (checked && !canEnableSchedule) {
                    return;
                  }

                  if (checked && schedule.cron.length === 0) {
                    onChange(
                      withSchedule(draft, {
                        ...defaultSchedule,
                        enabled: true,
                        cron: "0 9 * * 1-5",
                        timezone: "America/New_York",
                        task: `Scheduled run for "${draft.name || "Flow"}"`,
                        runMode: schedule.runMode,
                        inputs: schedule.inputs
                      })
                    );
                    return;
                  }
                  onChange(withSchedule(draft, { enabled: checked }));
                }}
              />
              <div>
                <p className="text-[13px] text-ink-100">Enable scheduled runs</p>
                <p className="text-[11px] text-ink-500">Scheduler polls every 15 s.</p>
              </div>
            </div>
            <Badge variant={schedule.enabled ? "success" : "neutral"}>{schedule.enabled ? "Active" : "Off"}</Badge>
          </div>
          {!schedule.enabled && !canEnableSchedule ? (
            <p className="mt-2 text-[11px] text-red-400">{preflightMessage}</p>
          ) : null}
        </div>

        <section className="space-y-3">
          <div className="flex items-center gap-2 text-ink-400">
            <Clock3 className="h-3.5 w-3.5" />
            <span className="text-[11px] font-semibold uppercase tracking-wider">Expression</span>
          </div>

          <label className="block space-y-1.5">
            <Input
              value={schedule.cron}
              disabled={!schedule.enabled}
              onChange={(event) => onChange(withSchedule(draft, { cron: event.target.value }))}
              placeholder="0 9 * * 1-5"
              className="font-mono"
            />
            {cronDescription ? (
              <p className="flex items-center gap-1.5 text-[11px] text-emerald-400">
                <CalendarClock className="h-3 w-3 shrink-0" />
                {cronDescription}
              </p>
            ) : (
              <p className="text-[11px] text-ink-600">
                Format: <code className="text-ink-500">minute hour day month weekday</code>
              </p>
            )}
          </label>
        </section>

        <section className="space-y-3">
          <label className="block space-y-1.5">
            <span className="text-xs text-ink-400">Timezone</span>
            {timezoneInList ? (
              <Select
                value={schedule.timezone}
                onValueChange={(value) => onChange(withSchedule(draft, { timezone: value }))}
                options={TIMEZONE_OPTIONS}
                disabled={!schedule.enabled}
              />
            ) : (
              <Input
                value={schedule.timezone}
                disabled={!schedule.enabled}
                onChange={(event) => onChange(withSchedule(draft, { timezone: event.target.value }))}
                placeholder="IANA timezone"
              />
            )}
          </label>

          <label className="block space-y-1.5">
            <span className="text-xs text-ink-400">Run title</span>
            <Input
              value={schedule.task}
              disabled={!schedule.enabled}
              onChange={(event) => onChange(withSchedule(draft, { task: event.target.value }))}
              placeholder={`Scheduled run for "${draft.name || "Flow"}"`}
            />
          </label>
        </section>

        {schedule.runMode === "smart" ? (
          <section className="space-y-3">
            <div className="flex items-center gap-2 text-ink-400">
              <ShieldCheck className="h-3.5 w-3.5" />
              <span className="text-[11px] font-semibold uppercase tracking-wider">Smart run inputs for cron</span>
            </div>

            {!pipelineId ? (
              <p className="rounded-lg bg-ink-900/35 px-3 py-2.5 text-[11px] text-ink-500">Save flow to configure cron inputs.</p>
            ) : loadingSmartRunPlan ? (
              <div className="flex items-center gap-2 rounded-lg bg-ink-900/35 px-3 py-2.5 text-[11px] text-ink-500">
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                Loading smart run fields...
              </div>
            ) : smartRunPlan && smartRunPlan.fields.length > 0 ? (
              <div className="space-y-3">
                {smartRunPlan.fields.map((field) => {
                  const value = getRunInputValue(schedule.inputs, field.key) ?? "";
                  const isSecret = field.type === "secret";
                  const check = smartRunPlan.checks.find((entry) => entry.id.toLowerCase() === `input:${field.key.toLowerCase()}`);
                  const secretMissing = isSecret && field.required && check?.status === "fail";

                  if (isSecret) {
                    return (
                      <div key={field.key} className="space-y-1.5 rounded-lg border border-ink-800/70 bg-ink-900/25 px-3 py-2.5">
                        <div className="flex items-center gap-1 text-xs text-ink-400">
                          {field.label}
                          {field.required ? <span className="text-red-400">*</span> : null}
                        </div>
                        <p className={cn("text-[11px]", secretMissing ? "text-red-400" : "text-ink-500")}>
                          {secretMissing
                            ? "Missing secure value. Run Smart Run once and provide this secret to store it securely."
                            : "Secret value is resolved from secure per-pipeline storage."}
                        </p>
                      </div>
                    );
                  }

                  return (
                    <label key={field.key} className="block space-y-1.5">
                      <span className="flex items-center gap-1 text-xs text-ink-400">
                        {field.label}
                        {field.required ? <span className="text-red-400">*</span> : null}
                      </span>
                      {field.type === "multiline" ? (
                        <Textarea
                          className="min-h-[80px]"
                          value={value}
                          onChange={(event) => onChange(withScheduleInput(draft, field.key, event.target.value))}
                          placeholder={field.placeholder}
                        />
                      ) : (
                        <Input
                          type={field.type === "url" ? "url" : "text"}
                          value={value}
                          onChange={(event) => onChange(withScheduleInput(draft, field.key, event.target.value))}
                          placeholder={field.placeholder}
                        />
                      )}
                      {field.description ? <p className="text-[11px] text-ink-600">{field.description}</p> : null}
                    </label>
                  );
                })}
              </div>
            ) : (
              <p className="rounded-lg bg-ink-900/35 px-3 py-2.5 text-[11px] text-ink-500">No Smart Run inputs detected for this flow.</p>
            )}
          </section>
        ) : (
          <section className="space-y-2">
            <div className="flex items-center gap-2 text-ink-400">
              <ShieldCheck className="h-3.5 w-3.5" />
              <span className="text-[11px] font-semibold uppercase tracking-wider">Quick run mode</span>
            </div>
            <p className="rounded-lg bg-ink-900/35 px-3 py-2.5 text-[11px] text-ink-500">
              Quick mode runs without custom run-input payload. If this flow requires inputs, preflight must still pass before cron can be enabled.
            </p>
          </section>
        )}

        <section className="space-y-3">
          <div className="flex items-center gap-2 text-ink-400">
            <Zap className="h-3.5 w-3.5" />
            <span className="text-[11px] font-semibold uppercase tracking-wider">Quick presets</span>
          </div>

          <div className="grid grid-cols-2 gap-1.5">
            {presets.map((preset) => {
              const active = isPresetActive(preset, schedule);
              return (
                <button
                  key={preset.label}
                  type="button"
                  disabled={readOnly}
                  onClick={() => {
                    onChange(
                      withSchedule(draft, {
                        enabled: canEnableSchedule,
                        cron: preset.cron,
                        timezone: preset.timezone,
                        task: preset.task
                      })
                    );
                  }}
                  className={cn(
                    "flex items-center gap-1.5 rounded-lg border px-2.5 py-2 text-left text-[11px] font-medium transition-colors cursor-pointer",
                    active
                      ? "border-ember-500/30 bg-ember-500/8 text-ember-300"
                      : "border-ink-800 bg-ink-900/40 text-ink-400 hover:bg-ink-800/60 hover:text-ink-200",
                    readOnly && "cursor-not-allowed opacity-60"
                  )}
                >
                  <PlayCircle className={cn("h-3 w-3 shrink-0", active ? "text-ember-400" : "text-ink-600")} />
                  {preset.label}
                </button>
              );
            })}
          </div>
        </section>
      </fieldset>

      <div className="rounded-xl border border-ink-800/50 bg-ink-900/25 px-3.5 py-3">
        <div className="mb-2 flex items-center gap-1.5 text-[11px] font-medium text-ink-400">
          <Info className="h-3 w-3 shrink-0" />
          How it works
        </div>
        <ul className="space-y-1.5 text-[11px] leading-relaxed text-ink-500">
          <li className="flex gap-2">
            <span className="mt-[5px] h-1 w-1 shrink-0 rounded-full bg-ink-600" />
            Only one active run per flow. Overlapping schedule hits are skipped.
          </li>
          <li className="flex gap-2">
            <span className="mt-[5px] h-1 w-1 shrink-0 rounded-full bg-ink-600" />
            Use a valid IANA timezone, e.g. <code className="ml-0.5 text-ink-400">America/New_York</code>.
          </li>
          <li className="flex gap-2">
            <span className="mt-[5px] h-1 w-1 shrink-0 rounded-full bg-ink-600" />
            Cron toggle is blocked until preflight checks pass.
          </li>
        </ul>
      </div>
    </div>
  );
}
