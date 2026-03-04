import { CheckCircle2, ClipboardList, ExternalLink, FolderOpen, TerminalSquare, X, XCircle } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useEffect, useState } from "react";
import { Button } from "@/components/optics/button";
import type { RunCompletionModalContext } from "@/app/state/appStateTypes";
import { buildRunFolderPath, getRevealFolderButtonLabel } from "@/lib/runStoragePath";
import type { StorageConfig } from "@/lib/types";

interface RunCompletionModalProps {
  open: boolean;
  completion: RunCompletionModalContext | null;
  storageConfig: StorageConfig | null;
  onClose: () => void;
  onViewRun: () => void;
}

function formatTimestamp(value?: string): string | null {
  if (!value) {
    return null;
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return value;
  }

  return parsed.toLocaleString();
}

export function RunCompletionModal({
  open,
  completion,
  storageConfig,
  onClose,
  onViewRun
}: RunCompletionModalProps) {
  const [revealState, setRevealState] = useState<"idle" | "opening" | "error">("idle");
  const runFolderPath = completion ? buildRunFolderPath(storageConfig, completion.runId) : null;
  const finishedAt = formatTimestamp(completion?.finishedAt);
  const runFailed = completion?.status === "failed";
  const desktopBridge = typeof window !== "undefined" ? window.desktop : undefined;
  const canRevealPath = Boolean(
    runFolderPath &&
    desktopBridge?.isElectron === true &&
    typeof desktopBridge.revealPath === "function"
  );
  const revealButtonLabel = getRevealFolderButtonLabel(desktopBridge?.platform);
  const statusLabel = runFailed ? "Run failed" : "Run completed";
  const statusSummary = completion
    ? runFailed
      ? `${completion.completedSteps}/${completion.totalSteps} steps completed before failure`
      : `${completion.completedSteps}/${completion.totalSteps} steps completed`
    : null;
  const taskSummary = completion
    ? completion.task.trim().length > 0
      ? completion.task
      : runFailed
        ? "Run failed without a task description."
        : "Run completed without a task description."
    : "";
  const outputLabel = runFailed ? "Last output before failure" : "Final output";
  const sectionTitle = runFailed ? "What happened" : "What was done";
  const runPanelDetails = runFailed
    ? "Open the Run panel and expand this entry under Recent runs to inspect step outputs, provider logs, and retry with corrected inputs."
    : "Open the Run panel and expand this entry under Recent runs to inspect full step outputs and logs.";

  useEffect(() => {
    if (!open) {
      setRevealState("idle");
    }
  }, [open, completion?.runId]);

  const handleRevealPath = async () => {
    if (!runFolderPath || !canRevealPath || !desktopBridge) {
      return;
    }

    setRevealState("opening");
    try {
      const result = await desktopBridge.revealPath({ path: runFolderPath });
      if (!result.ok) {
        setRevealState("error");
        return;
      }

      setRevealState("idle");
    } catch {
      setRevealState("error");
    }
  };

  return (
    <AnimatePresence>
      {open && completion ? (
        <>
          <motion.div
            className="fixed inset-0 z-[90] bg-[var(--surface-overlay)] backdrop-blur-[2px]"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
          />
          <motion.div
            className="fixed inset-0 z-[95] flex items-center justify-center p-4"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 8 }}
            transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
          >
            <section
              className="glass-panel-dense w-full max-w-[620px] overflow-hidden rounded-2xl border border-ink-700/40"
              role="dialog"
              aria-modal="true"
              aria-label={statusLabel}
            >
              <header className="flex items-start justify-between gap-3 border-b border-ink-800 px-4 py-3">
                <div>
                  <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-ink-400">
                    {runFailed ? (
                      <XCircle className="h-3.5 w-3.5 text-red-400" />
                    ) : (
                      <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400" />
                    )}
                    {statusLabel}
                  </p>
                  <h2 className="mt-1 text-sm font-semibold text-ink-100">{completion.pipelineName}</h2>
                  <p className="mt-1 text-xs text-ink-400">
                    {statusSummary}
                    {finishedAt ? ` · Finished ${finishedAt}` : ""}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={onClose}
                  className="rounded-md p-1.5 text-ink-500 transition-colors hover:bg-ink-800 hover:text-ink-100"
                  aria-label="Close"
                >
                  <X className="h-4 w-4" />
                </button>
              </header>

              <div className="max-h-[70vh] overflow-y-auto px-4 py-4">
                <section className="space-y-4">
                  <div className="flex items-center gap-2 text-ink-400">
                    <ClipboardList className="h-3.5 w-3.5" />
                    <span className="text-[11px] font-semibold uppercase tracking-wider">{sectionTitle}</span>
                  </div>

                  <div className="rounded-lg border border-ink-800/50 bg-[var(--surface-raised)] px-3 py-2.5">
                    <p className="text-xs font-medium text-ink-200">{taskSummary}</p>
                    <p className="mt-1 text-[11px] text-ink-500">Run ID: {completion.runId}</p>
                    {runFailed ? (
                      <div className="mt-2 flex items-start gap-1.5 rounded-md bg-[var(--surface-overlay)] px-2.5 py-2">
                        <XCircle className="mt-px h-3.5 w-3.5 shrink-0 text-red-400" />
                        <div className="min-w-0">
                          <p className="text-[10px] font-semibold uppercase tracking-wide text-ink-500">
                            Failure reason{completion.failureStepName ? ` · ${completion.failureStepName}` : ""}
                          </p>
                          <p className="mt-0.5 text-[11px] text-ink-300">
                            {completion.failureReason ?? "Run failed before returning a specific reason."}
                          </p>
                        </div>
                      </div>
                    ) : null}
                  </div>

                  {runFailed && completion.failureDetails && completion.failureDetails.length > 0 ? (
                    <div className="rounded-lg border border-ink-800/50 bg-[var(--surface-raised)] px-3 py-2.5">
                      <p className="text-[11px] font-semibold uppercase tracking-wide text-ink-500">Recent failure signals</p>
                      <ol className="mt-2 space-y-2">
                        {completion.failureDetails.map((detail, index) => (
                          <li key={`${completion.runId}-failure-${index}`} className="border-l-2 border-l-ink-700 pl-3 py-1">
                            <p className="text-[11px] text-ink-300">{detail}</p>
                          </li>
                        ))}
                      </ol>
                    </div>
                  ) : null}

                  {completion.finalOutputPreview ? (
                    <div className="rounded-lg border border-ink-800/50 bg-[var(--surface-raised)] px-3 py-2.5">
                      <p className="text-[11px] font-semibold uppercase tracking-wide text-ink-500">
                        {outputLabel}
                        {completion.finalStepName ? ` · ${completion.finalStepName}` : ""}
                      </p>
                      <p className="mt-1 text-xs text-ink-300">{completion.finalOutputPreview}</p>
                    </div>
                  ) : null}
                </section>

                <div className="my-5 h-px bg-[var(--divider)]" />

                <section className="space-y-3">
                  <div className="flex items-center gap-2 text-ink-400">
                    <FolderOpen className="h-3.5 w-3.5" />
                    <span className="text-[11px] font-semibold uppercase tracking-wider">
                      {runFailed ? "Where to inspect failure" : "Where to find results"}
                    </span>
                  </div>

                  <div className="rounded-lg border border-ink-800/50 bg-[var(--surface-raised)] px-3 py-2.5">
                    <p className="text-xs font-medium text-ink-200">Run panel</p>
                    <p className="mt-1 text-[11px] text-ink-500">{runPanelDetails}</p>
                  </div>

                  {runFolderPath ? (
                    <div className="rounded-lg border border-ink-800/50 bg-[var(--surface-raised)] px-3 py-2.5">
                      <div className="flex items-start justify-between gap-3">
                        <p className="flex items-center gap-2 text-xs font-medium text-ink-200">
                          <TerminalSquare className="h-3.5 w-3.5 text-ink-500" />
                          Run storage folder
                        </p>
                        {canRevealPath ? (
                          <Button
                            size="sm"
                            variant="secondary"
                            className="shrink-0 whitespace-nowrap"
                            disabled={revealState === "opening"}
                            onClick={() => {
                              void handleRevealPath();
                            }}
                          >
                            <ExternalLink className="h-3.5 w-3.5" />
                            {revealState === "opening" ? "Opening..." : revealButtonLabel}
                          </Button>
                        ) : null}
                      </div>
                      <p className="mt-1 break-all font-mono text-[11px] text-ink-400">{runFolderPath}</p>
                      {!canRevealPath ? (
                        <p className="mt-1 text-[11px] text-ink-600">Open folder action is available in Electron desktop mode.</p>
                      ) : null}
                      {revealState === "error" ? (
                        <p className="mt-1 text-[11px] text-red-400">Could not open the folder. Verify the path exists.</p>
                      ) : null}
                    </div>
                  ) : null}
                </section>
              </div>

              <footer className="flex items-center justify-end gap-2 border-t border-ink-800 px-4 py-3">
                <Button variant="secondary" onClick={onClose}>
                  Close
                </Button>
                <Button className="shrink-0 whitespace-nowrap" onClick={onViewRun}>
                  Open Run Panel
                </Button>
              </footer>
            </section>
          </motion.div>
        </>
      ) : null}
    </AnimatePresence>
  );
}
