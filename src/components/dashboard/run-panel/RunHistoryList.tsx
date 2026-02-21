import { ChevronRight, TerminalSquare } from "lucide-react";
import { Badge } from "@/components/optics/badge";
import type { PipelineRun, RunStatus } from "@/lib/types";
import { RunDetails } from "./RunDetails";

const runBadgeVariant = (status: RunStatus): "neutral" | "success" | "running" | "danger" | "warning" => {
  if (status === "completed") {
    return "success";
  }
  if (status === "failed") {
    return "danger";
  }
  if (status === "cancelled") {
    return "warning";
  }
  if (status === "running") {
    return "running";
  }
  return "warning";
};

interface RunHistoryListProps {
  scopedRuns: PipelineRun[];
}

export function RunHistoryList({ scopedRuns }: RunHistoryListProps) {
  return (
    <section className="space-y-3">
      <div className="flex items-center gap-2 text-ink-400">
        <TerminalSquare className="h-3.5 w-3.5" />
        <span className="text-[11px] font-semibold uppercase tracking-wider">Recent runs</span>
        {scopedRuns.length > 0 ? <span className="text-[11px] text-ink-600">{scopedRuns.length} runs</span> : null}
      </div>

      {scopedRuns.length === 0 ? (
        <div className="rounded-lg border border-ink-800/50 bg-[var(--surface-raised)] px-3 py-4 text-center text-xs text-ink-500">
          No runs yet. Execute a run above to see history.
        </div>
      ) : (
        <div className="space-y-2">
          {scopedRuns.map((run) => (
            <details
              key={run.id}
              className="group"
              open={
                run.status === "running" ||
                run.status === "queued" ||
                run.status === "paused" ||
                run.status === "awaiting_approval"
              }
            >
              <summary className="flex cursor-pointer list-none items-center justify-between gap-3 rounded-lg border border-ink-800/50 bg-[var(--surface-raised)] px-3 py-2.5 transition-colors hover:border-ink-700/60">
                <div className="flex items-center gap-2.5 min-w-0">
                  <ChevronRight className="h-3 w-3 shrink-0 text-ink-600 transition-transform group-open:rotate-90" />
                  <div className="min-w-0">
                    <p className="truncate text-xs font-medium text-ink-200">{run.pipelineName}</p>
                    <p className="line-clamp-1 text-[11px] text-ink-500">{run.task}</p>
                  </div>
                </div>
                <Badge variant={runBadgeVariant(run.status)}>{run.status}</Badge>
              </summary>

              <RunDetails run={run} />
            </details>
          ))}
        </div>
      )}
    </section>
  );
}
