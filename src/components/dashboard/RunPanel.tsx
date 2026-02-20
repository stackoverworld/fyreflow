import {
  AlertTriangle,
  CheckCircle2,
  ChevronRight,
  ClipboardList,
  Loader2,
  Play,
  RefreshCw,
  Rocket,
  ShieldCheck,
  TerminalSquare,
  TextCursorInput,
  XCircle
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type { Pipeline, PipelineRun, RunStatus, SmartRunPlan, StepRunStatus } from "@/lib/types";
import { Button } from "@/components/optics/button";
import { Input } from "@/components/optics/input";
import { Textarea } from "@/components/optics/textarea";
import { Badge } from "@/components/optics/badge";
import { SegmentedControl } from "@/components/optics/segmented-control";

interface RunPanelProps {
  selectedPipeline: Pipeline | undefined;
  runs: PipelineRun[];
  smartRunPlan: SmartRunPlan | null;
  loadingSmartRunPlan: boolean;
  onRefreshSmartRunPlan: (inputs?: Record<string, string>) => Promise<void>;
  onRun: (task: string, inputs?: Record<string, string>) => Promise<void>;
  running: boolean;
}

type RunMode = "smart" | "quick";
const runModeSegments = [
  { value: "smart" as const, label: "Smart Run" },
  { value: "quick" as const, label: "Quick Run" }
];

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

function preflightIcon(status: "pass" | "warn" | "fail") {
  if (status === "pass") {
    return <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-emerald-400" />;
  }
  if (status === "warn") {
    return <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-amber-400" />;
  }
  return <XCircle className="h-3.5 w-3.5 shrink-0 text-red-400" />;
}

export function RunPanel({
  selectedPipeline,
  runs,
  smartRunPlan,
  loadingSmartRunPlan,
  onRefreshSmartRunPlan,
  onRun,
  running
}: RunPanelProps) {
  const [task, setTask] = useState("");
  const [mode, setMode] = useState<RunMode>("smart");
  const [smartInputs, setSmartInputs] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!smartRunPlan) {
      setSmartInputs({});
      return;
    }

    setSmartInputs((current) => {
      const next: Record<string, string> = {};
      for (const field of smartRunPlan.fields) {
        next[field.key] = current[field.key] ?? "";
      }
      return next;
    });
  }, [smartRunPlan]);

  const scopedRuns = useMemo(() => {
    if (!selectedPipeline) {
      return [];
    }
    return runs.filter((run) => run.pipelineId === selectedPipeline.id).slice(0, 8);
  }, [runs, selectedPipeline]);

  const missingRequiredInputs = useMemo(() => {
    if (!smartRunPlan) {
      return [];
    }
    return smartRunPlan.fields.filter(
      (field) => field.required && (smartInputs[field.key] ?? "").trim().length === 0
    );
  }, [smartInputs, smartRunPlan]);

  const hasFailChecks = useMemo(
    () => (smartRunPlan?.checks ?? []).some((check) => check.status === "fail" && !check.id.startsWith("input:")),
    [smartRunPlan]
  );

  const canQuickRun = Boolean(selectedPipeline) && task.trim().length >= 5 && !running;
  const canSmartRun =
    Boolean(selectedPipeline) &&
    task.trim().length >= 5 &&
    !running &&
    !loadingSmartRunPlan &&
    Boolean(smartRunPlan) &&
    missingRequiredInputs.length === 0 &&
    !hasFailChecks;

  const passCount = (smartRunPlan?.checks ?? []).filter((c) => c.status === "pass").length;
  const totalChecks = (smartRunPlan?.checks ?? []).length;

  return (
    <div>
      <SegmentedControl segments={runModeSegments} value={mode} onValueChange={(value) => setMode(value as RunMode)} />

      <div className="my-5 h-px bg-ink-800/60" />

      {/* ── Task ── */}
      <section className="space-y-4">
        <div className="flex items-center gap-2 text-ink-400">
          <ClipboardList className="h-3.5 w-3.5" />
          <span className="text-[11px] font-semibold uppercase tracking-wider">Task</span>
        </div>

        <label className="block space-y-1.5">
          <span className="text-xs text-ink-400">What should this pipeline do?</span>
          <Textarea
            className="min-h-[88px]"
            value={task}
            onChange={(event) => setTask(event.target.value)}
            placeholder="Describe the task for this run..."
          />
          <p className="text-[11px] text-ink-600">Minimum 5 characters. Passed to the first step as {"{{task}}"}.</p>
        </label>
      </section>

      {mode === "smart" ? (
        <>
          <div className="my-5 h-px bg-ink-800/60" />

          {/* ── Smart Preflight ── */}
          <section className="space-y-4">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 text-ink-400">
                <ShieldCheck className="h-3.5 w-3.5" />
                <span className="text-[11px] font-semibold uppercase tracking-wider">Preflight</span>
                {smartRunPlan && !loadingSmartRunPlan ? (
                  <span className="text-[11px] text-ink-600">
                    {passCount}/{totalChecks} passed
                  </span>
                ) : null}
              </div>
              <Button
                size="sm"
                variant="secondary"
                disabled={!selectedPipeline || loadingSmartRunPlan}
                onClick={async () => {
                  await onRefreshSmartRunPlan(smartInputs);
                }}
              >
                {loadingSmartRunPlan ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <RefreshCw className="h-3.5 w-3.5" />
                )}
                Refresh
              </Button>
            </div>

            {loadingSmartRunPlan ? (
              <div className="flex items-center gap-2 rounded-lg bg-ink-900/35 px-3 py-3 text-xs text-ink-500">
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                Building smart run requirements...
              </div>
            ) : smartRunPlan ? (
              <div className="space-y-2">
                {(smartRunPlan.checks ?? []).map((check) => (
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
              <p className="rounded-lg bg-ink-900/35 px-3 py-3 text-xs text-ink-500">
                Open a saved flow to compute smart run requirements.
              </p>
            )}
          </section>

          {smartRunPlan && smartRunPlan.fields.length > 0 ? (
            <>
              <div className="my-5 h-px bg-ink-800/60" />

              {/* ── Run Inputs ── */}
              <section className="space-y-4">
                <div className="flex items-center gap-2 text-ink-400">
                  <TextCursorInput className="h-3.5 w-3.5" />
                  <span className="text-[11px] font-semibold uppercase tracking-wider">Run inputs</span>
                </div>

                {smartRunPlan.fields.map((field) => (
                  <label key={field.key} className="block space-y-1.5">
                    <span className="flex items-center gap-1 text-xs text-ink-400">
                      {field.label}
                      {field.required ? <span className="text-red-400">*</span> : null}
                    </span>

                    {field.type === "multiline" ? (
                      <Textarea
                        className="min-h-[72px]"
                        value={smartInputs[field.key] ?? ""}
                        onChange={(event) =>
                          setSmartInputs((current) => ({
                            ...current,
                            [field.key]: event.target.value
                          }))
                        }
                        placeholder={field.placeholder}
                      />
                    ) : (
                      <Input
                        type={field.type === "secret" ? "password" : field.type === "url" ? "url" : "text"}
                        value={smartInputs[field.key] ?? ""}
                        onChange={(event) =>
                          setSmartInputs((current) => ({
                            ...current,
                            [field.key]: event.target.value
                          }))
                        }
                        placeholder={field.placeholder}
                      />
                    )}

                    {field.description ? <p className="text-[11px] text-ink-600">{field.description}</p> : null}
                  </label>
                ))}

                {missingRequiredInputs.length > 0 ? (
                  <div className="flex items-start gap-2 rounded-lg bg-red-500/8 px-3 py-2 text-xs text-red-400">
                    <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
                    Missing required: {missingRequiredInputs.map((field) => field.label).join(", ")}
                  </div>
                ) : null}
              </section>
            </>
          ) : null}
        </>
      ) : null}

      <div className="my-5 h-px bg-ink-800/60" />

      {/* ── Execute ── */}
      <section className="space-y-3">
        <div className="flex items-center gap-2 text-ink-400">
          <Rocket className="h-3.5 w-3.5" />
          <span className="text-[11px] font-semibold uppercase tracking-wider">Execute</span>
        </div>

        <Button
          className="w-full"
          onClick={async () => {
            if (mode === "smart") {
              if (!canSmartRun) {
                return;
              }
              await onRun(task.trim(), smartInputs);
              setTask("");
              return;
            }

            if (!canQuickRun) {
              return;
            }

            await onRun(task.trim());
            setTask("");
          }}
          disabled={mode === "smart" ? !canSmartRun : !canQuickRun}
        >
          {running ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Play className="mr-2 h-4 w-4" />}
          {running ? "Starting..." : mode === "smart" ? "Start smart run" : "Start quick run"}
        </Button>
      </section>

      <div className="my-5 h-px bg-ink-800/60" />

      {/* ── Recent Runs ── */}
      <section className="space-y-3">
        <div className="flex items-center gap-2 text-ink-400">
          <TerminalSquare className="h-3.5 w-3.5" />
          <span className="text-[11px] font-semibold uppercase tracking-wider">Recent runs</span>
          {scopedRuns.length > 0 ? (
            <span className="text-[11px] text-ink-600">{scopedRuns.length} runs</span>
          ) : null}
        </div>

        {scopedRuns.length === 0 ? (
          <div className="rounded-lg border border-ink-800/50 bg-ink-900/35 px-3 py-4 text-center text-xs text-ink-500">
            No runs yet. Execute a run above to see history.
          </div>
        ) : (
          <div className="space-y-2">
            {scopedRuns.map((run) => (
              <details key={run.id} className="group" open={run.status === "running"}>
                <summary className="flex cursor-pointer list-none items-center justify-between gap-3 rounded-lg border border-ink-800/50 bg-ink-900/35 px-3 py-2.5 transition-colors hover:border-ink-700/60">
                  <div className="flex items-center gap-2.5 min-w-0">
                    <ChevronRight className="h-3 w-3 shrink-0 text-ink-600 transition-transform group-open:rotate-90" />
                    <div className="min-w-0">
                      <p className="truncate text-xs font-medium text-ink-200">{run.pipelineName}</p>
                      <p className="line-clamp-1 text-[11px] text-ink-500">{run.task}</p>
                    </div>
                  </div>
                  <Badge variant={runBadgeVariant(run.status)}>{run.status}</Badge>
                </summary>

                <div className="mt-1.5 space-y-2 rounded-lg border border-ink-800/30 bg-ink-950/40 p-2.5">
                  <p className="text-[11px] text-ink-500">Started {new Date(run.startedAt).toLocaleString()}</p>

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
                        <div className="space-y-1 rounded-md bg-ink-900/35 p-2">
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
                        <pre className="max-h-40 overflow-auto whitespace-pre-wrap rounded-md bg-ink-950/80 p-2 font-mono text-[11px] text-ink-400">
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
              </details>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
