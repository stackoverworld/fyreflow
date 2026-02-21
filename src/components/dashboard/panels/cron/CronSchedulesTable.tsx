import { Info } from "lucide-react";
import type { PipelinePayload, SmartRunPlan } from "@/lib/types";
import { CronSchedulesToolbar } from "./CronSchedulesToolbar";
import { normalizeSchedule, type CronScheduleRunMode } from "./formatters";

export type { CronScheduleRunMode } from "./formatters";

interface CronSchedulesTableProps {
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

export function CronSchedulesTable({
  draft,
  pipelineId,
  smartRunPlan,
  loadingSmartRunPlan = false,
  readOnly = false,
  onChange,
  onRefreshSmartRunPlan
}: CronSchedulesTableProps) {
  const schedule = normalizeSchedule(draft.schedule);
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

      <CronSchedulesToolbar
        draft={draft}
        schedule={schedule}
        pipelineId={pipelineId}
        smartRunPlan={smartRunPlan}
        loadingSmartRunPlan={loadingSmartRunPlan}
        readOnly={readOnly}
        preflightMessage={preflightMessage}
        passCount={passCount}
        totalChecks={totalChecks}
        canEnableSchedule={canEnableSchedule}
        toggleDisabled={toggleDisabled}
        onChange={onChange}
        onRefreshSmartRunPlan={onRefreshSmartRunPlan}
      />

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
