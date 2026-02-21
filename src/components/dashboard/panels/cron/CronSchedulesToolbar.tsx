import { CalendarClock, Clock3, Loader2, RefreshCw, ShieldCheck, Zap } from "lucide-react";
import type { PipelinePayload, SmartRunPlan } from "@/lib/types";
import { Badge } from "@/components/optics/badge";
import { Button } from "@/components/optics/button";
import { Input } from "@/components/optics/input";
import { SegmentedControl } from "@/components/optics/segmented-control";
import { Select } from "@/components/optics/select";
import { Switch } from "@/components/optics/switch";
import { getRunInputValue } from "@/lib/runInputAliases";
import { RowActions } from "./RowActions";
import {
  TIMEZONE_OPTIONS,
  describeCron,
  defaultSchedule,
  withSchedule,
  withScheduleInput,
  type CronScheduleRunMode,
  type NormalizedCronSchedule,
  presets,
  scheduleModeSegments
} from "./formatters";
import { CronScheduleRow } from "./CronScheduleRow";
import { cn } from "@/lib/cn";

interface CronSchedulesToolbarProps {
  draft: PipelinePayload;
  schedule: NormalizedCronSchedule;
  pipelineId?: string;
  smartRunPlan: SmartRunPlan | null;
  loadingSmartRunPlan: boolean;
  readOnly: boolean;
  preflightMessage: string;
  passCount: number;
  totalChecks: number;
  canEnableSchedule: boolean;
  toggleDisabled: boolean;
  onChange: (next: PipelinePayload) => void;
  onRefreshSmartRunPlan?: (
    runMode: CronScheduleRunMode,
    inputs?: Record<string, string>,
    options?: { force?: boolean }
  ) => Promise<void>;
}

export function CronSchedulesToolbar({
  draft,
  schedule,
  pipelineId,
  smartRunPlan,
  loadingSmartRunPlan,
  readOnly,
  preflightMessage,
  passCount,
  totalChecks,
  canEnableSchedule,
  toggleDisabled,
  onChange,
  onRefreshSmartRunPlan
}: CronSchedulesToolbarProps) {
  const cronDescription = describeCron(schedule.cron);
  const timezoneInList = TIMEZONE_OPTIONS.some((option) => option.value === schedule.timezone);
  const firstFailure = smartRunPlan?.checks.find((check) => check.status === "fail");

  return (
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
                runMode: value as CronScheduleRunMode,
                enabled: false
              })
            );
          }}
        />

        <p className={cn("text-[11px]", firstFailure ? "text-red-400" : "text-ink-500")}>{preflightMessage}</p>
        {smartRunPlan && !loadingSmartRunPlan ? <p className="text-[11px] text-ink-600">{passCount}/{totalChecks} preflight checks passed.</p> : null}
      </section>

      <section className="space-y-3">
        <div className="flex items-center gap-2 text-ink-400">
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
          <Badge variant={schedule.enabled ? "success" : "neutral"}>{schedule.enabled ? "Active" : "Off"}</Badge>
        </div>
        {!schedule.enabled && !canEnableSchedule ? <p className="mt-2 text-[11px] text-red-400">{preflightMessage}</p> : null}
      </section>

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
            <p className="rounded-lg bg-[var(--surface-raised)] px-3 py-2.5 text-[11px] text-ink-500">Save flow to configure cron inputs.</p>
          ) : loadingSmartRunPlan ? (
            <div className="flex items-center gap-2 rounded-lg bg-[var(--surface-raised)] px-3 py-2.5 text-[11px] text-ink-500">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              Loading smart run fields...
            </div>
          ) : smartRunPlan && smartRunPlan.fields.length > 0 ? (
            <div className="space-y-3">
              {smartRunPlan.fields.map((field) => {
                const check = smartRunPlan.checks.find((entry) => entry.id.toLowerCase() === `input:${field.key.toLowerCase()}`);
                return (
                  <CronScheduleRow
                    key={field.key}
                    field={field}
                    value={getRunInputValue(schedule.inputs, field.key) ?? ""}
                    isSecretMissing={field.type === "secret" && field.required && check?.status === "fail"}
                    onValueChange={(value) => onChange(withScheduleInput(draft, field.key, value))}
                  />
                );
              })}
            </div>
          ) : (
            <p className="rounded-lg bg-[var(--surface-raised)] px-3 py-2.5 text-[11px] text-ink-500">No Smart Run inputs detected for this flow.</p>
          )}
        </section>
      ) : (
        <section className="space-y-2">
          <div className="flex items-center gap-2 text-ink-400">
            <ShieldCheck className="h-3.5 w-3.5" />
            <span className="text-[11px] font-semibold uppercase tracking-wider">Quick run mode</span>
          </div>
          <p className="rounded-lg bg-[var(--surface-raised)] px-3 py-2.5 text-[11px] text-ink-500">
            Quick mode runs without custom run-input payload. If this flow requires inputs, preflight must still pass before cron can be enabled.
          </p>
        </section>
      )}

      <section className="space-y-3">
        <div className="flex items-center gap-2 text-ink-400">
          <Zap className="h-3.5 w-3.5" />
          <span className="text-[11px] font-semibold uppercase tracking-wider">Quick presets</span>
        </div>

        <RowActions
          presets={presets}
          schedule={schedule}
          readOnly={readOnly}
          onPresetSelect={(preset) => {
            onChange(
              withSchedule(draft, {
                enabled: canEnableSchedule,
                cron: preset.cron,
                timezone: preset.timezone,
                task: preset.task
              })
            );
          }}
        />
      </section>
    </fieldset>
  );
}
