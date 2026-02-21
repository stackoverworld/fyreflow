import type { PipelinePayload, SmartRunPlan } from "@/lib/types";
import { CronSchedulesTable, type CronScheduleRunMode } from "@/components/dashboard/panels/cron/CronSchedulesTable";

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
  return (
    <CronSchedulesTable
      draft={draft}
      pipelineId={pipelineId}
      smartRunPlan={smartRunPlan}
      loadingSmartRunPlan={loadingSmartRunPlan}
      readOnly={readOnly}
      onChange={onChange}
      onRefreshSmartRunPlan={onRefreshSmartRunPlan}
    />
  );
}
