import { AlertTriangle, Loader2, Pause, Play, Rocket, Square } from "lucide-react";
import type { Dispatch, SetStateAction } from "react";
import { Button } from "@/components/optics/button";
import { Input } from "@/components/optics/input";
import type { PipelineRun, SmartRunPlan } from "@/lib/types";
import { RunHistoryList } from "@/components/dashboard/run-panel/RunHistoryList";
import type { RunMode } from "@/lib/runDraftStorage";

interface ManualApproval {
  id: string;
  gateName: string;
  stepName: string;
  message?: string | null;
}

interface RunPanelActionsProps {
  mode: RunMode;
  task: string;
  smartInputs: Record<string, string>;
  runActive: boolean;
  activeRun: PipelineRun | null;
  startingRun: boolean;
  stoppingRun: boolean;
  pausingRun?: boolean;
  resumingRun?: boolean;
  canPauseActiveRun: boolean;
  canResumeActiveRun: boolean;
  canSmartRun: boolean;
  canQuickRun: boolean;
  loadingSmartRunPlan: boolean;
  smartRunPlan: SmartRunPlan | null;
  firstBlockingCheck: SmartRunPlan["checks"][number] | null | undefined;
  approvalNotes: Record<string, string | undefined>;
  setApprovalNotes: Dispatch<SetStateAction<Record<string, string>>>;
  resolvingApprovalId?: string | null;
  pendingApprovals: ManualApproval[];
  scopedRuns: PipelineRun[];
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
}

export function RunPanelActions({
  mode,
  task,
  smartInputs,
  runActive,
  activeRun,
  startingRun,
  stoppingRun,
  pausingRun = false,
  resumingRun = false,
  canPauseActiveRun,
  canResumeActiveRun,
  canSmartRun,
  canQuickRun,
  loadingSmartRunPlan,
  smartRunPlan,
  firstBlockingCheck,
  approvalNotes,
  setApprovalNotes,
  resolvingApprovalId = null,
  pendingApprovals,
  scopedRuns,
  onRun,
  onStop,
  onPause,
  onResume,
  onResolveApproval
}: RunPanelActionsProps) {
  return (
    <>
      <div className="my-5 h-px bg-[var(--divider)]" />

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
          <div className="flex items-start gap-2 rounded-lg bg-[var(--surface-raised)] px-3 py-2 text-xs text-ink-500">
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

      <div className="my-5 h-px bg-[var(--divider)]" />

      <RunHistoryList scopedRuns={scopedRuns} />
    </>
  );
}
