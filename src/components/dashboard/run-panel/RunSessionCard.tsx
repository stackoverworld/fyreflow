import { Check, ChevronRight, Copy, ExternalLink, FolderOpen, Loader2, Share2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Tooltip } from "@/components/optics/tooltip";
import { cn } from "@/lib/cn";
import {
  buildIsolatedStepStoragePath,
  buildIsolatedStorageRootPath,
  buildRunFolderPath,
  buildSharedStoragePath,
  getRevealFolderButtonLabel,
  isIsolatedStorageEnabledForStep,
  shouldShowIsolatedStorageSection
} from "@/lib/runStoragePath";
import type { StorageConfig } from "@/lib/types";

interface RunSessionCardProps {
  runId: string;
  pipelineId: string;
  stepFolders?: Array<{
    stepId: string;
    stepName?: string;
  }>;
  isolatedEnabledStepIds?: ReadonlySet<string> | null;
  storageConfig: StorageConfig | null | undefined;
  bordered?: boolean;
}

type RevealTarget = "shared" | "isolated-root" | "run" | `isolated-step:${string}`;

export function RunSessionCard({
  runId,
  pipelineId,
  stepFolders = [],
  isolatedEnabledStepIds = null,
  storageConfig,
  bordered = true
}: RunSessionCardProps) {
  const [openingTarget, setOpeningTarget] = useState<RevealTarget | null>(null);
  const [errorTarget, setErrorTarget] = useState<RevealTarget | null>(null);
  const desktopBridge = typeof window !== "undefined" ? window.desktop : undefined;
  const showIsolatedStorageSection = shouldShowIsolatedStorageSection(isolatedEnabledStepIds);
  const runFolderPath = useMemo(() => buildRunFolderPath(storageConfig, runId), [storageConfig, runId]);
  const sharedStoragePath = useMemo(() => buildSharedStoragePath(storageConfig, pipelineId), [pipelineId, storageConfig]);
  const isolatedStorageRootPath = useMemo(
    () => (showIsolatedStorageSection ? buildIsolatedStorageRootPath(storageConfig, pipelineId) : null),
    [pipelineId, showIsolatedStorageSection, storageConfig]
  );
  const isolatedStepFolders = useMemo(() => {
    const seenStepIds = new Set<string>();
    const entries: Array<{ stepId: string; stepName: string; path: string | null; targetKey: RevealTarget }> = [];
    for (const step of stepFolders) {
      const normalizedStepId = step.stepId.trim();
      if (normalizedStepId.length === 0 || seenStepIds.has(normalizedStepId)) {
        continue;
      }
      if (!isIsolatedStorageEnabledForStep(normalizedStepId, isolatedEnabledStepIds)) {
        continue;
      }
      seenStepIds.add(normalizedStepId);
      entries.push({
        stepId: normalizedStepId,
        stepName: step.stepName?.trim().length ? step.stepName.trim() : normalizedStepId,
        path: buildIsolatedStepStoragePath(storageConfig, pipelineId, normalizedStepId),
        targetKey: `isolated-step:${normalizedStepId}`
      });
    }
    return entries;
  }, [isolatedEnabledStepIds, pipelineId, stepFolders, storageConfig]);
  const canRevealPath = Boolean(
    desktopBridge?.isElectron === true &&
    typeof desktopBridge.revealPath === "function"
  );
  const revealButtonLabel = getRevealFolderButtonLabel(desktopBridge?.platform);

  useEffect(() => {
    setOpeningTarget(null);
    setErrorTarget(null);
  }, [isolatedEnabledStepIds, pipelineId, runId, stepFolders]);

  const handleRevealPath = async (target: RevealTarget, targetPath: string | null) => {
    if (!targetPath || !canRevealPath || !desktopBridge) {
      return;
    }

    setOpeningTarget(target);
    setErrorTarget(null);
    try {
      const result = await desktopBridge.revealPath({ path: targetPath });
      if (!result.ok) {
        setOpeningTarget(null);
        setErrorTarget(target);
        return;
      }

      setOpeningTarget(null);
      setErrorTarget(null);
    } catch {
      setOpeningTarget(null);
      setErrorTarget(target);
    }
  };

  const [idCopied, setIdCopied] = useState(false);
  const isBusy = openingTarget !== null;
  const sharedOpening = openingTarget === "shared";
  const isolatedRootOpening = openingTarget === "isolated-root";
  const runOpening = openingTarget === "run";

  const handleCopyRunId = () => {
    navigator.clipboard.writeText(runId).then(() => {
      setIdCopied(true);
      window.setTimeout(() => setIdCopied(false), 1_200);
    }).catch(() => {});
  };

  const openBtnClass = "flex shrink-0 cursor-pointer items-center gap-1 text-[11px] text-ink-500 transition-colors hover:text-ink-300 disabled:opacity-50 disabled:cursor-not-allowed";

  return (
    <div
      className={cn(
        bordered && "rounded-lg border border-ink-800/50 bg-[var(--surface-raised)] px-3 py-2.5"
      )}
    >
      {/* Run ID */}
      <div>
        <p className="text-[11px] text-ink-500">Run ID</p>
        <span className="inline-flex items-center gap-1">
          <span className="break-all font-mono text-xs text-ink-300">{runId}</span>
          <Tooltip side="right" content={idCopied ? "Copied" : "Copy"}>
            <button
              type="button"
              className="inline-flex shrink-0 cursor-pointer items-center justify-center rounded p-0.5 text-ink-500 transition-colors hover:text-ink-300"
              aria-label="Copy Run ID"
              onClick={handleCopyRunId}
            >
              {idCopied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
            </button>
          </Tooltip>
        </span>
      </div>

      {/* Storage paths — compact rows */}
      <div className="mt-2.5 space-y-1.5 border-t border-ink-800/40 pt-2">
        {/* Shared storage */}
        <div className="flex items-center justify-between gap-2">
          <p className="flex items-center gap-1.5 text-[11px] text-ink-500" title={sharedStoragePath ?? ""}>
            <Share2 className="h-3 w-3 shrink-0" />
            Shared storage
          </p>
          {canRevealPath && sharedStoragePath ? (
            <button type="button" disabled={isBusy} onClick={() => void handleRevealPath("shared", sharedStoragePath)} className={openBtnClass}>
              {sharedOpening ? <Loader2 className="h-3 w-3 animate-spin" /> : <ExternalLink className="h-3 w-3" />}
              {sharedOpening ? "Opening..." : revealButtonLabel}
            </button>
          ) : null}
        </div>
        {errorTarget === "shared" ? <p className="pl-[18px] text-[10px] text-red-400">Could not open folder.</p> : null}

        {/* Isolated storage */}
        {showIsolatedStorageSection ? (
          <>
            <div className="flex items-center justify-between gap-2">
              <p className="flex items-center gap-1.5 text-[11px] text-ink-500" title={isolatedStorageRootPath ?? ""}>
                <FolderOpen className="h-3 w-3 shrink-0" />
                Isolated storage
              </p>
              {canRevealPath && isolatedStorageRootPath ? (
                <button type="button" disabled={isBusy} onClick={() => void handleRevealPath("isolated-root", isolatedStorageRootPath)} className={openBtnClass}>
                  {isolatedRootOpening ? <Loader2 className="h-3 w-3 animate-spin" /> : <ExternalLink className="h-3 w-3" />}
                  {isolatedRootOpening ? "Opening..." : revealButtonLabel}
                </button>
              ) : null}
            </div>
            {errorTarget === "isolated-root" ? <p className="pl-[18px] text-[10px] text-red-400">Could not open folder.</p> : null}

            {isolatedStepFolders.length > 0 ? (
              <details className="group pl-[18px]">
                <summary className="flex cursor-pointer list-none items-center gap-1 text-[11px] text-ink-500 hover:text-ink-300">
                  <ChevronRight className="h-3 w-3 text-ink-600 transition-transform group-open:rotate-90" />
                  Per-step folders ({isolatedStepFolders.length})
                </summary>
                <div className="mt-1 space-y-1 pl-4">
                  {isolatedStepFolders.map((entry) => {
                    const stepOpening = openingTarget === entry.targetKey;
                    const stepErrored = errorTarget === entry.targetKey;
                    return (
                      <div key={entry.stepId} className="flex items-center justify-between gap-2">
                        <p className="text-[11px] text-ink-400" title={entry.path ?? ""}>{entry.stepName}</p>
                        {canRevealPath && entry.path ? (
                          <button type="button" disabled={isBusy} onClick={() => void handleRevealPath(entry.targetKey, entry.path)} className={openBtnClass}>
                            {stepOpening ? <Loader2 className="h-3 w-3 animate-spin" /> : <ExternalLink className="h-3 w-3" />}
                            Open
                          </button>
                        ) : null}
                        {stepErrored ? <span className="text-[10px] text-red-400">Failed</span> : null}
                      </div>
                    );
                  })}
                </div>
              </details>
            ) : null}
          </>
        ) : null}

        {/* Run folder */}
        <div className="flex items-center justify-between gap-2">
          <p className="flex items-center gap-1.5 text-[11px] text-ink-500" title={runFolderPath ?? ""}>
            <FolderOpen className="h-3 w-3 shrink-0" />
            Run folder
          </p>
          {canRevealPath && runFolderPath ? (
            <button type="button" disabled={isBusy} onClick={() => void handleRevealPath("run", runFolderPath)} className={openBtnClass}>
              {runOpening ? <Loader2 className="h-3 w-3 animate-spin" /> : <ExternalLink className="h-3 w-3" />}
              {runOpening ? "Opening..." : revealButtonLabel}
            </button>
          ) : null}
        </div>
        {errorTarget === "run" ? <p className="pl-[18px] text-[10px] text-red-400">Could not open folder.</p> : null}
      </div>

      {!canRevealPath ? (
        <p className="mt-2 text-[11px] text-ink-600">Folder actions available in Electron mode.</p>
      ) : null}
    </div>
  );
}
