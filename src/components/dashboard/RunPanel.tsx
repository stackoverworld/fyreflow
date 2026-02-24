import {
  AlertTriangle,
  CheckCircle2,
  ClipboardList,
  FolderOpen,
  History,
  Loader2,
  RefreshCw,
  Rocket,
  RotateCcw,
  ShieldCheck,
  TextCursorInput,
  XCircle
} from "lucide-react";
import { useMemo } from "react";
import { Button } from "@/components/optics/button";
import { Input } from "@/components/optics/input";
import { Textarea } from "@/components/optics/textarea";
import { SegmentedControl, type Segment } from "@/components/optics/segmented-control";
import type { Pipeline, PipelineRun, SmartRunPlan } from "@/lib/types";
import type { RunDraftState, RunMode } from "@/lib/runDraftStorage";
import { usePersistedTab } from "@/components/dashboard/usePersistedTab";
import { useRunPanelState } from "@/components/dashboard/run-panel/useRunPanelState";
import { useIconSpin } from "@/lib/useIconSpin";
import { RunPanelActions } from "@/components/dashboard/panels/run/RunPanelActions";
import { RunHistoryList } from "@/components/dashboard/run-panel/RunHistoryList";
import { RunSessionCard } from "@/components/dashboard/run-panel/RunSessionCard";
import type { StorageConfig } from "@/lib/types";

/* ── Tab config ── */

type RunTab = "launch" | "history";

const RUN_TABS = ["launch", "history"] as const;

const TAB_SEGMENTS: Segment<RunTab>[] = [
  { value: "launch", label: "Launch", icon: <Rocket className="h-3.5 w-3.5" /> },
  { value: "history", label: "History", icon: <History className="h-3.5 w-3.5" /> }
];

const MODE_SEGMENTS: Segment<RunMode>[] = [
  { value: "smart", label: "Smart" },
  { value: "quick", label: "Quick" }
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

/* ── Props ── */

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
  storageConfig?: StorageConfig | null;
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
  onDraftStateChange,
  storageConfig = null
}: RunPanelProps) {
  const [activeTab, handleTabChange] = usePersistedTab<RunTab>("fyreflow:run-tab", "launch", RUN_TABS);
  const { rotation: refreshRotation, triggerSpin: triggerRefreshSpin } = useIconSpin();
  const isolatedEnabledStepIds = useMemo(() => {
    if (!selectedPipeline) {
      return null;
    }

    const stepIds = selectedPipeline.steps
      .filter((step) => step.enableIsolatedStorage)
      .map((step) => step.id.trim())
      .filter((stepId) => stepId.length > 0);
    return new Set(stepIds);
  }, [selectedPipeline]);

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
    <div className="flex h-full flex-col">
      {/* ── Sticky tab bar ── */}
      <div className="sticky top-0 z-10 border-b border-[var(--divider)] bg-[var(--surface-base)] px-3 py-2">
        <SegmentedControl segments={TAB_SEGMENTS} value={activeTab} onValueChange={handleTabChange} />
      </div>

      {/* ── Scrollable tab content ── */}
      <div className="flex-1 overflow-y-auto">
        {activeTab === "launch" && (
          <div className="p-3">
            {runActive ? (
              <p className="rounded-lg bg-amber-500/10 px-3 py-2 text-[11px] text-amber-500">
                This flow has an active run ({activeRun?.status}). Run inputs and pipeline edits are locked for this flow.
              </p>
            ) : null}

            {aiChatPending && !runActive ? (
              <p className="rounded-lg bg-amber-500/10 px-3 py-2 text-[11px] text-amber-500">
                AI chat is updating this flow. Running is temporarily disabled until the update completes.
              </p>
            ) : null}

            {(runActive || (aiChatPending && !runActive)) ? <div className="mt-3" /> : null}

            {runActive && activeRun ? (
              <>
                <section className="space-y-3">
                  <div className="flex items-center gap-2 text-ink-400">
                    <FolderOpen className="h-3.5 w-3.5" />
                    <span className="text-[11px] font-semibold uppercase tracking-wider">Current session</span>
                  </div>
                  <RunSessionCard
                    runId={activeRun.id}
                    pipelineId={activeRun.pipelineId}
                    stepFolders={activeRun.steps.map((step) => ({ stepId: step.stepId, stepName: step.stepName }))}
                    isolatedEnabledStepIds={isolatedEnabledStepIds}
                    storageConfig={storageConfig}
                  />
                </section>
                <div className="my-5 h-px bg-[var(--divider)]" />
              </>
            ) : null}

            {/* ── Task ── */}
            <section className="space-y-4">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 text-ink-400">
                  <ClipboardList className="h-3.5 w-3.5" />
                  <span className="text-[11px] font-semibold uppercase tracking-wider">Task</span>
                </div>

                <SegmentedControl
                  size="sm"
                  segments={MODE_SEGMENTS}
                  value={mode}
                  onValueChange={setMode}
                  disabled={controlsLocked}
                />
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
                        triggerRefreshSpin();
                        await refreshSmartRunPlan({ force: true });
                      }}
                    >
                      <RefreshCw className="h-3.5 w-3.5" style={{ transform: `rotate(${refreshRotation}deg)`, transition: "transform 0.45s ease-in-out" }} />
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

                      {smartRunPlan.fields.map((field) => {
                        const inputId = `run-input-${field.key}`;

                        return (
                          <div key={field.key} className="block space-y-1.5">
                            <div className="flex items-center justify-between gap-2">
                              <label htmlFor={inputId} className="flex items-center gap-1 text-xs text-ink-400">
                                {field.label}
                                {field.required ? <span className="text-red-400">*</span> : null}
                              </label>
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
                                id={inputId}
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
                                id={inputId}
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
                          </div>
                        );
                      })}

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
              onRun={onRun}
              onStop={onStop}
              onPause={onPause}
              onResume={onResume}
              onResolveApproval={onResolveApproval}
            />
          </div>
        )}

        {activeTab === "history" && (
          <RunHistoryList
            scopedRuns={scopedRuns}
            isolatedEnabledStepIds={isolatedEnabledStepIds}
            storageConfig={storageConfig}
          />
        )}
      </div>
    </div>
  );
}
