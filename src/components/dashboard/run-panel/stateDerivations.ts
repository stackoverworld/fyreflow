import { useMemo } from "react";

import { getRunInputValue } from "@/lib/runInputAliases";
import type { Pipeline, PipelineRun, SmartRunPlan } from "@/lib/types";
import type { RunMode } from "@/lib/runDraftStorage";

interface UseRunPanelDerivationsArgs {
  activeRun: PipelineRun | null;
  aiChatPending: boolean;
  loadingSmartRunPlan: boolean;
  mode: RunMode;
  onPause?: (runId: string) => Promise<void>;
  onResume?: (runId: string) => Promise<void>;
  pausingRun: boolean;
  resumingRun: boolean;
  runs: PipelineRun[];
  selectedPipeline: Pipeline | undefined;
  smartInputs: Record<string, string>;
  smartRunPlan: SmartRunPlan | null;
  startingRun: boolean;
  stoppingRun: boolean;
  syncedInputs?: Record<string, string>;
}

export interface RunPanelDerivations {
  autoRefreshInputSignature: string;
  canPauseActiveRun: boolean;
  canQuickRun: boolean;
  canResumeActiveRun: boolean;
  canSmartRun: boolean;
  controlsLocked: boolean;
  firstBlockingCheck: SmartRunPlan["checks"][number] | undefined;
  hasMissingRequiredInputs: boolean;
  missingRequiredInputs: SmartRunPlan["fields"];
  passCount: number;
  pendingApprovals: PipelineRun["approvals"];
  runActive: boolean;
  scopedRuns: PipelineRun[];
  shouldRefreshMissingRequiredChecks: boolean;
  syncedInputsSignature: string;
  totalChecks: number;
}

export function useRunPanelDerivations({
  activeRun,
  aiChatPending,
  loadingSmartRunPlan,
  mode,
  onPause,
  onResume,
  pausingRun,
  resumingRun,
  runs,
  selectedPipeline,
  smartInputs,
  smartRunPlan,
  startingRun,
  stoppingRun,
  syncedInputs
}: UseRunPanelDerivationsArgs): RunPanelDerivations {
  const syncedInputsSignature = useMemo(() => {
    if (!syncedInputs) {
      return "";
    }

    return JSON.stringify(
      Object.entries(syncedInputs)
        .map(([key, value]) => [key.trim().toLowerCase(), value] as const)
        .sort(([left], [right]) => left.localeCompare(right))
    );
  }, [syncedInputs]);

  const autoRefreshInputSignature = useMemo(() => {
    if (!selectedPipeline || mode !== "smart") {
      return "";
    }

    const entries = Object.entries(smartInputs)
      .map(([key, value]) => [key.trim(), value] as const)
      .filter(([key]) => key.length > 0)
      .sort(([left], [right]) => left.localeCompare(right));

    return `${selectedPipeline.id}:${JSON.stringify(entries)}`;
  }, [mode, selectedPipeline, smartInputs]);

  const missingRequiredInputs = useMemo(() => {
    if (!smartRunPlan) {
      return [];
    }

    const failedRequiredKeys = new Set(
      smartRunPlan.checks
        .filter((check) => check.id.startsWith("input:") && check.status === "fail")
        .map((check) => check.id.replace(/^input:/, "").trim().toLowerCase())
    );

    return smartRunPlan.fields.filter((field) => field.required && failedRequiredKeys.has(field.key.toLowerCase()));
  }, [smartRunPlan]);

  const hasMissingRequiredInputs = missingRequiredInputs.length > 0;
  const shouldRefreshMissingRequiredChecks = useMemo(() => {
    if (!hasMissingRequiredInputs) {
      return false;
    }

    return missingRequiredInputs.some((field) => {
      const value = getRunInputValue(smartInputs, field.key);
      if (typeof value !== "string") {
        return false;
      }

      const normalized = value.trim();
      return normalized.length > 0 && normalized !== "[secure]";
    });
  }, [hasMissingRequiredInputs, missingRequiredInputs, smartInputs]);

  const scopedRuns = useMemo(() => {
    if (!selectedPipeline) {
      return [];
    }
    return runs.filter((run) => run.pipelineId === selectedPipeline.id).slice(0, 8);
  }, [runs, selectedPipeline]);

  const blockingChecks = useMemo(
    () => (smartRunPlan?.checks ?? []).filter((check) => check.status === "fail" && !check.id.startsWith("input:")),
    [smartRunPlan]
  );
  const hasFailChecks = blockingChecks.length > 0;
  const firstBlockingCheck = blockingChecks[0];

  const runActive = Boolean(activeRun);
  const controlsLocked = aiChatPending || runActive || startingRun || stoppingRun || pausingRun || resumingRun;
  const canQuickRun =
    Boolean(selectedPipeline) && !controlsLocked && !loadingSmartRunPlan && Boolean(smartRunPlan) && !hasFailChecks;
  const canSmartRun =
    Boolean(selectedPipeline) &&
    !controlsLocked &&
    !loadingSmartRunPlan &&
    Boolean(smartRunPlan) &&
    missingRequiredInputs.length === 0 &&
    !hasFailChecks;

  const passCount = (smartRunPlan?.checks ?? []).filter((c) => c.status === "pass").length;
  const totalChecks = (smartRunPlan?.checks ?? []).length;
  const pendingApprovals = activeRun?.approvals.filter((approval) => approval.status === "pending") ?? [];
  const canPauseActiveRun = Boolean(
    activeRun &&
      (activeRun.status === "queued" || activeRun.status === "running" || activeRun.status === "awaiting_approval") &&
      onPause
  );
  const canResumeActiveRun = Boolean(activeRun && activeRun.status === "paused" && onResume);

  return {
    autoRefreshInputSignature,
    canPauseActiveRun,
    canQuickRun,
    canResumeActiveRun,
    canSmartRun,
    controlsLocked,
    firstBlockingCheck,
    hasMissingRequiredInputs,
    missingRequiredInputs,
    passCount,
    pendingApprovals,
    runActive,
    scopedRuns,
    shouldRefreshMissingRequiredChecks,
    syncedInputsSignature,
    totalChecks
  };
}
