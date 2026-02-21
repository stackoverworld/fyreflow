import {
  AlertTriangle,
  CheckCircle2,
  ClipboardList,
  Loader2,
  RefreshCw,
  RotateCcw,
  ShieldCheck,
  TextCursorInput,
  XCircle
} from "lucide-react";
import { Button } from "@/components/optics/button";
import { Input } from "@/components/optics/input";
import { Textarea } from "@/components/optics/textarea";
import { SegmentedControl } from "@/components/optics/segmented-control";
import type { Pipeline, PipelineRun, SmartRunPlan } from "@/lib/types";
import type { RunDraftState, RunMode } from "@/lib/runDraftStorage";
import { useRunPanelState } from "@/components/dashboard/run-panel/useRunPanelState";
import { RunPanelActions } from "@/components/dashboard/panels/run/RunPanelActions";

interface RunPanelProps {
  draftStorageKey: string | undefined;
  aiChatPending?: boolean;
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
  aiChatPending = false,
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
  const {
    task,
    setTask,
    mode,
    setMode,
    smartInputs,
    setSmartInputs,
    approvalNotes,
    setApprovalNotes,
    forgettingSecretKeys,
    canPauseActiveRun,
    canResumeActiveRun,
    canQuickRun,
    canSmartRun,
    controlsLocked,
    firstBlockingCheck,
    missingRequiredInputs,
    passCount,
    totalChecks,
    pendingApprovals,
    scopedRuns,
    runActive,
    refreshSmartRunPlan,
    forgetSecretInput
  } = useRunPanelState({
    draftStorageKey,
    aiChatPending,
    selectedPipeline,
    runs,
    smartRunPlan,
    loadingSmartRunPlan,
    onRefreshSmartRunPlan,
    onPause,
    onResume,
    activeRun,
    startingRun,
    stoppingRun,
    pausingRun,
    resumingRun,
    onForgetSecretInput,
    syncedMode,
    syncedInputs,
    onDraftStateChange
  });

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

      {aiChatPending && !runActive ? (
        <p className="mt-3 rounded-lg bg-amber-500/8 px-3 py-2 text-[11px] text-amber-300">
          AI chat is updating this flow. Running is temporarily disabled until the update completes.
        </p>
      ) : null}

      <div className="my-5 h-px bg-[var(--divider)]" />

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
          <div className="my-5 h-px bg-[var(--divider)]" />

          {/* ── Smart Preflight ── */}
          <section className="space-y-4">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 text-ink-400">
                <ShieldCheck className="h-3.5 w-3.5" />
                <span className="text-[11px] font-semibold uppercase tracking-wider">Preflight</span>
                {smartRunPlan ? (
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
                  await refreshSmartRunPlan({ force: true });
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

            {loadingSmartRunPlan && !smartRunPlan ? (
              <div className="flex items-center gap-2 rounded-lg bg-[var(--surface-raised)] px-3 py-3 text-xs text-ink-500">
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                Building smart run requirements...
              </div>
            ) : smartRunPlan ? (
              <div className="space-y-2">
                {loadingSmartRunPlan ? (
                  <div className="flex items-center gap-2 rounded-lg bg-[var(--surface-raised)] px-3 py-2 text-[11px] text-ink-500">
                    <Loader2 className="h-3 w-3 animate-spin" />
                    Refreshing preflight checks...
                  </div>
                ) : null}
                {(smartRunPlan.checks ?? []).map((check) => (
                  <div
                    key={check.id}
                    className="flex items-start gap-2.5 rounded-lg border border-ink-800/50 bg-[var(--surface-raised)] px-3 py-2.5"
                  >
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
              <p className="rounded-lg bg-[var(--surface-raised)] px-3 py-3 text-xs text-ink-500">
                Open a saved flow to compute smart run requirements.
              </p>
            )}
          </section>

          {smartRunPlan && smartRunPlan.fields.length > 0 ? (
            <>
              <div className="my-5 h-px bg-[var(--divider)]" />

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
                            await forgetSecretInput(field.key);
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

      <RunPanelActions
        mode={mode}
        task={task}
        smartInputs={smartInputs}
        runActive={runActive}
        activeRun={activeRun}
        startingRun={startingRun}
        stoppingRun={stoppingRun}
        pausingRun={pausingRun}
        resumingRun={resumingRun}
        canPauseActiveRun={canPauseActiveRun}
        canResumeActiveRun={canResumeActiveRun}
        canSmartRun={canSmartRun}
        canQuickRun={canQuickRun}
        loadingSmartRunPlan={loadingSmartRunPlan}
        smartRunPlan={smartRunPlan}
        firstBlockingCheck={firstBlockingCheck}
        approvalNotes={approvalNotes}
        setApprovalNotes={setApprovalNotes}
        resolvingApprovalId={resolvingApprovalId}
        pendingApprovals={pendingApprovals}
        scopedRuns={scopedRuns}
        onRun={onRun}
        onStop={onStop}
        onPause={onPause}
        onResume={onResume}
        onResolveApproval={onResolveApproval}
      />
    </div>
  );
}
