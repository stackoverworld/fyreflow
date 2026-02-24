import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  ChevronRight,
  File,
  FileArchive,
  FileCode2,
  FileJson2,
  FileText,
  Folder,
  FolderOpen,
  Globe,
  HardDrive,
  History,
  Image,
  Layers,
  Loader2,
  Maximize2,
  RefreshCw,
  Trash2
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type {
  Pipeline,
  PipelineRun,
  StorageConfig,
  StorageFileEntry,
  StorageFileListResponse,
  StorageFilesScope
} from "@/lib/types";
import { buildStorageRawFileUrl, deleteStorageFilePath, getStorageFileContent, listStorageFiles } from "@/lib/api";
import { useIconSpin } from "@/lib/useIconSpin";
import { Button } from "@/components/optics/button";
import { Select } from "@/components/optics/select";
import { Tooltip } from "@/components/optics/tooltip";
import { SegmentedControl, type Segment } from "@/components/optics/segmented-control";
import { FilePreviewModal } from "@/components/dashboard/file-preview/FilePreviewModal";
import {
  chooseContentPreviewBytes,
  classifyFilePreviewByName,
  getRawPreviewLimitBytes,
  isRawPreviewTooLarge,
  resolveTextPreviewKind,
  type FilePreviewModalData
} from "@/components/dashboard/file-preview/previewModel";

interface FilesPanelProps {
  selectedPipeline: Pipeline | undefined;
  runs: PipelineRun[];
  storageConfig: StorageConfig | null;
  onNotice?: (message: string) => void;
}

const SCOPE_SEGMENTS: Segment<StorageFilesScope>[] = [
  { value: "shared", label: "Shared", icon: <Layers className="h-3.5 w-3.5" /> },
  { value: "isolated", label: "Isolated", icon: <HardDrive className="h-3.5 w-3.5" /> },
  { value: "runs", label: "Runs", icon: <History className="h-3.5 w-3.5" /> }
];

function formatTimestamp(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return date.toLocaleString();
}

function formatSize(sizeBytes: number | null): string {
  if (sizeBytes === null || !Number.isFinite(sizeBytes)) {
    return "folder";
  }
  if (sizeBytes < 1024) {
    return `${sizeBytes} B`;
  }
  if (sizeBytes < 1024 * 1024) {
    return `${(sizeBytes / 1024).toFixed(1)} KB`;
  }
  return `${(sizeBytes / (1024 * 1024)).toFixed(1)} MB`;
}

function describeRun(run: PipelineRun): string {
  const startedAt = formatTimestamp(run.startedAt);
  const status = run.status;
  const shortId = run.id.length > 16 ? `${run.id.slice(0, 16)}...` : run.id;
  return `${shortId} · ${status} · ${startedAt}`;
}

function splitPath(pathValue: string): string[] {
  return pathValue
    .split("/")
    .map((segment) => segment.trim())
    .filter((segment) => segment.length > 0);
}

const EXT_ICON_MAP: Record<string, LucideIcon> = {
  html: Globe,
  htm: Globe,
  json: FileJson2,
  jsonl: FileJson2,
  js: FileCode2,
  jsx: FileCode2,
  ts: FileCode2,
  tsx: FileCode2,
  py: FileCode2,
  css: FileCode2,
  scss: FileCode2,
  xml: FileCode2,
  yaml: FileCode2,
  yml: FileCode2,
  toml: FileCode2,
  sh: FileCode2,
  md: FileText,
  txt: FileText,
  log: FileText,
  csv: FileText,
  pdf: FileText,
  png: Image,
  jpg: Image,
  jpeg: Image,
  gif: Image,
  svg: Image,
  webp: Image,
  ico: Image,
  zip: FileArchive,
  tar: FileArchive,
  gz: FileArchive,
  "7z": FileArchive,
  rar: FileArchive,
};

function fileIcon(name: string): LucideIcon {
  const dot = name.lastIndexOf(".");
  if (dot < 0) return File;
  const ext = name.slice(dot + 1).toLowerCase();
  return EXT_ICON_MAP[ext] ?? File;
}

export function FilesPanel({
  selectedPipeline,
  runs,
  storageConfig,
  onNotice
}: FilesPanelProps) {
  const previewRequestCounterRef = useRef(0);
  const [scope, setScope] = useState<StorageFilesScope>("shared");
  const [selectedRunId, setSelectedRunId] = useState("");
  const [currentPath, setCurrentPath] = useState("");
  const [listing, setListing] = useState<StorageFileListResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [deletingPath, setDeletingPath] = useState<string | null>(null);
  const [refreshToken, setRefreshToken] = useState(0);
  const { rotation: refreshRotation, triggerSpin: triggerRefreshSpin } = useIconSpin();
  const [previewPath, setPreviewPath] = useState<string | null>(null);
  const [preview, setPreview] = useState<FilePreviewModalData | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const closePreviewModal = useCallback(() => {
    setModalOpen(false);
  }, []);

  const clearPreview = () => {
    setPreviewPath(null);
    setPreview(null);
    setPreviewError(null);
    setPreviewLoading(false);
    setModalOpen(false);
    previewRequestCounterRef.current += 1;
  };

  const scopedRuns = useMemo(() => {
    if (!selectedPipeline) {
      return [];
    }

    return runs
      .filter((run) => run.pipelineId === selectedPipeline.id)
      .sort((left, right) => Date.parse(right.startedAt) - Date.parse(left.startedAt));
  }, [runs, selectedPipeline]);

  const runOptions = useMemo(() => {
    return scopedRuns.map((run) => ({
      value: run.id,
      label: describeRun(run)
    }));
  }, [scopedRuns]);

  useEffect(() => {
    setCurrentPath("");
    setListing(null);
    setLoadError(null);
    clearPreview();
  }, [scope, selectedPipeline?.id, selectedRunId]);

  useEffect(() => {
    if (scope !== "runs") {
      return;
    }

    if (runOptions.length === 0) {
      setSelectedRunId("");
      return;
    }

    setSelectedRunId((current) => (runOptions.some((option) => option.value === current) ? current : runOptions[0].value));
  }, [runOptions, scope]);

  useEffect(() => {
    let cancelled = false;

    const pipelineId = selectedPipeline?.id;
    if (!pipelineId) {
      setLoading(false);
      setListing(null);
      setLoadError(null);
      return;
    }
    if (!storageConfig?.enabled) {
      setLoading(false);
      setListing(null);
      setLoadError(null);
      return;
    }
    if (scope === "runs" && selectedRunId.trim().length === 0) {
      setLoading(false);
      setListing(null);
      setLoadError(null);
      return;
    }

    setLoading(true);
    setLoadError(null);

    void listStorageFiles({
      pipelineId,
      scope,
      runId: scope === "runs" ? selectedRunId : undefined,
      path: currentPath
    })
      .then((response) => {
        if (cancelled) {
          return;
        }
        setListing(response);
      })
      .catch((error) => {
        if (cancelled) {
          return;
        }
        const message = error instanceof Error ? error.message : "Failed to load files";
        setLoadError(message);
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [currentPath, refreshToken, scope, selectedPipeline?.id, selectedRunId, storageConfig?.enabled]);

  const breadcrumbs = useMemo(() => {
    if (!listing) {
      return [];
    }

    const segments = splitPath(listing.currentPath);
    const nodes: Array<{ label: string; path: string }> = [];
    let cursor = "";
    for (const segment of segments) {
      cursor = cursor.length > 0 ? `${cursor}/${segment}` : segment;
      nodes.push({ label: segment, path: cursor });
    }
    return nodes;
  }, [listing]);

  const canRenderBrowser = Boolean(selectedPipeline) && storageConfig?.enabled === true;
  const needsRunSelection = canRenderBrowser && scope === "runs" && runOptions.length === 0;

  const refreshListing = () => setRefreshToken((current) => current + 1);

  const openDirectory = (entry: StorageFileEntry) => {
    if (entry.type !== "directory") {
      return;
    }
    clearPreview();
    setCurrentPath(entry.path);
  };

  const openFilePreview = async (entry: StorageFileEntry) => {
    if (!selectedPipeline || entry.type !== "file") {
      return;
    }

    const runId = scope === "runs" ? selectedRunId : undefined;
    const runIdValue = runId ?? null;
    const classification = classifyFilePreviewByName(entry.name);
    const sizeBytes = entry.sizeBytes ?? 0;
    const requestId = previewRequestCounterRef.current + 1;
    previewRequestCounterRef.current = requestId;
    setPreviewPath(entry.path);
    setPreview(null);
    setPreviewError(null);
    setPreviewLoading(true);
    setModalOpen(false);

    try {
      if (classification.mode === "raw") {
        if (isRawPreviewTooLarge(classification.kind, entry.sizeBytes)) {
          const limitBytes = getRawPreviewLimitBytes(classification.kind);
          if (previewRequestCounterRef.current !== requestId) {
            return;
          }

          setPreview({
            pipelineId: selectedPipeline.id,
            scope,
            runId: runIdValue,
            kind: "binary",
            name: entry.name,
            path: entry.path,
            mimeType: classification.mimeType,
            sizeBytes,
            message: `File is too large for inline preview (${formatSize(sizeBytes)}). Limit: ${formatSize(limitBytes)}.`
          });
          setModalOpen(true);
          return;
        }

        const rawUrl = buildStorageRawFileUrl({
          pipelineId: selectedPipeline.id,
          scope,
          runId,
          path: entry.path
        });

        if (previewRequestCounterRef.current !== requestId) {
          return;
        }

        setPreview({
          pipelineId: selectedPipeline.id,
          scope,
          runId: runIdValue,
          kind: classification.kind,
          name: entry.name,
          path: entry.path,
          mimeType: classification.mimeType,
          sizeBytes,
          rawUrl
        });
        setModalOpen(true);
        return;
      }

      if (classification.mode === "unsupported") {
        if (previewRequestCounterRef.current !== requestId) {
          return;
        }

        setPreview({
          pipelineId: selectedPipeline.id,
          scope,
          runId: runIdValue,
          kind: "binary",
          name: entry.name,
          path: entry.path,
          mimeType: classification.mimeType,
          sizeBytes,
          message: "Preview is unavailable for this file type."
        });
        setModalOpen(true);
        return;
      }

      const response = await getStorageFileContent({
        pipelineId: selectedPipeline.id,
        scope,
        runId,
        path: entry.path,
        maxBytes: chooseContentPreviewBytes(entry.sizeBytes)
      });
      if (previewRequestCounterRef.current !== requestId) {
        return;
      }

      setPreview({
        pipelineId: response.pipelineId,
        scope: response.scope,
        runId: response.runId,
        kind: resolveTextPreviewKind(response.mimeType, response.previewKind),
        name: response.name,
        path: response.path,
        mimeType: response.mimeType,
        sizeBytes: response.sizeBytes,
        content: response.content,
        truncated: response.truncated,
        maxBytes: response.maxBytes
      });
      setModalOpen(true);
    } catch (error) {
      if (previewRequestCounterRef.current !== requestId) {
        return;
      }

      const message = error instanceof Error ? error.message : "Failed to open file";
      if (message.toLowerCase().includes("text files only")) {
        setPreview({
          pipelineId: selectedPipeline.id,
          scope,
          runId: runIdValue,
          kind: "binary",
          name: entry.name,
          path: entry.path,
          mimeType: classification.mimeType,
          sizeBytes,
          message: "Binary file preview is not supported."
        });
        setModalOpen(true);
        return;
      }
      setPreviewError(message);
    } finally {
      if (previewRequestCounterRef.current === requestId) {
        setPreviewLoading(false);
      }
    }
  };

  const goToParentPath = () => {
    if (!listing || listing.parentPath === null) {
      return;
    }
    clearPreview();
    setCurrentPath(listing.parentPath);
  };

  const handleDeleteEntry = async (entry: StorageFileEntry) => {
    if (!selectedPipeline) {
      return;
    }

    const recursive = entry.type === "directory";
    const confirmed = window.confirm(
      recursive
        ? `Delete folder "${entry.name}" and all nested files?`
        : `Delete file "${entry.name}"?`
    );
    if (!confirmed) {
      return;
    }

    setDeletingPath(entry.path);
    try {
      await deleteStorageFilePath({
        pipelineId: selectedPipeline.id,
        scope,
        runId: scope === "runs" ? selectedRunId : undefined,
        path: entry.path,
        recursive
      });

      if (
        previewPath &&
        (previewPath === entry.path || (entry.type === "directory" && previewPath.startsWith(`${entry.path}/`)))
      ) {
        clearPreview();
      }

      onNotice?.(recursive ? `Folder "${entry.name}" deleted.` : `File "${entry.name}" deleted.`);
      refreshListing();
    } catch (error) {
      const message = error instanceof Error ? error.message : "Delete failed";
      onNotice?.(message);
      setLoadError(message);
    } finally {
      setDeletingPath(null);
    }
  };

  return (
    <div>
      <section className="space-y-4">
        <div className="flex items-center gap-2 text-ink-400">
          <FolderOpen className="h-3.5 w-3.5" />
          <span className="text-[11px] font-semibold uppercase tracking-wider">Storage scope</span>
        </div>

        <SegmentedControl segments={SCOPE_SEGMENTS} value={scope} onValueChange={setScope} />

        {scope === "runs" ? (
          <label className="block space-y-1.5">
            <span className="text-xs text-ink-400">Run</span>
            <Select
              value={selectedRunId}
              onValueChange={setSelectedRunId}
              options={runOptions}
              placeholder="Select run storage"
              disabled={runOptions.length === 0}
            />
            <p className="text-[11px] text-ink-600">Run storage is scoped to the selected pipeline.</p>
          </label>
        ) : null}
      </section>

      <div className="my-5 h-px bg-[var(--divider)]" />

      {!selectedPipeline ? (
        <section className="space-y-3">
          <div className="rounded-lg border border-ink-800/50 bg-[var(--surface-raised)] px-3 py-4 text-center text-xs text-ink-500">
            Select a flow to browse its storage.
          </div>
        </section>
      ) : null}

      {selectedPipeline && storageConfig?.enabled !== true ? (
        <section className="space-y-3">
          <div className="flex items-start gap-2 rounded-lg bg-red-500/10 px-3 py-2 text-xs text-red-500">
            <AlertTriangle className="mt-px h-3.5 w-3.5 shrink-0" />
            Storage is disabled. Enable storage in the MCP & Storage panel first.
          </div>
        </section>
      ) : null}

      {needsRunSelection ? (
        <section className="space-y-3">
          <div className="rounded-lg border border-ink-800/50 bg-[var(--surface-raised)] px-3 py-4 text-center text-xs text-ink-500">
            No runs found for this flow yet.
          </div>
        </section>
      ) : null}

      {canRenderBrowser && !needsRunSelection ? (
        <>
          <section className="space-y-3">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 text-ink-400">
                <HardDrive className="h-3.5 w-3.5" />
                <span className="text-[11px] font-semibold uppercase tracking-wider">Location</span>
              </div>
              <div className="flex items-center gap-1">
                <Button
                  size="sm"
                  variant="ghost"
                  className="shrink-0 whitespace-nowrap"
                  disabled={loading || !listing || listing.parentPath === null}
                  onClick={goToParentPath}
                >
                  Up
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  className="shrink-0 whitespace-nowrap"
                  disabled={loading}
                  onClick={() => { triggerRefreshSpin(); refreshListing(); }}
                >
                  <RefreshCw className="h-3.5 w-3.5" style={{ transform: `rotate(${refreshRotation}deg)`, transition: "transform 0.45s ease-in-out" }} />
                  Refresh
                </Button>
              </div>
            </div>

            {/* Breadcrumb */}
            <div className="flex items-start gap-1.5 text-[11px] text-ink-500">
              <FolderOpen className="mt-px h-3.5 w-3.5 shrink-0 text-ink-400" />
              <div className="min-w-0 flex-1">
                <div className="flex min-w-0 flex-wrap items-center gap-1">
                  <button
                    type="button"
                    className="cursor-pointer text-left text-ink-300 hover:text-ink-100"
                    onClick={() => {
                      clearPreview();
                      setCurrentPath("");
                    }}
                  >
                    {listing?.rootLabel ?? "Storage root"}
                  </button>
                  {breadcrumbs.map((item) => (
                    <span key={item.path} className="inline-flex min-w-0 items-center gap-1 text-ink-500">
                      <ChevronRight className="h-3 w-3 shrink-0" />
                      <button
                        type="button"
                        className="truncate cursor-pointer text-left text-ink-300 hover:text-ink-100"
                        onClick={() => {
                          clearPreview();
                          setCurrentPath(item.path);
                        }}
                        title={item.path}
                      >
                        {item.label}
                      </button>
                    </span>
                  ))}
                </div>
              </div>
            </div>
          </section>

          <div className="my-5 h-px bg-[var(--divider)]" />

          <section className="space-y-3">
            <div className="flex items-center gap-2 text-ink-400">
              <FolderOpen className="h-3.5 w-3.5" />
              <span className="text-[11px] font-semibold uppercase tracking-wider">Files</span>
              {listing ? <span className="text-[11px] text-ink-600">{listing.entries.length} items</span> : null}
            </div>

            {loading ? (
              <div className="flex items-center gap-2 rounded-lg bg-[var(--surface-raised)] px-3 py-3 text-xs text-ink-500">
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                Loading storage...
              </div>
            ) : null}

            {!loading && loadError ? (
              <div className="flex items-start gap-2 rounded-lg bg-red-500/10 px-3 py-2 text-xs text-red-500">
                <AlertTriangle className="mt-px h-3.5 w-3.5 shrink-0" />
                {loadError}
              </div>
            ) : null}

            {!loading && !loadError && listing && !listing.exists ? (
              <div className="rounded-lg border border-ink-800/50 bg-[var(--surface-raised)] px-3 py-4 text-center text-xs text-ink-500">
                Folder does not exist yet.
              </div>
            ) : null}

            {!loading && !loadError && listing && listing.exists && listing.entries.length === 0 ? (
              <div className="rounded-lg border border-ink-800/50 bg-[var(--surface-raised)] px-3 py-4 text-center text-xs text-ink-500">
                No files in this folder.
              </div>
            ) : null}

            {!loading && !loadError && listing && listing.exists && listing.entries.length > 0 ? (
              <div className="rounded-lg border border-ink-800/50 bg-[var(--surface-raised)] divide-y divide-ink-800/40">
                {listing.entries.map((entry) => {
                  const deleting = deletingPath === entry.path;
                  const selectedForPreview = entry.type === "file" && previewPath === entry.path;
                  return (
                    <div
                      key={entry.path}
                      className={`flex items-start justify-between gap-2 px-3 py-2 ${
                        selectedForPreview ? "bg-ink-900/35" : ""
                      }`}
                    >
                      <button
                        type="button"
                        className="flex min-w-0 flex-1 cursor-pointer items-start gap-1.5 text-left"
                        onClick={() => {
                          if (entry.type === "directory") {
                            openDirectory(entry);
                            return;
                          }
                          void openFilePreview(entry);
                        }}
                        title={entry.path}
                      >
                        {entry.type === "directory" ? (
                          <Folder className="mt-px h-3.5 w-3.5 shrink-0 text-ink-400" />
                        ) : (() => {
                          const Icon = fileIcon(entry.name);
                          return <Icon className="mt-px h-3.5 w-3.5 shrink-0 text-ink-500" />;
                        })()}
                        <span className="min-w-0">
                          <span className="block truncate text-xs font-medium text-ink-200">{entry.name}</span>
                          <span className="mt-0.5 block text-[11px] text-ink-500">
                            {formatSize(entry.sizeBytes)} · {formatTimestamp(entry.updatedAt)}
                          </span>
                        </span>
                      </button>

                      <Tooltip content="Delete" side="left">
                        <button
                          type="button"
                          className="mt-0.5 shrink-0 cursor-pointer rounded p-1 text-ink-500 transition-colors hover:text-red-400 disabled:opacity-50"
                          disabled={deleting}
                          onClick={() => void handleDeleteEntry(entry)}
                          aria-label={`Delete ${entry.name}`}
                        >
                          {deleting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
                        </button>
                      </Tooltip>
                    </div>
                  );
                })}
              </div>
            ) : null}

            {listing?.truncated ? (
              <div className="flex items-start gap-2 rounded-lg bg-amber-500/10 px-3 py-2 text-xs text-amber-500">
                <AlertTriangle className="mt-px h-3.5 w-3.5 shrink-0" />
                Directory is large. Showing first 500 items.
              </div>
            ) : null}
          </section>

          {previewPath ? (
            <>
              <div className="my-5 h-px bg-[var(--divider)]" />

              <section className="space-y-3">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex min-w-0 items-center gap-2 text-ink-400">
                    <FileText className="h-3.5 w-3.5 shrink-0" />
                    <span className="text-[11px] font-semibold uppercase tracking-wider">Preview</span>
                    <span className="truncate text-[11px] text-ink-600">{preview?.name ?? previewPath}</span>
                  </div>
                </div>

                {previewLoading ? (
                  <div className="flex items-center gap-2 rounded-lg bg-[var(--surface-raised)] px-3 py-3 text-xs text-ink-500">
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    Loading file preview...
                  </div>
                ) : null}

                {!previewLoading && previewError ? (
                  <div className="flex items-start gap-2 rounded-lg bg-red-500/10 px-3 py-2 text-xs text-red-500">
                    <AlertTriangle className="mt-px h-3.5 w-3.5 shrink-0" />
                    {previewError}
                  </div>
                ) : null}

                {!previewLoading && !previewError && preview ? (
                  <>
                    <div className="rounded-lg border border-ink-800/50 bg-[var(--surface-raised)] px-3 py-2 text-[11px] text-ink-500">
                      {preview.mimeType} · {formatSize(preview.sizeBytes)}
                    </div>

                    <button
                      type="button"
                      className="flex w-full cursor-pointer items-center justify-center gap-2 rounded-lg border border-ink-800/50 bg-[var(--surface-raised)] px-3 py-3 text-xs text-ink-300 transition-colors hover:bg-ink-800/60 hover:text-ink-100 disabled:cursor-not-allowed disabled:opacity-60"
                      onClick={() => setModalOpen(true)}
                      disabled={preview.kind === "binary"}
                    >
                      <Maximize2 className="h-3.5 w-3.5" />
                      {preview.kind === "binary" ? "Preview unavailable" : "Open preview"}
                    </button>

                    {preview.kind === "binary" ? (
                      <div className="flex items-start gap-2 rounded-lg bg-red-500/10 px-3 py-2 text-xs text-red-500">
                        <AlertTriangle className="mt-px h-3.5 w-3.5 shrink-0" />
                        {preview.message ?? "This file type cannot be previewed."}
                      </div>
                    ) : null}

                    {preview.truncated ? (
                      <div className="flex items-start gap-2 rounded-lg bg-amber-500/10 px-3 py-2 text-xs text-amber-500">
                        <AlertTriangle className="mt-px h-3.5 w-3.5 shrink-0" />
                        Large file. Showing first {formatSize(preview.maxBytes ?? null)}.
                      </div>
                    ) : null}
                  </>
                ) : null}
              </section>
            </>
          ) : null}
        </>
      ) : null}

      <FilePreviewModal
        open={modalOpen && preview !== null}
        preview={preview}
        onClose={closePreviewModal}
      />
    </div>
  );
}
