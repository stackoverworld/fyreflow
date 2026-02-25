import { type ChangeEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  ArrowUp,
  ChevronRight,
  Download,
  EllipsisVertical,
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
  Link2,
  Loader2,
  Maximize2,
  RefreshCw,
  Upload,
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
import {
  STORAGE_UPLOAD_MAX_BYTES,
  deleteStorageFilePath,
  fetchStorageRawFileBlob,
  getStorageFileContent,
  importStorageFileFromUrl,
  listStorageFiles,
  uploadStorageFile
} from "@/lib/api";
import { useIconSpin } from "@/lib/useIconSpin";
import { Button } from "@/components/optics/button";
import { Input } from "@/components/optics/input";
import { Select } from "@/components/optics/select";
import { Tooltip } from "@/components/optics/tooltip";
import { DropdownMenu, DropdownMenuItem, DropdownMenuDivider } from "@/components/optics/dropdown-menu";
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

function joinStoragePath(basePath: string, name: string): string {
  const base = splitPath(basePath);
  const leaf = name
    .split("/")
    .map((segment) => segment.trim())
    .filter((segment) => segment.length > 0);
  return [...base, ...leaf].join("/");
}

function inferFileNameFromUrl(value: string): string | null {
  try {
    const parsed = new URL(value);
    const fileName = parsed.pathname.split("/").at(-1)?.trim() ?? "";
    if (fileName.length === 0) {
      return null;
    }
    try {
      return decodeURIComponent(fileName);
    } catch {
      return fileName;
    }
  } catch {
    return null;
  }
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
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const previewRequestCounterRef = useRef(0);
  const previewObjectUrlRef = useRef<string | null>(null);
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
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<{ uploadedBytes: number; totalBytes: number } | null>(null);
  const [showImportForm, setShowImportForm] = useState(false);
  const [importUrl, setImportUrl] = useState("");
  const [importFileName, setImportFileName] = useState("");
  const [importingUrl, setImportingUrl] = useState(false);
  const [downloadingPath, setDownloadingPath] = useState<string | null>(null);
  const closePreviewModal = useCallback(() => {
    setModalOpen(false);
  }, []);

  const releasePreviewObjectUrl = useCallback(() => {
    if (!previewObjectUrlRef.current) {
      return;
    }
    URL.revokeObjectURL(previewObjectUrlRef.current);
    previewObjectUrlRef.current = null;
  }, []);

  const clearPreview = () => {
    releasePreviewObjectUrl();
    setPreviewPath(null);
    setPreview(null);
    setPreviewError(null);
    setPreviewLoading(false);
    setModalOpen(false);
    previewRequestCounterRef.current += 1;
  };

  useEffect(() => {
    return () => {
      releasePreviewObjectUrl();
    };
  }, [releasePreviewObjectUrl]);

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
    setUploadProgress(null);
    setShowImportForm(false);
    setImportUrl("");
    setImportFileName("");
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
  const activeRunId = scope === "runs" ? selectedRunId : undefined;

  const refreshListing = () => setRefreshToken((current) => current + 1);

  const openDirectory = (entry: StorageFileEntry) => {
    if (entry.type !== "directory") {
      return;
    }
    clearPreview();
    setCurrentPath(entry.path);
  };

  const openFilePicker = () => {
    if (uploading || importingUrl) {
      return;
    }
    fileInputRef.current?.click();
  };

  const handleLocalFileSelected = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file || !selectedPipeline) {
      return;
    }
    if (file.size > STORAGE_UPLOAD_MAX_BYTES) {
      onNotice?.(`File is too large. Limit: ${formatSize(STORAGE_UPLOAD_MAX_BYTES)}.`);
      return;
    }

    const destinationPath = joinStoragePath(currentPath, file.name);
    if (destinationPath.length === 0) {
      onNotice?.("Could not resolve destination path for upload.");
      return;
    }

    const existingEntry = listing?.entries.find((entry) => entry.path === destinationPath && entry.type === "file");
    const overwrite = existingEntry
      ? window.confirm(`File "${existingEntry.name}" already exists. Overwrite it?`)
      : false;
    if (existingEntry && !overwrite) {
      return;
    }

    setUploading(true);
    setUploadProgress({ uploadedBytes: 0, totalBytes: file.size });
    setLoadError(null);

    try {
      await uploadStorageFile({
        pipelineId: selectedPipeline.id,
        scope,
        runId: activeRunId,
        destinationPath,
        file,
        overwrite,
        onProgress: ({ uploadedBytes, totalBytes }) => {
          setUploadProgress({ uploadedBytes, totalBytes });
        }
      });

      onNotice?.(`Uploaded "${file.name}".`);
      refreshListing();
    } catch (error) {
      const message = error instanceof Error ? error.message : "Upload failed";
      onNotice?.(message);
      setLoadError(message);
    } finally {
      setUploading(false);
      setUploadProgress(null);
    }
  };

  const handleImportUrl = async () => {
    if (!selectedPipeline || importingUrl || uploading) {
      return;
    }

    const sourceUrl = importUrl.trim();
    if (sourceUrl.length === 0) {
      onNotice?.("Enter a source URL first.");
      return;
    }

    const candidateFileName = importFileName.trim() || inferFileNameFromUrl(sourceUrl) || "";
    const destinationPath = candidateFileName.length > 0 ? joinStoragePath(currentPath, candidateFileName) : undefined;
    const existingEntry =
      destinationPath && listing?.entries.find((entry) => entry.path === destinationPath && entry.type === "file");
    const overwrite = existingEntry
      ? window.confirm(`File "${existingEntry.name}" already exists. Overwrite it?`)
      : false;
    if (existingEntry && !overwrite) {
      return;
    }

    setImportingUrl(true);
    setLoadError(null);
    try {
      const imported = await importStorageFileFromUrl({
        pipelineId: selectedPipeline.id,
        scope,
        runId: activeRunId,
        sourceUrl,
        destinationPath,
        overwrite
      });

      setImportUrl("");
      setImportFileName("");
      setShowImportForm(false);
      onNotice?.(`Imported "${imported.path}".`);
      refreshListing();
    } catch (error) {
      const message = error instanceof Error ? error.message : "URL import failed";
      onNotice?.(message);
      setLoadError(message);
    } finally {
      setImportingUrl(false);
    }
  };

  const handleDownloadEntry = async (entry: StorageFileEntry) => {
    if (!selectedPipeline || entry.type !== "file") {
      return;
    }

    setDownloadingPath(entry.path);
    try {
      const blob = await fetchStorageRawFileBlob({
        pipelineId: selectedPipeline.id,
        scope,
        runId: activeRunId,
        path: entry.path,
        download: true
      });

      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = entry.name;
      anchor.style.display = "none";
      document.body.append(anchor);
      anchor.click();
      anchor.remove();
      window.setTimeout(() => {
        URL.revokeObjectURL(url);
      }, 0);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Download failed";
      onNotice?.(message);
      setLoadError(message);
    } finally {
      window.setTimeout(() => {
        setDownloadingPath((current) => (current === entry.path ? null : current));
      }, 500);
    }
  };

  const openFilePreview = async (entry: StorageFileEntry) => {
    if (!selectedPipeline || entry.type !== "file") {
      return;
    }

    const runId = activeRunId;
    const runIdValue = activeRunId ?? null;
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

        const blob = await fetchStorageRawFileBlob({
          pipelineId: selectedPipeline.id,
          scope,
          runId,
          path: entry.path
        });
        const rawUrl = URL.createObjectURL(blob);

        if (previewRequestCounterRef.current !== requestId) {
          URL.revokeObjectURL(rawUrl);
          return;
        }

        releasePreviewObjectUrl();
        previewObjectUrlRef.current = rawUrl;

        setPreview({
          pipelineId: selectedPipeline.id,
          scope,
          runId: runIdValue,
          kind: classification.kind,
          name: entry.name,
          path: entry.path,
          mimeType: blob.type || classification.mimeType,
          sizeBytes: blob.size || sizeBytes,
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
        runId: activeRunId,
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
              <div className="flex items-center gap-1.5">
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={uploading || importingUrl}
                  onClick={openFilePicker}
                >
                  {uploading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />}
                  Upload
                </Button>
                <DropdownMenu
                  align="right"
                  trigger={
                    <Button size="sm" variant="ghost" className="px-1.5">
                      <EllipsisVertical className="h-3.5 w-3.5" />
                    </Button>
                  }
                >
                  <DropdownMenuItem
                    icon={<Link2 className="h-3.5 w-3.5" />}
                    label="Import from URL"
                    disabled={uploading || importingUrl}
                    onClick={() => setShowImportForm((current) => !current)}
                  />
                  <DropdownMenuItem
                    icon={<RefreshCw className="h-3.5 w-3.5" />}
                    label="Refresh"
                    disabled={loading}
                    onClick={() => { triggerRefreshSpin(); refreshListing(); }}
                  />
                  <DropdownMenuDivider />
                  <DropdownMenuItem
                    icon={<ArrowUp className="h-3.5 w-3.5" />}
                    label="Go to parent"
                    disabled={loading || !listing || listing.parentPath === null}
                    onClick={goToParentPath}
                  />
                </DropdownMenu>
              </div>
            </div>

            <input
              ref={fileInputRef}
              type="file"
              className="hidden"
              onChange={(event) => {
                void handleLocalFileSelected(event);
              }}
            />

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

            {uploadProgress ? (
              <div className="space-y-1.5 rounded-xl border border-ink-800/50 bg-[var(--surface-raised)] px-3 py-2.5">
                <div className="flex items-center justify-between text-[11px]">
                  <span className="font-medium text-ink-300">Uploading...</span>
                  <span className="tabular-nums text-ink-500">
                    {formatSize(uploadProgress.uploadedBytes)} / {formatSize(uploadProgress.totalBytes)}
                  </span>
                </div>
                <div className="h-1.5 w-full overflow-hidden rounded-full bg-ink-800">
                  <div
                    className="h-full rounded-full bg-ember-500 transition-[width] duration-200 ease-out"
                    style={{
                      width: `${uploadProgress.totalBytes > 0 ? Math.min(100, (uploadProgress.uploadedBytes / uploadProgress.totalBytes) * 100) : 0}%`
                    }}
                  />
                </div>
              </div>
            ) : null}

            {showImportForm ? (
              <div className="rounded-xl border border-[var(--card-border)] bg-[var(--surface-raised)] p-3">
                <div className="space-y-2.5">
                  <label className="block space-y-1">
                    <span className="text-[11px] font-medium text-ink-400">Source URL</span>
                    <Input
                      type="url"
                      className="h-8 text-xs"
                      placeholder="https://example.com/files/report.pdf"
                      value={importUrl}
                      onChange={(event) => setImportUrl(event.target.value)}
                      disabled={importingUrl}
                    />
                  </label>

                  <label className="block space-y-1">
                    <span className="text-[11px] font-medium text-ink-400">File name (optional)</span>
                    <Input
                      type="text"
                      className="h-8 text-xs"
                      placeholder="Leave empty to use the name from URL"
                      value={importFileName}
                      onChange={(event) => setImportFileName(event.target.value)}
                      disabled={importingUrl}
                    />
                  </label>

                  <div className="flex items-center justify-end gap-1.5">
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={importingUrl}
                      onClick={() => {
                        setShowImportForm(false);
                        setImportUrl("");
                        setImportFileName("");
                      }}
                    >
                      Cancel
                    </Button>
                    <Button
                      size="sm"
                      variant="secondary"
                      disabled={importingUrl}
                      onClick={() => {
                        void handleImportUrl();
                      }}
                    >
                      {importingUrl ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Link2 className="h-3.5 w-3.5" />}
                      Import
                    </Button>
                  </div>
                </div>
              </div>
            ) : null}
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
              <div className="rounded-xl border border-[var(--card-border)] bg-[var(--surface-raised)] divide-y divide-ink-800/40">
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

                      <div className="flex items-center gap-0.5">
                        {entry.type === "file" ? (
                          <Tooltip content="Download" side="left">
                            <button
                              type="button"
                              className="shrink-0 cursor-pointer rounded-lg p-1.5 text-ink-500 transition-all duration-150 hover:bg-ink-800 hover:text-ink-200 active:scale-[0.95] disabled:pointer-events-none disabled:opacity-50"
                              disabled={downloadingPath === entry.path || deleting}
                              onClick={() => {
                                void handleDownloadEntry(entry);
                              }}
                              aria-label={`Download ${entry.name}`}
                            >
                              {downloadingPath === entry.path ? (
                                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                              ) : (
                                <Download className="h-3.5 w-3.5" />
                              )}
                            </button>
                          </Tooltip>
                        ) : null}

                        <Tooltip content="Delete" side="left">
                          <button
                            type="button"
                            className="shrink-0 cursor-pointer rounded-lg p-1.5 text-ink-500 transition-all duration-150 hover:bg-red-500/10 hover:text-red-400 active:scale-[0.95] disabled:pointer-events-none disabled:opacity-50"
                            disabled={deleting || downloadingPath === entry.path}
                            onClick={() => void handleDeleteEntry(entry)}
                            aria-label={`Delete ${entry.name}`}
                          >
                            {deleting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
                          </button>
                        </Tooltip>
                      </div>
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

                    <Button
                      variant="secondary"
                      size="sm"
                      className="w-full justify-center"
                      onClick={() => setModalOpen(true)}
                      disabled={preview.kind === "binary"}
                    >
                      <Maximize2 className="h-3.5 w-3.5" />
                      {preview.kind === "binary" ? "Preview unavailable" : "Open preview"}
                    </Button>

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
