import { useState } from "react";
import {
  AlertTriangle,
  Check,
  CheckCircle2,
  Copy,
  Loader2,
  TerminalSquare,
  XCircle
} from "lucide-react";
import { AnimatePresence, motion } from "motion/react";

import { Badge } from "@/components/optics/badge";
import { Button } from "@/components/optics/button";
import { Tooltip } from "@/components/optics/tooltip";
import { CollapsibleSection } from "@/components/dashboard/pipeline-editor/sections/CollapsibleSection";
import { usePersistedJsonState } from "@/components/dashboard/usePersistedJsonState";
import type { PipelineRun, SmartRunCheckStatus, SmartRunPlan } from "@/lib/types";
import { formatTime, stepBadgeVariant } from "../utils";

interface ChecksTabProps {
  activeRun: PipelineRun | null;
  smartRunPlan: SmartRunPlan | null;
  loadingSmartRunPlan: boolean;
  passCount: number;
  stepCopyState: { key: string; status: "copied" | "error" } | null;
  onCopyStepLogs: (stepKey: string, output: string) => void;
}

interface ChecksCollapsedState {
  preflight: boolean;
  timeline: boolean;
}

const DEFAULT_COLLAPSED_STATE: ChecksCollapsedState = {
  preflight: false,
  timeline: false
};

function isChecksCollapsedState(value: unknown): value is ChecksCollapsedState {
  if (!value || typeof value !== "object") {
    return false;
  }

  const state = value as Partial<ChecksCollapsedState>;
  return typeof state.preflight === "boolean" && typeof state.timeline === "boolean";
}

function preflightIcon(status: SmartRunCheckStatus) {
  if (status === "pass") {
    return <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-emerald-400" />;
  }
  if (status === "warn") {
    return <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-amber-400" />;
  }
  return <XCircle className="h-3.5 w-3.5 shrink-0 text-red-400" />;
}

export function ChecksTab({
  activeRun,
  smartRunPlan,
  loadingSmartRunPlan,
  passCount,
  stepCopyState,
  onCopyStepLogs
}: ChecksTabProps) {
  const [collapsed, setCollapsed] = usePersistedJsonState<ChecksCollapsedState>(
    "fyreflow:debug-checks-collapsed",
    DEFAULT_COLLAPSED_STATE,
    isChecksCollapsedState
  );

  const [expandedSteps, setExpandedSteps] = useState<Set<string>>(new Set());

  const toggleStep = (key: string) => {
    setExpandedSteps((prev) => {
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  };

  return (
    <div>
      <CollapsibleSection
        icon={<CheckCircle2 className="h-3.5 w-3.5" />}
        label="Preflight snapshot"
        collapsed={collapsed.preflight}
        onToggle={() => setCollapsed((prev) => ({ ...prev, preflight: !prev.preflight }))}
        badge={
          smartRunPlan && !loadingSmartRunPlan ? (
            <span className="text-[11px] text-ink-600">{passCount}/{smartRunPlan.checks.length} passed</span>
          ) : undefined
        }
      >
        {loadingSmartRunPlan ? (
          <div className="flex items-center gap-2 rounded-lg border border-ink-800/50 bg-[var(--surface-raised)] px-3 py-3 text-xs text-ink-500">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            Refreshing preflight snapshot...
          </div>
        ) : smartRunPlan ? (
          <div className="space-y-2">
            {smartRunPlan.checks.map((check) => (
              <div key={check.id} className="flex items-start gap-2.5 rounded-lg border border-ink-800/50 bg-[var(--surface-raised)] px-3 py-2.5">
                {preflightIcon(check.status)}
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-medium text-ink-200">{check.title}</p>
                  <p className="mt-0.5 text-[11px] text-ink-500">{check.message}</p>
                  {check.details ? <p className="mt-0.5 text-[11px] text-ink-600">{check.details}</p> : null}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="rounded-lg border border-ink-800/50 bg-[var(--surface-raised)] px-3 py-3 text-xs text-ink-500">
            No preflight plan available yet.
          </div>
        )}
      </CollapsibleSection>

      <CollapsibleSection
        icon={<TerminalSquare className="h-3.5 w-3.5" />}
        label="Step timeline"
        collapsed={collapsed.timeline}
        onToggle={() => setCollapsed((prev) => ({ ...prev, timeline: !prev.timeline }))}
      >
        {!activeRun ? (
          <div className="rounded-lg border border-ink-800/50 bg-[var(--surface-raised)] px-3 py-3 text-xs text-ink-500">
            Step timeline appears after first run.
          </div>
        ) : (
          <div className="space-y-2">
            {activeRun.steps.map((step) => {
              const stepCopyKey = `${step.stepId}:${step.startedAt ?? "n/a"}`;
              const stepCopyStatus = stepCopyState?.key === stepCopyKey ? stepCopyState.status : "idle";
              const stepOutput = step.output ?? "";
              const isRunning = step.status === "running";
              const isExpanded = isRunning || expandedSteps.has(stepCopyKey);

              return (
                <div key={stepCopyKey}>
                  <button
                    type="button"
                    onClick={() => toggleStep(stepCopyKey)}
                    className="flex w-full cursor-pointer items-center justify-between gap-3 rounded-lg border border-ink-800/50 bg-[var(--surface-raised)] px-3 py-2.5 text-left transition-colors hover:border-ink-700/60"
                  >
                    <div className="min-w-0">
                      <p className="truncate text-xs font-medium text-ink-200">{step.stepName}</p>
                      <p className="text-[11px] text-ink-500">attempt {Math.max(1, step.attempts)} · {step.workflowOutcome}</p>
                    </div>
                    <Badge variant={stepBadgeVariant(step.status)}>{step.status}</Badge>
                  </button>

                  <AnimatePresence initial={false}>
                    {isExpanded && (
                      <motion.div
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: "auto", opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
                        className="overflow-hidden"
                      >
                        <div className="mt-1.5 space-y-1 rounded-lg border border-ink-800/30 bg-ink-950/40 p-2.5">
                          <p className="text-[11px] text-ink-500">Started: {formatTime(step.startedAt)}</p>
                          <p className="text-[11px] text-ink-500">Finished: {formatTime(step.finishedAt)}</p>
                          {step.error ? <p className="text-[11px] text-red-400">{step.error}</p> : null}
                          {step.output ? (
                            <div className="relative">
                              <pre className="max-h-48 overflow-auto whitespace-pre-wrap rounded-md bg-[var(--surface-overlay)] p-2 pr-10 font-mono text-[11px] text-ink-400">
                                {step.output}
                              </pre>

                              <Tooltip
                                side="left"
                                content={
                                  stepCopyStatus === "copied"
                                    ? "Copied"
                                    : stepCopyStatus === "error"
                                      ? "Copy failed"
                                      : "Copy step logs"
                                }
                              >
                                <span className="absolute top-1.5 right-1.5">
                                  <Button
                                    size="sm"
                                    variant="secondary"
                                    className="h-7 w-7 rounded-md border-ink-700/80 bg-ink-900/85 px-0"
                                    aria-label={`Copy logs for ${step.stepName}`}
                                    onClick={() => onCopyStepLogs(stepCopyKey, stepOutput)}
                                  >
                                    {stepCopyStatus === "copied" ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
                                  </Button>
                                </span>
                              </Tooltip>
                            </div>
                          ) : null}
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              );
            })}
          </div>
        )}
      </CollapsibleSection>
    </div>
  );
}
