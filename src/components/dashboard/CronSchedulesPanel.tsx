import {
  CalendarClock,
  Clock3,
  Info,
  Loader2,
  RefreshCw,
  Settings2,
  ShieldCheck,
  TextCursorInput,
  Zap
} from "lucide-react";
import type { PipelinePayload, SmartRunPlan } from "@/lib/types";
import { Badge } from "@/components/optics/badge";
import { Button } from "@/components/optics/button";
import { Input } from "@/components/optics/input";
import { SegmentedControl, type Segment } from "@/components/optics/segmented-control";
import { Select } from "@/components/optics/select";
import { Switch } from "@/components/optics/switch";
import { cn } from "@/lib/cn";
import { getRunInputValue } from "@/lib/runInputAliases";
import { usePersistedTab } from "@/components/dashboard/usePersistedTab";
import { CronScheduleRow } from "@/components/dashboard/panels/cron/CronScheduleRow";
import { RowActions } from "@/components/dashboard/panels/cron/RowActions";
import {
  TIMEZONE_OPTIONS,
  describeCron,
  defaultSchedule,
  normalizeSchedule,
  withSchedule,
  withScheduleInput,
  type CronScheduleRunMode,
  presets
} from "@/components/dashboard/panels/cron/formatters";

export type { CronScheduleRunMode } from "@/components/dashboard/panels/cron/formatters";

/* ── Tab config ── */

type CronTab = "schedule" | "inputs";

const CRON_TABS = ["schedule", "inputs"] as const;

const TAB_SEGMENTS: Segment<CronTab>[] = [
  { value: "schedule", label: "Schedule", icon: <CalendarClock className="h-3.5 w-3.5" /> },
  { value: "inputs", label: "Inputs", icon: <TextCursorInput className="h-3.5 w-3.5" /> }
];

/* ── Panel ── */

interface CronSchedulesPanelProps {
  draft: PipelinePayload;
  pipelineId?: string;
  smartRunPlan: SmartRunPlan | null;
  loadingSmartRunPlan?: boolean;
  readOnly?: boolean;
  onChange: (next: PipelinePayload) => void;
  onRefreshSmartRunPlan?: (
    runMode: CronScheduleRunMode,
    inputs?: Record<string, string>,
    options?: { force?: boolean }
  ) => Promise<void>;
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
  const [activeTab, handleTabChange] = usePersistedTab<CronTab>("fyreflow:cron-tab", "schedule", CRON_TABS);

  const schedule = normalizeSchedule(draft.schedule);
  const passCount = (smartRunPlan?.checks ?? []).filter((c) => c.status === "pass").length;
  const totalChecks = (smartRunPlan?.checks ?? []).length;
  const failedChecks = (smartRunPlan?.checks ?? []).filter((c) => c.status === "fail");
  const firstFailure = failedChecks[0];
  const scheduleReady = Boolean(pipelineId && smartRunPlan && failedChecks.length === 0);
  const canEnableSchedule = scheduleReady && !loadingSmartRunPlan;
  const toggleDisabled = readOnly || (!schedule.enabled && !canEnableSchedule);
  const cronDescription = describeCron(schedule.cron);
  const timezoneInList = TIMEZONE_OPTIONS.some((o) => o.value === schedule.timezone);

  let preflightMessage = "";
  if (!pipelineId) {
    preflightMessage = "Save this flow first. Cron can run only for saved flows.";
  } else if (loadingSmartRunPlan) {
    preflightMessage = "Validating run requirements for cron...";
  } else if (!smartRunPlan) {
    preflightMessage = "Preflight not loaded yet.";
  } else if (firstFailure) {
    preflightMessage = `${firstFailure.title}: ${firstFailure.message}`;
  } else {
    preflightMessage = "Preflight passed. Cron can be enabled.";
  }

  return (
    <div className="flex h-full flex-col">
      {/* ── Sticky tab bar ── */}
      <div className="sticky top-0 z-10 border-b border-[var(--divider)] bg-[var(--surface-base)] px-3 py-2">
        <SegmentedControl segments={TAB_SEGMENTS} value={activeTab} onValueChange={handleTabChange} />
      </div>

      {/* ── Scrollable tab content ── */}
      <div className="flex-1 overflow-y-auto p-3">
        {readOnly && (
          <p className="mb-3 rounded-lg bg-amber-500/10 px-3 py-2 text-[11px] text-amber-500">
            This flow is running. Schedule edits are locked until the run finishes or is stopped.
          </p>
        )}

        {activeTab === "schedule" && (
          <fieldset disabled={readOnly} className={cn(readOnly && "opacity-70", "space-y-5")}>
            {/* ── Enable ── */}
            <section className="space-y-3">
              <div className="flex items-center gap-2 text-ink-400">
                <Settings2 className="h-3.5 w-3.5" />
                <span className="text-[11px] font-semibold uppercase tracking-wider">Schedule</span>
              </div>

              <div className="flex items-center gap-2">
                <Switch
                  checked={schedule.enabled}
                  disabled={toggleDisabled}
                  onChange={(checked) => {
                    if (checked && !canEnableSchedule) return;
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
                <div className="flex-1">
                  <p className="text-[13px] text-ink-100">Enable scheduled runs</p>
                  <p className="text-[11px] text-ink-500">Scheduler polls every 15 s.</p>
                </div>
                <Badge variant={schedule.enabled ? "success" : "neutral"}>{schedule.enabled ? "Active" : "Off"}</Badge>
              </div>

              {!schedule.enabled && !canEnableSchedule ? (
                <p className="text-[11px] text-red-400">{preflightMessage}</p>
              ) : null}
            </section>

            {/* ── Expression ── */}
            <section className="space-y-3">
              <div className="flex items-center gap-2 text-ink-400">
                <Clock3 className="h-3.5 w-3.5" />
                <span className="text-[11px] font-semibold uppercase tracking-wider">Expression</span>
              </div>

              <label className="block space-y-1.5">
                <Input
                  value={schedule.cron}
                  disabled={!schedule.enabled}
                  onChange={(e) => onChange(withSchedule(draft, { cron: e.target.value }))}
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

            {/* ── Timezone + Title ── */}
            <section className="space-y-3">
              <label className="block space-y-1.5">
                <span className="text-xs text-ink-400">Timezone</span>
                {timezoneInList ? (
                  <Select
                    value={schedule.timezone}
                    onValueChange={(v) => onChange(withSchedule(draft, { timezone: v }))}
                    options={TIMEZONE_OPTIONS}
                    disabled={!schedule.enabled}
                  />
                ) : (
                  <Input
                    value={schedule.timezone}
                    disabled={!schedule.enabled}
                    onChange={(e) => onChange(withSchedule(draft, { timezone: e.target.value }))}
                    placeholder="IANA timezone"
                  />
                )}
              </label>

              <label className="block space-y-1.5">
                <span className="text-xs text-ink-400">Run title</span>
                <Input
                  value={schedule.task}
                  disabled={!schedule.enabled}
                  onChange={(e) => onChange(withSchedule(draft, { task: e.target.value }))}
                  placeholder={`Scheduled run for "${draft.name || "Flow"}"`}
                />
              </label>
            </section>

            {/* ── Quick presets ── */}
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

            {/* ── How it works ── */}
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
          </fieldset>
        )}

        {activeTab === "inputs" && (
          <fieldset disabled={readOnly} className={cn(readOnly && "opacity-70", "space-y-5")}>
            {/* ── Run mode (pill toggle) + Preflight ── */}
            <section className="space-y-3">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 text-ink-400">
                  <ShieldCheck className="h-3.5 w-3.5" />
                  <span className="text-[11px] font-semibold uppercase tracking-wider">Preflight</span>
                </div>

                <div className="flex items-center gap-2">
                  <div className="flex items-center gap-0.5 rounded-lg bg-ink-900/60 p-0.5">
                    {(["smart", "quick"] as const).map((v) => (
                      <button
                        key={v}
                        type="button"
                        disabled={readOnly}
                        onClick={() => {
                          onChange(
                            withSchedule(draft, {
                              runMode: v,
                              enabled: false
                            })
                          );
                        }}
                        className={`rounded-md px-2.5 py-1 text-[11px] font-medium transition-colors cursor-pointer ${
                          schedule.runMode === v
                            ? "bg-ink-700/80 text-ink-100 shadow-sm"
                            : "text-ink-500 hover:text-ink-300"
                        } ${readOnly ? "cursor-not-allowed opacity-55" : ""}`}
                      >
                        {v === "smart" ? "Smart" : "Quick"}
                      </button>
                    ))}
                  </div>

                  <Button
                    size="sm"
                    variant="secondary"
                    disabled={!pipelineId || loadingSmartRunPlan}
                    onClick={async () => {
                      if (!onRefreshSmartRunPlan) return;
                      await onRefreshSmartRunPlan(
                        schedule.runMode,
                        schedule.runMode === "smart" ? schedule.inputs : {},
                        { force: true }
                      );
                    }}
                  >
                    {loadingSmartRunPlan ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
                    Refresh
                  </Button>
                </div>
              </div>

              <p className={cn("text-[11px]", firstFailure ? "text-red-400" : "text-ink-500")}>{preflightMessage}</p>
              {smartRunPlan && !loadingSmartRunPlan ? (
                <p className="text-[11px] text-ink-600">{passCount}/{totalChecks} preflight checks passed.</p>
              ) : null}
            </section>

            {/* ── Smart run inputs / Quick mode info ── */}
            {schedule.runMode === "smart" ? (
              <section className="space-y-3">
                <div className="flex items-center gap-2 text-ink-400">
                  <TextCursorInput className="h-3.5 w-3.5" />
                  <span className="text-[11px] font-semibold uppercase tracking-wider">Smart run inputs</span>
                </div>

                {!pipelineId ? (
                  <p className="rounded-lg bg-[var(--surface-raised)] px-3 py-2.5 text-[11px] text-ink-500">
                    Save flow to configure cron inputs.
                  </p>
                ) : loadingSmartRunPlan ? (
                  <div className="flex items-center gap-2 rounded-lg bg-[var(--surface-raised)] px-3 py-2.5 text-[11px] text-ink-500">
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    Loading smart run fields...
                  </div>
                ) : smartRunPlan && smartRunPlan.fields.length > 0 ? (
                  <div className="space-y-3">
                    {smartRunPlan.fields.map((field) => {
                      const check = smartRunPlan.checks.find(
                        (entry) => entry.id.toLowerCase() === `input:${field.key.toLowerCase()}`
                      );
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
                  <p className="rounded-lg bg-[var(--surface-raised)] px-3 py-2.5 text-[11px] text-ink-500">
                    No Smart Run inputs detected for this flow.
                  </p>
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
          </fieldset>
        )}
      </div>
    </div>
  );
}
