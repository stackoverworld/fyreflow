import { useMemo, useState } from "react";
import { ChevronRight, Clock, Radio, TerminalSquare } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { Badge } from "@/components/optics/badge";
import type { PipelineRun, RunStatus, StorageConfig } from "@/lib/types";
import { RunDetails } from "./RunDetails";

const ACTIVE_STATUSES: ReadonlySet<RunStatus> = new Set(["running", "queued", "paused", "awaiting_approval"]);

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
  isolatedEnabledStepIds?: ReadonlySet<string> | null;
  storageConfig: StorageConfig | null | undefined;
}

export function RunHistoryList({ scopedRuns, isolatedEnabledStepIds = null, storageConfig }: RunHistoryListProps) {
  const { activeRuns, pastRuns } = useMemo(() => {
    const active: PipelineRun[] = [];
    const past: PipelineRun[] = [];
    for (const run of scopedRuns) {
      if (ACTIVE_STATUSES.has(run.status)) {
        active.push(run);
      } else {
        past.push(run);
      }
    }
    return { activeRuns: active, pastRuns: past };
  }, [scopedRuns]);

  const autoExpanded = useMemo(
    () => new Set(activeRuns.map((r) => r.id)),
    [activeRuns]
  );

  const [manualToggled, setManualToggled] = useState<Set<string>>(new Set());

  const isExpanded = (id: string) => {
    if (manualToggled.has(id)) {
      return !autoExpanded.has(id);
    }
    return autoExpanded.has(id);
  };

  const toggle = (id: string) => {
    setManualToggled((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  if (scopedRuns.length === 0) {
    return (
      <section className="p-3">
        <div className="flex items-center gap-2 text-ink-400 mb-3">
          <TerminalSquare className="h-3.5 w-3.5" />
          <span className="text-[11px] font-semibold uppercase tracking-wider">Runs</span>
        </div>
        <div className="rounded-lg border border-ink-800/50 bg-[var(--surface-raised)] px-3 py-4 text-center text-xs text-ink-500">
          No runs yet. Start a run from the Launch tab to see history.
        </div>
      </section>
    );
  }

  return (
    <div className="space-y-1 p-3">
      {/* ── Active runs ── */}
      {activeRuns.length > 0 && (
        <section className="space-y-2">
          <div className="flex items-center gap-2 text-ink-400">
            <Radio className="h-3.5 w-3.5" />
            <span className="text-[11px] font-semibold uppercase tracking-wider">Active</span>
            <span className="text-[11px] text-ink-600">{activeRuns.length}</span>
          </div>

          <div className="space-y-2">
            {activeRuns.map((run) => {
              const expanded = isExpanded(run.id);
              return (
                <div key={run.id}>
                  <button
                    type="button"
                    onClick={() => toggle(run.id)}
                    className="flex w-full cursor-pointer items-center justify-between gap-3 rounded-lg border border-emerald-500/25 bg-emerald-500/[0.04] px-3 py-2.5 text-left transition-colors hover:border-emerald-500/40"
                  >
                    <div className="flex items-center gap-2.5 min-w-0">
                      <ChevronRight
                        className={`h-3 w-3 shrink-0 text-ink-600 transition-transform ${expanded ? "rotate-90" : ""}`}
                      />
                      <div className="min-w-0">
                        <p className="truncate text-xs font-medium text-ink-200">{run.pipelineName}</p>
                        <p className="line-clamp-1 text-[11px] text-ink-500">{run.task}</p>
                      </div>
                    </div>
                    <Badge variant={runBadgeVariant(run.status)}>{run.status}</Badge>
                  </button>

                  <AnimatePresence initial={false}>
                    {expanded && (
                      <motion.div
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: "auto", opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
                        className="overflow-hidden"
                      >
                        <RunDetails
                          run={run}
                          isolatedEnabledStepIds={isolatedEnabledStepIds}
                          storageConfig={storageConfig}
                        />
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              );
            })}
          </div>
        </section>
      )}

      {/* ── Separator ── */}
      {activeRuns.length > 0 && pastRuns.length > 0 && (
        <div className="h-px bg-ink-800/50 my-3" />
      )}

      {/* ── Past runs ── */}
      {pastRuns.length > 0 && (
        <section className="space-y-2">
          <div className="flex items-center gap-2 text-ink-400">
            <Clock className="h-3.5 w-3.5" />
            <span className="text-[11px] font-semibold uppercase tracking-wider">Past runs</span>
            <span className="text-[11px] text-ink-600">{pastRuns.length}</span>
          </div>

          <div className="space-y-2">
            {pastRuns.map((run) => {
              const expanded = isExpanded(run.id);
              return (
                <div key={run.id}>
                  <button
                    type="button"
                    onClick={() => toggle(run.id)}
                    className="flex w-full cursor-pointer items-center justify-between gap-3 rounded-lg border border-ink-800/50 bg-[var(--surface-raised)] px-3 py-2.5 text-left transition-colors hover:border-ink-700/60"
                  >
                    <div className="flex items-center gap-2.5 min-w-0">
                      <ChevronRight
                        className={`h-3 w-3 shrink-0 text-ink-600 transition-transform ${expanded ? "rotate-90" : ""}`}
                      />
                      <div className="min-w-0">
                        <p className="truncate text-xs font-medium text-ink-200">{run.pipelineName}</p>
                        <p className="line-clamp-1 text-[11px] text-ink-500">{run.task}</p>
                      </div>
                    </div>
                    <Badge variant={runBadgeVariant(run.status)}>{run.status}</Badge>
                  </button>

                  <AnimatePresence initial={false}>
                    {expanded && (
                      <motion.div
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: "auto", opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
                        className="overflow-hidden"
                      >
                        <RunDetails
                          run={run}
                          isolatedEnabledStepIds={isolatedEnabledStepIds}
                          storageConfig={storageConfig}
                        />
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              );
            })}
          </div>
        </section>
      )}
    </div>
  );
}
