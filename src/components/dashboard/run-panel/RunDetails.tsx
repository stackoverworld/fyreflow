import { TerminalSquare } from "lucide-react";
import { Badge } from "@/components/optics/badge";
import type { PipelineRun, StepRunStatus } from "@/lib/types";

const stepBadgeVariant = (status: StepRunStatus): "neutral" | "success" | "running" | "danger" | "warning" => {
  if (status === "completed") {
    return "success";
  }
  if (status === "failed") {
    return "danger";
  }
  if (status === "running") {
    return "running";
  }
  return "neutral";
};

interface RunDetailsProps {
  run: PipelineRun;
}

export function RunDetails({ run }: RunDetailsProps) {
  return (
    <div className="mt-1.5 space-y-2 rounded-lg border border-ink-800/30 bg-ink-950/40 p-2.5">
      <p className="text-[11px] text-ink-500">Started {new Date(run.startedAt).toLocaleString()}</p>

      {run.approvals.length > 0 ? (
        <div className="space-y-1 rounded-md bg-[var(--surface-raised)] p-2">
          <p className="text-[10px] uppercase tracking-wide text-ink-500">Approvals</p>
          {run.approvals.slice(-4).map((approval) => (
            <div key={approval.id} className="flex items-center justify-between gap-2">
              <p className="truncate text-[11px] text-ink-400">
                {approval.stepName}: {approval.gateName}
              </p>
              <Badge
                variant={
                  approval.status === "approved" ? "success" : approval.status === "rejected" ? "danger" : "warning"
                }
              >
                {approval.status}
              </Badge>
            </div>
          ))}
        </div>
      ) : null}

      {run.steps.map((step) => (
        <div key={step.stepId} className="space-y-1 border-l-2 border-ink-800 py-1 pl-3">
          <div className="flex items-center justify-between gap-2">
            <p className="text-xs font-medium text-ink-200">{step.stepName}</p>
            <Badge variant={stepBadgeVariant(step.status)}>{step.status}</Badge>
          </div>

          <p className="text-[11px] text-ink-500">
            Attempt {Math.max(1, step.attempts)} · Outcome {step.workflowOutcome}
          </p>

          {step.qualityGateResults && step.qualityGateResults.length > 0 ? (
            <div className="space-y-1 rounded-md bg-[var(--surface-raised)] p-2">
              <p className="text-[10px] uppercase tracking-wide text-ink-500">Quality gates</p>
              {step.qualityGateResults.map((gate) => (
                <div key={gate.gateId} className="flex items-start justify-between gap-2 text-[11px]">
                  <div className="min-w-0">
                    <p className="truncate text-ink-300">{gate.gateName}</p>
                    <p className="line-clamp-2 text-ink-600">{gate.message}</p>
                  </div>
                  <Badge variant={gate.status === "pass" ? "success" : gate.blocking ? "danger" : "warning"}>
                    {gate.status}
                  </Badge>
                </div>
              ))}
            </div>
          ) : null}

          {step.output ? (
            <pre className="max-h-40 overflow-auto whitespace-pre-wrap rounded-md bg-[var(--surface-overlay)] p-2 font-mono text-[11px] text-ink-400">
              {step.output}
            </pre>
          ) : null}

          {!step.output && step.status === "running" ? (
            <div className="flex items-center gap-2 text-xs text-ink-500">
              <TerminalSquare className="h-3 w-3 animate-pulse" />
              Executing...
            </div>
          ) : null}

          {step.error ? <p className="text-xs text-red-400">{step.error}</p> : null}
        </div>
      ))}
    </div>
  );
}
