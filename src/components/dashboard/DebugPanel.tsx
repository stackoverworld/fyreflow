import {
  AlertTriangle,
  Check,
  CheckCircle2,
  ChevronDown,
  Clock3,
  Copy,
  Loader2,
  Radar,
  TerminalSquare,
  XCircle
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type { Pipeline, PipelineRun, RunStatus, SmartRunCheckStatus, SmartRunPlan, StepRunStatus } from "@/lib/types";
import { Badge } from "@/components/optics/badge";
import { Button } from "@/components/optics/button";
import { Tooltip } from "@/components/optics/tooltip";
import { cn } from "@/lib/cn";

type DebugSection = "trace" | "step" | "logs" | "preflight" | "timeline";

interface DebugPanelProps {
  selectedPipeline: Pipeline | undefined;
  runs: PipelineRun[];
  smartRunPlan: SmartRunPlan | null;
  loadingSmartRunPlan: boolean;
  startingRun: boolean;
}

function runBadgeVariant(status: RunStatus): "neutral" | "success" | "running" | "danger" | "warning" {
  if (status === "completed") {
    return "success";
  }
  if (status === "failed") {
    return "danger";
  }
  if (status === "running") {
    return "running";
  }
  return "warning";
}

function stepBadgeVariant(status: StepRunStatus): "neutral" | "success" | "running" | "danger" | "warning" {
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

function formatTime(value: string | undefined): string {
  if (!value) {
    return "n/a";
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "n/a";
  }
  return date.toLocaleString();
}

async function copyTextToClipboard(text: string): Promise<boolean> {
  try {
    if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }

    if (typeof document !== "undefined") {
      const helper = document.createElement("textarea");
      helper.value = text;
      helper.setAttribute("readonly", "");
      helper.style.position = "absolute";
      helper.style.left = "-9999px";
      document.body.appendChild(helper);
      helper.select();
      const copied = document.execCommand("copy");
      document.body.removeChild(helper);
      return copied;
    }

    return false;
  } catch {
    return false;
  }
}

export function DebugPanel({
  selectedPipeline,
  runs,
  smartRunPlan,
  loadingSmartRunPlan,
  startingRun
}: DebugPanelProps) {
  const [logsCopyState, setLogsCopyState] = useState<"idle" | "copied" | "error">("idle");
  const [stepCopyState, setStepCopyState] = useState<{ key: string; status: "copied" | "error" } | null>(null);
  const [collapsed, setCollapsed] = useState<Set<DebugSection>>(new Set());

  const toggle = (section: DebugSection) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(section)) {
        next.delete(section);
      } else {
        next.add(section);
      }
      return next;
    });
  };

  const scopedRuns = useMemo(() => {
    if (!selectedPipeline) {
      return [];
    }
    return runs.filter((run) => run.pipelineId === selectedPipeline.id).slice(0, 24);
  }, [runs, selectedPipeline]);

  const activeRun = useMemo(() => {
    const running = scopedRuns.find((run) => run.status === "running");
    if (running) {
      return running;
    }

    const awaiting = scopedRuns.find((run) => run.status === "awaiting_approval");
    if (awaiting) {
      return awaiting;
    }

    const paused = scopedRuns.find((run) => run.status === "paused");
    if (paused) {
      return paused;
    }

    const queued = scopedRuns.find((run) => run.status === "queued");
    if (queued) {
      return queued;
    }

    return scopedRuns[0] ?? null;
  }, [scopedRuns]);

  const activeStep = useMemo(() => {
    if (!activeRun) {
      return null;
    }
    return activeRun.steps.find((step) => step.status === "running") ?? null;
  }, [activeRun]);

  const passCount = (smartRunPlan?.checks ?? []).filter((check) => check.status === "pass").length;
  const blockedGateCount = useMemo(() => {
    if (!activeRun) {
      return 0;
    }

    return activeRun.steps.reduce((count, step) => {
      const failedBlocking = step.qualityGateResults.filter((gate) => gate.status === "fail" && gate.blocking).length;
      return count + failedBlocking;
    }, 0);
  }, [activeRun]);
  const recentLogs = activeRun?.logs.slice(-120) ?? [];
  const logsText = recentLogs.join("\n");

  useEffect(() => {
    if (logsCopyState === "idle") {
      return;
    }

    const timer = window.setTimeout(() => {
      setLogsCopyState("idle");
    }, 1800);

    return () => window.clearTimeout(timer);
  }, [logsCopyState]);

  useEffect(() => {
    if (!stepCopyState) {
      return;
    }

    const timer = window.setTimeout(() => {
      setStepCopyState(null);
    }, 1800);

    return () => window.clearTimeout(timer);
  }, [stepCopyState]);

  const handleCopyLogs = async () => {
    if (logsText.length === 0) {
      return;
    }

    const copied = await copyTextToClipboard(logsText);
    setLogsCopyState(copied ? "copied" : "error");
  };

  const handleCopyStepLogs = async (stepKey: string, output: string) => {
    if (output.length === 0) {
      return;
    }

    const copied = await copyTextToClipboard(output);
    setStepCopyState({ key: stepKey, status: copied ? "copied" : "error" });
  };

  return (
    <div>
      <section>
        <button type="button" onClick={() => toggle("trace")} className="flex w-full items-center justify-between text-left cursor-pointer mb-4">
          <div className="flex items-center gap-2 text-ink-400">
            <Radar className="h-3.5 w-3.5" />
            <span className="text-[11px] font-semibold uppercase tracking-wider">Runtime trace</span>
          </div>
          <ChevronDown className={cn("h-3.5 w-3.5 text-ink-600 transition-transform", !collapsed.has("trace") && "rotate-180")} />
        </button>

        {!collapsed.has("trace") && (
          !selectedPipeline ? (
            <div className="rounded-lg border border-ink-800/50 bg-ink-900/35 px-3 py-3 text-xs text-ink-500">
              Select a flow to inspect runtime activity.
            </div>
          ) : !activeRun ? (
            <div className="rounded-lg border border-ink-800/50 bg-ink-900/35 px-3 py-3 text-xs text-ink-500">
              {startingRun
                ? "Run request sent. Waiting for first runtime heartbeat..."
                : "No runs yet for this flow. Start a run to see live debug trace."}
            </div>
          ) : (
            <div className="space-y-2 rounded-lg border border-ink-800/50 bg-ink-900/35 px-3 py-3">
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

      <div className="my-5 h-px bg-ink-800/60" />

      <section>
        <button type="button" onClick={() => toggle("step")} className="flex w-full items-center justify-between text-left cursor-pointer mb-4">
          <div className="flex items-center gap-2 text-ink-400">
            <Clock3 className="h-3.5 w-3.5" />
            <span className="text-[11px] font-semibold uppercase tracking-wider">Current step</span>
          </div>
          <ChevronDown className={cn("h-3.5 w-3.5 text-ink-600 transition-transform", !collapsed.has("step") && "rotate-180")} />
        </button>

        {!collapsed.has("step") && (
          !activeStep ? (
            <div className="rounded-lg border border-ink-800/50 bg-ink-900/35 px-3 py-3 text-xs text-ink-500">
              No step is running right now.
            </div>
          ) : (
            <div className="space-y-2 rounded-lg border border-ink-800/50 bg-ink-900/35 px-3 py-3">
              <div className="flex items-center justify-between gap-2">
                <p className="text-xs font-medium text-ink-200">{activeStep.stepName}</p>
                <Badge variant={stepBadgeVariant(activeStep.status)}>{activeStep.status}</Badge>
              </div>
              <p className="text-[11px] text-ink-500">Attempts: {Math.max(1, activeStep.attempts)} · Outcome: {activeStep.workflowOutcome}</p>
              <p className="text-[11px] text-ink-500">Started: {formatTime(activeStep.startedAt)}</p>
              {activeStep.error ? <p className="text-[11px] text-red-400">{activeStep.error}</p> : null}
              {activeStep.output ? (
                <pre className="max-h-36 overflow-auto whitespace-pre-wrap rounded-md bg-ink-950/80 p-2 font-mono text-[11px] text-ink-400">
                  {activeStep.output}
                </pre>
              ) : null}
            </div>
          )
        )}
      </section>

      <div className="my-5 h-px bg-ink-800/60" />

      <section>
        <button type="button" onClick={() => toggle("logs")} className="flex w-full items-center justify-between text-left cursor-pointer mb-4">
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
                  onClick={() => void handleCopyLogs()}
                >
                  {logsCopyState === "copied" ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                </Button>
              </span>
            </Tooltip>
          </div>
        )}
      </section>

      <div className="my-5 h-px bg-ink-800/60" />

      <section>
        <button type="button" onClick={() => toggle("preflight")} className="flex w-full items-center justify-between text-left cursor-pointer mb-4">
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
            <div className="flex items-center gap-2 rounded-lg border border-ink-800/50 bg-ink-900/35 px-3 py-3 text-xs text-ink-500">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              Refreshing preflight snapshot...
            </div>
          ) : smartRunPlan ? (
            <div className="space-y-2">
              {smartRunPlan.checks.map((check) => (
                <div key={check.id} className="flex items-start gap-2.5 rounded-lg border border-ink-800/50 bg-ink-900/35 px-3 py-2.5">
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
            <div className="rounded-lg border border-ink-800/50 bg-ink-900/35 px-3 py-3 text-xs text-ink-500">
              No preflight plan available yet.
            </div>
          )
        )}
      </section>

      <div className="my-5 h-px bg-ink-800/60" />

      <section>
        <button type="button" onClick={() => toggle("timeline")} className="flex w-full items-center justify-between text-left cursor-pointer mb-3">
          <div className="flex items-center gap-2 text-ink-400">
            <TerminalSquare className="h-3.5 w-3.5" />
            <span className="text-[11px] font-semibold uppercase tracking-wider">Step timeline</span>
          </div>
          <ChevronDown className={cn("h-3.5 w-3.5 text-ink-600 transition-transform", !collapsed.has("timeline") && "rotate-180")} />
        </button>

        {!collapsed.has("timeline") && (!activeRun ? (
          <div className="rounded-lg border border-ink-800/50 bg-ink-900/35 px-3 py-3 text-xs text-ink-500">
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
                  <summary className="flex cursor-pointer list-none items-center justify-between gap-3 rounded-lg border border-ink-800/50 bg-ink-900/35 px-3 py-2.5 transition-colors hover:border-ink-700/60">
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
                        <pre className="max-h-32 overflow-auto whitespace-pre-wrap rounded-md bg-ink-950/80 p-2 pr-10 font-mono text-[11px] text-ink-400">
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
                              onClick={() => void handleCopyStepLogs(stepCopyKey, stepOutput)}
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
