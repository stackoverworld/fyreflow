import { Clock3, Radar } from "lucide-react";

import { Badge } from "@/components/optics/badge";
import { CollapsibleSection } from "@/components/dashboard/pipeline-editor/sections/CollapsibleSection";
import { usePersistedJsonState } from "@/components/dashboard/usePersistedJsonState";
import type { Pipeline, PipelineRun } from "@/lib/types";
import { formatTime, runBadgeVariant, stepBadgeVariant } from "../utils";

interface StateTabProps {
  selectedPipeline: Pipeline | undefined;
  activeRun: PipelineRun | null;
  activeStep: PipelineRun["steps"][number] | null;
  startingRun: boolean;
  blockedGateCount: number;
}

interface StateCollapsedState {
  trace: boolean;
  step: boolean;
}

const DEFAULT_COLLAPSED_STATE: StateCollapsedState = {
  trace: false,
  step: false
};

function isStateCollapsedState(value: unknown): value is StateCollapsedState {
  if (!value || typeof value !== "object") {
    return false;
  }

  const state = value as Partial<StateCollapsedState>;
  return typeof state.trace === "boolean" && typeof state.step === "boolean";
}

export function StateTab({
  selectedPipeline,
  activeRun,
  activeStep,
  startingRun,
  blockedGateCount
}: StateTabProps) {
  const [collapsed, setCollapsed] = usePersistedJsonState<StateCollapsedState>(
    "fyreflow:debug-state-collapsed",
    DEFAULT_COLLAPSED_STATE,
    isStateCollapsedState
  );

  return (
    <div>
      <CollapsibleSection
        icon={<Radar className="h-3.5 w-3.5" />}
        label="Runtime trace"
        collapsed={collapsed.trace}
        onToggle={() => setCollapsed((prev) => ({ ...prev, trace: !prev.trace }))}
      >
        {!selectedPipeline ? (
          <div className="rounded-lg border border-ink-800/50 bg-[var(--surface-raised)] px-3 py-3 text-xs text-ink-500">
            Select a flow to inspect runtime activity.
          </div>
        ) : !activeRun ? (
          <div className="rounded-lg border border-ink-800/50 bg-[var(--surface-raised)] px-3 py-3 text-xs text-ink-500">
            {startingRun
              ? "Run request sent. Waiting for first runtime heartbeat..."
              : "No runs yet for this flow. Start a run to see live debug trace."}
          </div>
        ) : (
          <div className="space-y-2 rounded-lg border border-ink-800/50 bg-[var(--surface-raised)] px-3 py-3">
            <div className="flex items-center justify-between gap-2">
              <p className="text-xs font-medium text-ink-200">Active run</p>
              <Badge variant={runBadgeVariant(activeRun.status)}>{activeRun.status}</Badge>
            </div>
            <p className="text-[11px] text-ink-500">Run ID: <span className="font-mono text-ink-400">{activeRun.id}</span></p>
            <p className="text-[11px] text-ink-500">Started: {formatTime(activeRun.startedAt)}</p>
            <p className="text-[11px] text-ink-500">Finished: {formatTime(activeRun.finishedAt)}</p>
            <p className="text-[11px] text-ink-500">
              Steps: {activeRun.steps.length} · Blocking gate fails: {blockedGateCount}
            </p>
            <p className="line-clamp-2 text-[11px] text-ink-500">Task: {activeRun.task || "(auto task)"}</p>
          </div>
        )}
      </CollapsibleSection>

      <CollapsibleSection
        icon={<Clock3 className="h-3.5 w-3.5" />}
        label="Current step"
        collapsed={collapsed.step}
        onToggle={() => setCollapsed((prev) => ({ ...prev, step: !prev.step }))}
      >
        {!activeStep ? (
          <div className="rounded-lg border border-ink-800/50 bg-[var(--surface-raised)] px-3 py-3 text-xs text-ink-500">
            No step is running right now.
          </div>
        ) : (
          <div className="space-y-2 rounded-lg border border-ink-800/50 bg-[var(--surface-raised)] px-3 py-3">
            <div className="flex items-center justify-between gap-2">
              <p className="text-xs font-medium text-ink-200">{activeStep.stepName}</p>
              <Badge variant={stepBadgeVariant(activeStep.status)}>{activeStep.status}</Badge>
            </div>
            <p className="text-[11px] text-ink-500">Attempts: {Math.max(1, activeStep.attempts)} · {activeStep.workflowOutcome === "pass" ? "Passed" : activeStep.workflowOutcome === "fail" ? "Failed" : "Pending"}</p>
            <p className="text-[11px] text-ink-500">Started: {formatTime(activeStep.startedAt)}</p>
            {activeStep.error ? <p className="text-[11px] text-red-400">{activeStep.error}</p> : null}
            {activeStep.output ? (
              <pre className="max-h-36 overflow-auto whitespace-pre-wrap rounded-md bg-[var(--surface-overlay)] p-2 font-mono text-[11px] text-ink-400">
                {activeStep.output}
              </pre>
            ) : null}
          </div>
        )}
      </CollapsibleSection>
    </div>
  );
}
