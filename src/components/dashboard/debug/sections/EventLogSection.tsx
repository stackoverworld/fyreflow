import {
  AlertTriangle,
  Check,
  CheckCircle2,
  ChevronDown,
  Copy,
  Loader2,
  TerminalSquare,
  XCircle
} from "lucide-react";

import { Badge } from "@/components/optics/badge";
import { Button } from "@/components/optics/button";
import { Tooltip } from "@/components/optics/tooltip";
import { cn } from "@/lib/cn";
import type { PipelineRun, SmartRunCheckStatus, SmartRunPlan, StepRunStatus } from "@/lib/types";

import type { DebugSection } from "../../DebugPanel";

interface EventLogSectionProps {
  activeRun: PipelineRun | null;
  smartRunPlan: SmartRunPlan | null;
  loadingSmartRunPlan: boolean;
  passCount: number;
  collapsed: Set<DebugSection>;
  onToggle: (section: DebugSection) => void;
  logsText: string;
  recentLogs: string[];
  logsCopyState: "idle" | "copied" | "error";
  stepCopyState: { key: string; status: "copied" | "error" } | null;
  formatTime: (value: string | undefined) => string;
  onCopyLogs: () => Promise<void>;
  onCopyStepLogs: (stepKey: string, output: string) => void;
  stepBadgeVariant: (status: StepRunStatus) => "neutral" | "success" | "running" | "danger" | "warning";
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

export function EventLogSection({
  activeRun,
  smartRunPlan,
  loadingSmartRunPlan,
  passCount,
  collapsed,
  onToggle,
  logsText,
  recentLogs,
  logsCopyState,
  stepCopyState,
  formatTime,
  onCopyLogs,
  onCopyStepLogs,
  stepBadgeVariant
}: EventLogSectionProps) {
  return (
    <div>
      <section>
        <button type="button" onClick={() => onToggle("logs")} className="flex w-full items-center justify-between text-left cursor-pointer mb-4">
          <div className="flex items-center gap-2 text-ink-400">
            <TerminalSquare className="h-3.5 w-3.5" />
            <span className="text-[11px] font-semibold uppercase tracking-wider">Live logs</span>
          </div>
          <ChevronDown className={cn("h-3.5 w-3.5 text-ink-600 transition-transform", !collapsed.has("logs") && "rotate-180")} />
        </button>

        {!collapsed.has("logs") && (
          <div className="relative">
            <pre className="max-h-48 overflow-auto whitespace-pre-wrap rounded-lg border border-ink-800/50 bg-ink-950/70 p-3 pr-12 font-mono text-[11px] text-ink-400">
              {recentLogs.length > 0 ? recentLogs.join("\n") : "No runtime logs yet."}
            </pre>

            <Tooltip
              side="left"
              content={
                logsCopyState === "copied"
                  ? "Copied"
                  : logsCopyState === "error"
                    ? "Copy failed"
                    : "Copy logs"
              }
            >
              <span className="absolute top-2 right-2">
                <Button
                  size="sm"
                  variant="secondary"
                  className="h-7 w-7 rounded-md border-ink-700/80 bg-ink-900/85 px-0"
                  aria-label="Copy live logs"
                  disabled={logsText.length === 0}
                  onClick={() => void onCopyLogs()}
                >
                  {logsCopyState === "copied" ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                </Button>
              </span>
            </Tooltip>
          </div>
        )}
      </section>

      <div className="my-5 h-px bg-[var(--divider)]" />

      <section>
        <button type="button" onClick={() => onToggle("preflight")} className="flex w-full items-center justify-between text-left cursor-pointer mb-4">
          <div className="flex items-center gap-2 text-ink-400">
            <CheckCircle2 className="h-3.5 w-3.5" />
            <span className="text-[11px] font-semibold uppercase tracking-wider">Preflight snapshot</span>
            {smartRunPlan && !loadingSmartRunPlan ? (
              <span className="text-[11px] text-ink-600">{passCount}/{smartRunPlan.checks.length} passed</span>
            ) : null}
          </div>
          <ChevronDown className={cn("h-3.5 w-3.5 text-ink-600 transition-transform", !collapsed.has("preflight") && "rotate-180")} />
        </button>

        {!collapsed.has("preflight") && (
          loadingSmartRunPlan ? (
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
          )
        )}
      </section>

      <div className="my-5 h-px bg-[var(--divider)]" />

      <section>
        <button type="button" onClick={() => onToggle("timeline")} className="flex w-full items-center justify-between text-left cursor-pointer mb-3">
          <div className="flex items-center gap-2 text-ink-400">
            <TerminalSquare className="h-3.5 w-3.5" />
            <span className="text-[11px] font-semibold uppercase tracking-wider">Step timeline</span>
          </div>
          <ChevronDown className={cn("h-3.5 w-3.5 text-ink-600 transition-transform", !collapsed.has("timeline") && "rotate-180")} />
        </button>

        {!collapsed.has("timeline") && (!activeRun ? (
          <div className="rounded-lg border border-ink-800/50 bg-[var(--surface-raised)] px-3 py-3 text-xs text-ink-500">
            Step timeline appears after first run.
          </div>
        ) : (
          <div className="space-y-2">
            {activeRun.steps.map((step) => {
              const stepCopyKey = `${step.stepId}:${step.startedAt ?? "n/a"}`;
              const stepCopyStatus = stepCopyState?.key === stepCopyKey ? stepCopyState.status : "idle";
              const stepOutput = step.output ?? "";

              return (
                <details key={stepCopyKey} className="group" open={step.status === "running"}>
                  <summary className="flex cursor-pointer list-none items-center justify-between gap-3 rounded-lg border border-ink-800/50 bg-[var(--surface-raised)] px-3 py-2.5 transition-colors hover:border-ink-700/60">
                    <div className="min-w-0">
                      <p className="truncate text-xs font-medium text-ink-200">{step.stepName}</p>
                      <p className="text-[11px] text-ink-500">attempt {Math.max(1, step.attempts)} · {step.workflowOutcome}</p>
                    </div>
                    <Badge variant={stepBadgeVariant(step.status)}>{step.status}</Badge>
                  </summary>

                  <div className="mt-1.5 space-y-1 rounded-lg border border-ink-800/30 bg-ink-950/40 p-2.5">
                    <p className="text-[11px] text-ink-500">Started: {formatTime(step.startedAt)}</p>
                    <p className="text-[11px] text-ink-500">Finished: {formatTime(step.finishedAt)}</p>
                    {step.error ? <p className="text-[11px] text-red-400">{step.error}</p> : null}
                    {step.output ? (
                      <div className="relative">
                        <pre className="max-h-32 overflow-auto whitespace-pre-wrap rounded-md bg-[var(--surface-overlay)] p-2 pr-10 font-mono text-[11px] text-ink-400">
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
                </details>
              );
            })}
          </div>
        ))}
      </section>
    </div>
  );
}
