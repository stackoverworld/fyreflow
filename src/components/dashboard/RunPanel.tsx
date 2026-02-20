import {
  AlertTriangle,
  CheckCircle2,
  ChevronRight,
  ClipboardList,
  Loader2,
  Pause,
  Play,
  RefreshCw,
  Rocket,
  RotateCcw,
  Square,
  ShieldCheck,
  TerminalSquare,
  TextCursorInput,
  XCircle
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { Pipeline, PipelineRun, RunStatus, SmartRunPlan, StepRunStatus } from "@/lib/types";
import { Button } from "@/components/optics/button";
import { Input } from "@/components/optics/input";
import { Textarea } from "@/components/optics/textarea";
import { Badge } from "@/components/optics/badge";
import { SegmentedControl } from "@/components/optics/segmented-control";
import { loadRunDraft, saveRunDraft, type RunDraftState, type RunMode } from "@/lib/runDraftStorage";
import { getRunInputValue, normalizeRunInputKey } from "@/lib/runInputAliases";

interface RunPanelProps {
  draftStorageKey: string | undefined;
  selectedPipeline: Pipeline | undefined;
  runs: PipelineRun[];
  smartRunPlan: SmartRunPlan | null;
  loadingSmartRunPlan: boolean;
  onRefreshSmartRunPlan: (inputs?: Record<string, string>, options?: { force?: boolean }) => Promise<void>;
  onRun: (task: string, inputs?: Record<string, string>) => Promise<void>;
  onStop: (runId: string) => Promise<void>;
  onPause?: (runId: string) => Promise<void>;
  onResume?: (runId: string) => Promise<void>;
  onResolveApproval?: (
    runId: string,
    approvalId: string,
    decision: "approved" | "rejected",
    note?: string
  ) => Promise<void>;
  onForgetSecretInput?: (key: string) => Promise<void>;
  activeRun: PipelineRun | null;
  startingRun: boolean;
  stoppingRun: boolean;
  pausingRun?: boolean;
  resumingRun?: boolean;
  resolvingApprovalId?: string | null;
  syncedMode?: RunMode;
  syncedInputs?: Record<string, string>;
  onDraftStateChange?: (draft: RunDraftState) => void;
}

const runModeSegments = [
  { value: "smart" as const, label: "Smart Run" },
  { value: "quick" as const, label: "Quick Run" }
];
const AUTO_PREFLIGHT_REFRESH_DEBOUNCE_MS = 900;

function runBadgeVariant(status: RunStatus): "neutral" | "success" | "running" | "danger" | "warning" {
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
  draftStorageKey,
  selectedPipeline,
  runs,
  smartRunPlan,
  loadingSmartRunPlan,
  onRefreshSmartRunPlan,
  onRun,
  onStop,
  onPause,
  onResume,
  onResolveApproval,
  onForgetSecretInput,
  activeRun,
  startingRun,
  stoppingRun,
  pausingRun = false,
  resumingRun = false,
  resolvingApprovalId = null,
  syncedMode,
  syncedInputs,
  onDraftStateChange
}: RunPanelProps) {
  const [task, setTask] = useState("");
  const [mode, setMode] = useState<RunMode>("smart");
  const [smartInputs, setSmartInputs] = useState<Record<string, string>>({});
  const [approvalNotes, setApprovalNotes] = useState<Record<string, string>>({});
  const [forgettingSecretKeys, setForgettingSecretKeys] = useState<Record<string, boolean>>({});
  const [draftHydrated, setDraftHydrated] = useState(false);
  const smartInputsRef = useRef<Record<string, string>>({});
  const onRefreshSmartRunPlanRef = useRef(onRefreshSmartRunPlan);
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

  useEffect(() => {
    smartInputsRef.current = smartInputs;
  }, [smartInputs]);

  useEffect(() => {
    onRefreshSmartRunPlanRef.current = onRefreshSmartRunPlan;
  }, [onRefreshSmartRunPlan]);

  useEffect(() => {
    setDraftHydrated(false);
    const draft = loadRunDraft(draftStorageKey);
    setTask(draft.task);
    setMode(draft.mode);
    setSmartInputs(draft.inputs);
    setDraftHydrated(true);
  }, [draftStorageKey]);

  useEffect(() => {
    if (!draftHydrated) {
      return;
    }

    const nextDraft: RunDraftState = {
      task,
      mode,
      inputs: smartInputs
    };
    saveRunDraft(draftStorageKey, nextDraft);
    onDraftStateChange?.(nextDraft);
  }, [draftHydrated, draftStorageKey, mode, onDraftStateChange, smartInputs, task]);

  useEffect(() => {
    if (!draftHydrated || !syncedMode) {
      return;
    }

    setMode((current) => (current === syncedMode ? current : syncedMode));
  }, [draftHydrated, syncedMode]);

  useEffect(() => {
    if (!draftHydrated || !syncedInputs || syncedInputsSignature.length === 0) {
      return;
    }

    setSmartInputs((current) => {
      const next: Record<string, string> = { ...current };
      let changed = false;
      for (const [rawKey, value] of Object.entries(syncedInputs)) {
        const key = normalizeRunInputKey(rawKey);
        if (key.length === 0) {
          continue;
        }
        if (next[key] === value) {
          continue;
        }
        next[key] = value;
        changed = true;
      }
      return changed ? next : current;
    });
  }, [draftHydrated, syncedInputs, syncedInputsSignature]);

  useEffect(() => {
    if (!smartRunPlan) {
      return;
    }

    setSmartInputs((current) => {
      const next: Record<string, string> = { ...current };
      let changed = false;
      for (const field of smartRunPlan.fields) {
        if (next[field.key] === undefined) {
          next[field.key] = getRunInputValue(next, field.key) ?? "";
          changed = true;
        }
      }
      return changed ? next : current;
    });
  }, [smartRunPlan]);

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

    return smartRunPlan.fields.filter(
      (field) => field.required && failedRequiredKeys.has(field.key.toLowerCase())
    );
  }, [smartRunPlan]);

  const hasMissingRequiredInputs = missingRequiredInputs.length > 0;
  const shouldRefreshMissingRequiredChecks = useMemo(() => {
    if (missingRequiredInputs.length === 0) {
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
  }, [missingRequiredInputs, smartInputs]);

  useEffect(() => {
    if (
      !draftHydrated ||
      autoRefreshInputSignature.length === 0 ||
      loadingSmartRunPlan ||
      Boolean(activeRun) ||
      startingRun ||
      stoppingRun ||
      (hasMissingRequiredInputs && !shouldRefreshMissingRequiredChecks)
    ) {
      return;
    }

    const timer = window.setTimeout(() => {
      void onRefreshSmartRunPlanRef.current(smartInputsRef.current);
    }, AUTO_PREFLIGHT_REFRESH_DEBOUNCE_MS);

    return () => window.clearTimeout(timer);
  }, [
    activeRun,
    autoRefreshInputSignature,
    draftHydrated,
    hasMissingRequiredInputs,
    loadingSmartRunPlan,
    shouldRefreshMissingRequiredChecks,
    startingRun,
    stoppingRun
  ]);

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
  const controlsLocked = runActive || startingRun || stoppingRun || pausingRun || resumingRun;
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

  return (
    <div>
      <SegmentedControl
        segments={runModeSegments}
        value={mode}
        disabled={controlsLocked}
        onValueChange={(value) => setMode(value as RunMode)}
      />

      {runActive ? (
        <p className="mt-3 rounded-lg bg-amber-500/8 px-3 py-2 text-[11px] text-amber-300">
          This flow has an active run ({activeRun?.status}). Run inputs and pipeline edits are locked for this flow.
        </p>
      ) : null}

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
            disabled={controlsLocked}
            onChange={(event) => setTask(event.target.value)}
            placeholder="Describe the task for this run..."
          />
          <p className="text-[11px] text-ink-600">Optional. Passed to the first step as {"{{task}}"} (auto-filled if empty).</p>
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
                disabled={!selectedPipeline || loadingSmartRunPlan || controlsLocked}
                onClick={async () => {
                  await onRefreshSmartRunPlan(smartInputs, { force: true });
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
                    <div className="flex items-center justify-between gap-2">
                      <span className="flex items-center gap-1 text-xs text-ink-400">
                        {field.label}
                        {field.required ? <span className="text-red-400">*</span> : null}
                      </span>
                      {field.type === "secret" && onForgetSecretInput ? (
                        <Button
                          size="sm"
                          variant="ghost"
                          disabled={controlsLocked || forgettingSecretKeys[field.key] === true}
                          onClick={async () => {
                            setForgettingSecretKeys((current) => ({
                              ...current,
                              [field.key]: true
                            }));
                            try {
                              await onForgetSecretInput(field.key);
                              const nextInputs: Record<string, string> = {
                                ...smartInputsRef.current,
                                [field.key]: ""
                              };
                              smartInputsRef.current = nextInputs;
                              setSmartInputs(nextInputs);
                              await onRefreshSmartRunPlan(nextInputs, { force: true });
                            } finally {
                              setForgettingSecretKeys((current) => ({
                                ...current,
                                [field.key]: false
                              }));
                            }
                          }}
                        >
                          <RotateCcw className="h-3.5 w-3.5" />
                          {forgettingSecretKeys[field.key] ? "Forgetting..." : "Forget saved"}
                        </Button>
                      ) : null}
                    </div>

                    {field.type === "multiline" ? (
                      <Textarea
                        className="min-h-[72px]"
                        value={smartInputs[field.key] ?? ""}
                        disabled={controlsLocked}
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
                        disabled={controlsLocked}
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
          variant={runActive ? "danger" : undefined}
          onClick={async () => {
            if (runActive) {
              if (!activeRun || stoppingRun) {
                return;
              }
              await onStop(activeRun.id);
              return;
            }

            if (mode === "smart") {
              if (!canSmartRun) {
                return;
              }
              await onRun(task.trim(), smartInputs);
              return;
            }

            if (!canQuickRun) {
              return;
            }

            await onRun(task.trim());
          }}
          disabled={runActive ? stoppingRun || pausingRun || resumingRun : mode === "smart" ? !canSmartRun : !canQuickRun}
        >
          {runActive ? (
            stoppingRun || pausingRun || resumingRun ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <Square className="mr-2 h-4 w-4" />
            )
          ) : startingRun ? (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          ) : (
            <Play className="mr-2 h-4 w-4" />
          )}
          {runActive
            ? stoppingRun
              ? "Stopping..."
              : pausingRun
                ? "Pausing..."
                : resumingRun
                  ? "Resuming..."
                  : "Stop run"
            : startingRun
              ? "Starting..."
              : mode === "smart"
                ? "Start smart run"
                : "Start quick run"}
        </Button>

        {!runActive && mode === "quick" && loadingSmartRunPlan ? (
          <div className="flex items-start gap-2 rounded-lg bg-ink-900/35 px-3 py-2 text-xs text-ink-500">
            <Loader2 className="mt-0.5 h-3.5 w-3.5 shrink-0 animate-spin" />
            Checking preflight requirements for quick run...
          </div>
        ) : null}

        {!runActive && mode === "quick" && !loadingSmartRunPlan && !smartRunPlan ? (
          <div className="flex items-start gap-2 rounded-lg bg-red-500/8 px-3 py-2 text-xs text-red-400">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            Preflight is unavailable. Save the flow and refresh requirements before running.
          </div>
        ) : null}

        {!runActive && mode === "quick" && !loadingSmartRunPlan && firstBlockingCheck ? (
          <div className="flex items-start gap-2 rounded-lg bg-red-500/8 px-3 py-2 text-xs text-red-400">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <div className="min-w-0">
              <p>{`${firstBlockingCheck.title}: ${firstBlockingCheck.message}`}</p>
              {firstBlockingCheck.details ? <p className="mt-0.5 text-[11px] text-red-300">{firstBlockingCheck.details}</p> : null}
            </div>
          </div>
        ) : null}

        {runActive && (canPauseActiveRun || canResumeActiveRun) ? (
          <Button
            className="w-full"
            variant="secondary"
            disabled={stoppingRun || pausingRun || resumingRun}
            onClick={async () => {
              if (!activeRun) {
                return;
              }

              if (canPauseActiveRun && onPause) {
                await onPause(activeRun.id);
                return;
              }

              if (canResumeActiveRun && onResume) {
                await onResume(activeRun.id);
              }
            }}
          >
            {pausingRun || resumingRun ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : canPauseActiveRun ? (
              <Pause className="mr-2 h-4 w-4" />
            ) : (
              <Play className="mr-2 h-4 w-4" />
            )}
            {pausingRun
              ? "Pausing..."
              : resumingRun
                ? "Resuming..."
                : canPauseActiveRun
                  ? "Pause run"
                  : "Resume run"}
          </Button>
        ) : null}

        {runActive && pendingApprovals.length > 0 ? (
          <div className="space-y-2 rounded-lg border border-amber-500/20 bg-amber-500/5 p-2.5">
            <p className="text-[11px] font-medium text-amber-200">Manual approvals required</p>

            {pendingApprovals.map((approval) => {
              const busy = resolvingApprovalId === approval.id;
              return (
                <div key={approval.id} className="rounded-md bg-ink-950/50 p-2">
                  <p className="text-xs font-medium text-ink-200">{approval.gateName}</p>
                  <p className="mt-0.5 text-[11px] text-ink-500">{approval.stepName}</p>
                  <p className="mt-0.5 text-[11px] text-ink-500">{approval.message || "Manual decision required."}</p>

                  <Input
                    className="mt-2"
                    value={approvalNotes[approval.id] ?? ""}
                    disabled={busy || !onResolveApproval}
                    onChange={(event) =>
                      setApprovalNotes((current) => ({
                        ...current,
                        [approval.id]: event.target.value
                      }))
                    }
                    placeholder="Optional note for this decision"
                  />

                  <div className="mt-2 grid grid-cols-2 gap-2">
                    <Button
                      size="sm"
                      variant="secondary"
                      disabled={busy || !onResolveApproval || !activeRun}
                      onClick={async () => {
                        if (!onResolveApproval || !activeRun) {
                          return;
                        }

                        await onResolveApproval(
                          activeRun.id,
                          approval.id,
                          "approved",
                          approvalNotes[approval.id]
                        );
                      }}
                    >
                      {busy ? <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" /> : null}
                      Approve
                    </Button>
                    <Button
                      size="sm"
                      variant="danger"
                      disabled={busy || !onResolveApproval || !activeRun}
                      onClick={async () => {
                        if (!onResolveApproval || !activeRun) {
                          return;
                        }

                        await onResolveApproval(
                          activeRun.id,
                          approval.id,
                          "rejected",
                          approvalNotes[approval.id]
                        );
                      }}
                    >
                      {busy ? <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" /> : null}
                      Reject
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>
        ) : null}
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

                  {run.approvals.length > 0 ? (
                    <div className="space-y-1 rounded-md bg-ink-900/35 p-2">
                      <p className="text-[10px] uppercase tracking-wide text-ink-500">Approvals</p>
                      {run.approvals.slice(-4).map((approval) => (
                        <div key={approval.id} className="flex items-center justify-between gap-2">
                          <p className="truncate text-[11px] text-ink-400">
                            {approval.stepName}: {approval.gateName}
                          </p>
                          <Badge
                            variant={
                              approval.status === "approved"
                                ? "success"
                                : approval.status === "rejected"
                                  ? "danger"
                                  : "warning"
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
