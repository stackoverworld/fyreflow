import { ChevronDown, Clock3, Radar } from "lucide-react";

import { Badge } from "@/components/optics/badge";
import { cn } from "@/lib/cn";
import type { Pipeline, PipelineRun, RunStatus, StepRunStatus } from "@/lib/types";

import type { DebugSection } from "../../DebugPanel";

interface RunStateSectionProps {
  selectedPipeline: Pipeline | undefined;
  activeRun: PipelineRun | null;
  activeStep: PipelineRun["steps"][number] | null;
  startingRun: boolean;
  blockedGateCount: number;
  collapsed: Set<DebugSection>;
  onToggle: (section: DebugSection) => void;
  formatTime: (value: string | undefined) => string;
  runBadgeVariant: (status: RunStatus) => "neutral" | "success" | "running" | "danger" | "warning";
  stepBadgeVariant: (status: StepRunStatus) => "neutral" | "success" | "running" | "danger" | "warning";
}

export function RunStateSection({
  selectedPipeline,
  activeRun,
  activeStep,
  startingRun,
  blockedGateCount,
  collapsed,
  onToggle,
  formatTime,
  runBadgeVariant,
  stepBadgeVariant
}: RunStateSectionProps) {
  return (
    <div>
      <section>
        <button type="button" onClick={() => onToggle("trace")} className="flex w-full items-center justify-between text-left cursor-pointer mb-4">
          <div className="flex items-center gap-2 text-ink-400">
            <Radar className="h-3.5 w-3.5" />
            <span className="text-[11px] font-semibold uppercase tracking-wider">Runtime trace</span>
          </div>
          <ChevronDown className={cn("h-3.5 w-3.5 text-ink-600 transition-transform", !collapsed.has("trace") && "rotate-180")} />
        </button>

        {!collapsed.has("trace") && (
          !selectedPipeline ? (
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
          )
        )}
      </section>

      <div className="my-5 h-px bg-[var(--divider)]" />

      <section>
        <button type="button" onClick={() => onToggle("step")} className="flex w-full items-center justify-between text-left cursor-pointer mb-4">
          <div className="flex items-center gap-2 text-ink-400">
            <Clock3 className="h-3.5 w-3.5" />
            <span className="text-[11px] font-semibold uppercase tracking-wider">Current step</span>
          </div>
          <ChevronDown className={cn("h-3.5 w-3.5 text-ink-600 transition-transform", !collapsed.has("step") && "rotate-180")} />
        </button>

        {!collapsed.has("step") && (
          !activeStep ? (
            <div className="rounded-lg border border-ink-800/50 bg-[var(--surface-raised)] px-3 py-3 text-xs text-ink-500">
              No step is running right now.
            </div>
          ) : (
            <div className="space-y-2 rounded-lg border border-ink-800/50 bg-[var(--surface-raised)] px-3 py-3">
              <div className="flex items-center justify-between gap-2">
                <p className="text-xs font-medium text-ink-200">{activeStep.stepName}</p>
                <Badge variant={stepBadgeVariant(activeStep.status)}>{activeStep.status}</Badge>
              </div>
              <p className="text-[11px] text-ink-500">Attempts: {Math.max(1, activeStep.attempts)} · Outcome: {activeStep.workflowOutcome}</p>
              <p className="text-[11px] text-ink-500">Started: {formatTime(activeStep.startedAt)}</p>
              {activeStep.error ? <p className="text-[11px] text-red-400">{activeStep.error}</p> : null}
              {activeStep.output ? (
                <pre className="max-h-36 overflow-auto whitespace-pre-wrap rounded-md bg-[var(--surface-overlay)] p-2 font-mono text-[11px] text-ink-400">
                  {activeStep.output}
                </pre>
              ) : null}
            </div>
          )
        )}
      </section>
    </div>
  );
}
