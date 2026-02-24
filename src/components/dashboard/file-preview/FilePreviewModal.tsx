import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "motion/react";
import { Code2, Eye, FileText, Minus, Plus, RotateCcw, X } from "lucide-react";
import { SegmentedControl, type Segment } from "@/components/optics/segmented-control";
import { Button } from "@/components/optics/button";
import { buildStorageRawDirectoryUrl } from "@/lib/api";
import type { FilePreviewModalData } from "@/components/dashboard/file-preview/previewModel";

type HtmlPreviewMode = "rendered" | "source";
const ZOOM_MIN = 0.25;
const ZOOM_MAX = 3;

const HTML_MODE_SEGMENTS: Segment<HtmlPreviewMode>[] = [
  { value: "rendered", label: "Rendered", icon: <Eye className="h-3.5 w-3.5" /> },
  { value: "source", label: "Source", icon: <Code2 className="h-3.5 w-3.5" /> },
];

interface FilePreviewModalProps {
  open: boolean;
  preview: FilePreviewModalData | null;
  onClose: () => void;
}

function formatSize(sizeBytes: number): string {
  if (!Number.isFinite(sizeBytes) || sizeBytes <= 0) {
    return "0 B";
  }
  if (sizeBytes < 1024) return `${sizeBytes} B`;
  if (sizeBytes < 1024 * 1024) return `${(sizeBytes / 1024).toFixed(1)} KB`;
  return `${(sizeBytes / (1024 * 1024)).toFixed(1)} MB`;
}

function clampZoom(value: number): number {
  return Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, value));
}

function getDirectoryPath(filePath: string): string {
  const separatorIndex = filePath.lastIndexOf("/");
  if (separatorIndex < 0) {
    return "";
  }
  return filePath.slice(0, separatorIndex + 1);
}

function escapeHtmlAttribute(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function shouldKeepAssetUrl(value: string): boolean {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return true;
  }
  return /^(?:[a-zA-Z][a-zA-Z0-9+.-]*:|\/\/|#)/.test(trimmed);
}

function resolveScopedAssetUrl(
  value: string,
  directoryBaseHref: string,
  rootBaseHref: string
): string {
  if (shouldKeepAssetUrl(value)) {
    return value;
  }

  const trimmed = value.trim();
  const useRootBase = trimmed.startsWith("/");
  const normalizedPath = useRootBase ? trimmed.replace(/^\/+/, "") : trimmed;
  const baseHref = (useRootBase ? rootBaseHref : directoryBaseHref).trim();
  if (baseHref.length === 0) {
    return value;
  }

  try {
    const baseUrl = new URL(baseHref);
    const resolved = new URL(normalizedPath, baseUrl);
    for (const [key, tokenValue] of baseUrl.searchParams.entries()) {
      if (!resolved.searchParams.has(key)) {
        resolved.searchParams.set(key, tokenValue);
      }
    }
    return resolved.toString();
  } catch {
    return value;
  }
}

function rewriteHtmlAssetUrls(
  content: string,
  directoryBaseHref: string,
  rootBaseHref: string
): string {
  const rewriteUrlValue = (value: string): string =>
    resolveScopedAssetUrl(value, directoryBaseHref, rootBaseHref);

  const withTagUrls = content.replace(
    /(\b(?:src|href|poster)\s*=\s*["'])([^"']+)(["'])/gi,
    (_match, prefix: string, value: string, suffix: string) =>
      `${prefix}${escapeHtmlAttribute(rewriteUrlValue(value))}${suffix}`
  );

  const withCssUrls = withTagUrls.replace(
    /(url\(\s*["']?)([^"')]+)(["']?\s*\))/gi,
    (_match, prefix: string, value: string, suffix: string) =>
      `${prefix}${rewriteUrlValue(value)}${suffix}`
  );

  return withCssUrls.replace(
    /(\bsrcset\s*=\s*["'])([^"']+)(["'])/gi,
    (_match, prefix: string, value: string, suffix: string) => {
      const rewritten = value
        .split(",")
        .map((candidate) => {
          const token = candidate.trim();
          if (token.length === 0) {
            return token;
          }
          const separator = token.search(/\s/);
          const urlPart = separator === -1 ? token : token.slice(0, separator);
          const descriptor = separator === -1 ? "" : token.slice(separator);
          const normalizedUrlPart = urlPart.replace(/^['"]|['"]$/g, "");
          return `${rewriteUrlValue(normalizedUrlPart)}${descriptor}`;
        })
        .join(", ");
      return `${prefix}${escapeHtmlAttribute(rewritten)}${suffix}`;
    }
  );
}

function injectHtmlPreviewMetadata(content: string, directoryBaseHref: string, rootBaseHref: string): string {
  const rewrittenContent = rewriteHtmlAssetUrls(content, directoryBaseHref, rootBaseHref);
  const headBlocks: string[] = [];
  headBlocks.push(
    "<style>",
    "html, body { margin: 0; min-height: 100%; overflow: auto; }",
    "img, svg, video, canvas { max-width: 100%; height: auto; }",
    "</style>"
  );
  const injection = headBlocks.join("");

  if (/<head[\s>]/i.test(rewrittenContent)) {
    return rewrittenContent.replace(/<head([\s>])/i, `<head$1${injection}`);
  }

  if (/<html[\s>]/i.test(rewrittenContent)) {
    return rewrittenContent.replace(/<html([\s>])/i, `<html$1<head>${injection}</head>`);
  }

  return `<!doctype html><html><head>${injection}</head><body>${rewrittenContent}</body></html>`;
}

function normalizeJsonContent(content: string): string {
  try {
    const parsed = JSON.parse(content);
    return JSON.stringify(parsed, null, 2);
  } catch {
    return content;
  }
}

export const FilePreviewModal = memo(function FilePreviewModal({
  open,
  preview,
  onClose
}: FilePreviewModalProps) {
  const [htmlMode, setHtmlMode] = useState<HtmlPreviewMode>("rendered");
  const [zoom, setZoom] = useState(1);
  const iframeRef = useRef<HTMLIFrameElement | null>(null);

  const isHtml = preview?.kind === "html";
  const isSourceText = preview?.kind === "text" || preview?.kind === "json" || preview?.kind === "markdown";
  const isRawImage = preview?.kind === "image";
  const isRawPdf = preview?.kind === "pdf";
  const isRawVideo = preview?.kind === "video";
  const isRawAudio = preview?.kind === "audio";

  useEffect(() => {
    if (!open) return;
    const handler = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [open, onClose]);

  useEffect(() => {
    if (!open || !preview) {
      return;
    }

    setHtmlMode("rendered");
    setZoom(1);
  }, [open, preview]);

  const htmlBaseHref = useMemo(() => {
    if (!preview || preview.kind !== "html") {
      return "";
    }

    try {
      return buildStorageRawDirectoryUrl({
        pipelineId: preview.pipelineId,
        scope: preview.scope,
        runId: preview.runId,
        path: getDirectoryPath(preview.path)
      });
    } catch {
      return "";
    }
  }, [preview]);

  const htmlRootBaseHref = useMemo(() => {
    if (!preview || preview.kind !== "html") {
      return "";
    }

    try {
      return buildStorageRawDirectoryUrl({
        pipelineId: preview.pipelineId,
        scope: preview.scope,
        runId: preview.runId,
        path: ""
      });
    } catch {
      return "";
    }
  }, [preview]);

  const renderedHtml = useMemo(() => {
    if (!preview || preview.kind !== "html") {
      return "";
    }

    return injectHtmlPreviewMetadata(preview.content ?? "", htmlBaseHref, htmlRootBaseHref);
  }, [htmlBaseHref, htmlRootBaseHref, preview]);

  const renderedText = useMemo(() => {
    if (!preview || !isSourceText) {
      return "";
    }
    if (preview.kind === "json") {
      return normalizeJsonContent(preview.content ?? "");
    }
    return preview.content ?? "";
  }, [isSourceText, preview]);

  const applyZoomToFrameDocument = useCallback((nextZoom: number) => {
    const frameDocument = iframeRef.current?.contentDocument;
    if (!frameDocument) {
      return;
    }

    const rootElement = frameDocument.documentElement;
    const bodyElement = frameDocument.body;
    if (!rootElement || !bodyElement) {
      return;
    }

    // Keep browser-native scroll behavior inside the iframe while zooming.
    rootElement.style.overflow = "auto";
    bodyElement.style.overflow = "auto";
    bodyElement.style.margin = "0";
    (rootElement.style as CSSStyleDeclaration & { zoom?: string }).zoom = String(nextZoom);
  }, []);

  const handleHtmlLoad = useCallback(() => {
    applyZoomToFrameDocument(zoom);
  }, [applyZoomToFrameDocument, zoom]);

  useEffect(() => {
    if (!open || !isHtml || htmlMode !== "rendered") {
      return;
    }

    applyZoomToFrameDocument(zoom);
  }, [applyZoomToFrameDocument, htmlMode, isHtml, open, zoom]);

  const handleZoomIn = useCallback(() => {
    setZoom((current) => clampZoom(current * 1.1));
  }, []);

  const handleZoomOut = useCallback(() => {
    setZoom((current) => clampZoom(current / 1.1));
  }, []);

  const handleZoomReset = useCallback(() => {
    setZoom(1);
  }, []);

  const zoomPercent = Math.round(zoom * 100);
  const canResetZoom = Math.abs(zoom - 1) > 0.005;
  const canShowHtmlControls = isHtml && htmlMode === "rendered";

  return createPortal(
    <AnimatePresence>
      {open && preview ? (
        <>
          <motion.div
            key="file-preview-backdrop"
            className="fixed inset-0 z-[90] bg-[var(--surface-overlay)] backdrop-blur-[2px]"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
          />
          <motion.div
            key="file-preview-container"
            className="fixed inset-0 z-[95] flex items-center justify-center p-4"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 8 }}
            transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
            onClick={onClose}
          >
            <div
              className="glass-panel-dense flex w-full max-w-[960px] flex-col rounded-2xl border border-ink-700/40"
              style={{ height: "min(85vh, 900px)" }}
              role="dialog"
              aria-modal="true"
              aria-label={`Preview ${preview.name}`}
              onClick={(event) => event.stopPropagation()}
            >
              <header className="flex items-center justify-between gap-3 border-b border-ink-800 px-4 py-3">
                <div className="flex min-w-0 items-center gap-2">
                  <FileText className="h-4 w-4 shrink-0 text-ink-400" />
                  <span className="truncate text-sm font-medium text-ink-200">{preview.name}</span>
                  <span className="shrink-0 text-xs text-ink-500">
                    {preview.mimeType} · {formatSize(preview.sizeBytes)}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  {canShowHtmlControls ? (
                    <div className="flex items-center gap-1">
                      <Button size="sm" variant="ghost" onClick={handleZoomOut} aria-label="Zoom out">
                        <Minus className="h-3.5 w-3.5" />
                      </Button>
                      <button
                        type="button"
                        className="min-w-[58px] cursor-default rounded-md border border-ink-800/50 px-2 py-1 text-center text-[11px] text-ink-400"
                        aria-label={`Zoom ${zoomPercent}%`}
                      >
                        {zoomPercent}%
                      </button>
                      <Button size="sm" variant="ghost" onClick={handleZoomIn} aria-label="Zoom in">
                        <Plus className="h-3.5 w-3.5" />
                      </Button>
                      <Button size="sm" variant="ghost" onClick={handleZoomReset} disabled={!canResetZoom}>
                        <RotateCcw className="h-3.5 w-3.5" />
                        100%
                      </Button>
                    </div>
                  ) : null}

                  {isHtml ? (
                    <SegmentedControl
                      size="sm"
                      segments={HTML_MODE_SEGMENTS}
                      value={htmlMode}
                      onValueChange={setHtmlMode}
                    />
                  ) : null}

                  <button
                    type="button"
                    onClick={onClose}
                    className="rounded-md p-1.5 text-ink-500 transition-colors hover:bg-ink-800 hover:text-ink-100 cursor-pointer"
                    aria-label="Close"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>
              </header>

              <div className="flex-1 overflow-hidden p-3">
                {isHtml ? (
                  htmlMode === "rendered" ? (
                    <div className="h-full overflow-hidden rounded-lg border border-ink-800/50 bg-[var(--surface-inset)]">
                      <iframe
                        ref={iframeRef}
                        title={`Preview ${preview.name}`}
                        sandbox="allow-same-origin"
                        srcDoc={renderedHtml}
                        className="h-full w-full border-0 bg-transparent"
                        scrolling="auto"
                        onLoad={handleHtmlLoad}
                      />
                    </div>
                  ) : (
                    <pre className="h-full overflow-auto whitespace-pre-wrap rounded-lg border border-ink-800/50 bg-[var(--surface-overlay)] p-2.5 font-mono text-[11px] text-ink-300">
                      {preview.content}
                    </pre>
                  )
                ) : null}

                {!isHtml && isSourceText ? (
                  <pre className="h-full overflow-auto whitespace-pre-wrap rounded-lg border border-ink-800/50 bg-[var(--surface-overlay)] p-2.5 font-mono text-[11px] text-ink-300">
                    {renderedText}
                  </pre>
                ) : null}

                {!isHtml && isRawImage ? (
                  <div className="flex h-full items-center justify-center overflow-auto rounded-lg border border-ink-800/50 bg-[var(--surface-base)] p-3">
                    {preview.rawUrl ? (
                      <img src={preview.rawUrl} alt={preview.name} className="max-h-full max-w-full object-contain" />
                    ) : (
                      <p className="text-xs text-ink-500">Image preview is unavailable.</p>
                    )}
                  </div>
                ) : null}

                {!isHtml && isRawPdf ? (
                  <div className="h-full overflow-hidden rounded-lg border border-ink-800/50 bg-[var(--surface-base)]">
                    {preview.rawUrl ? (
                      <iframe title={`Preview ${preview.name}`} src={preview.rawUrl} className="h-full w-full border-0 bg-white" />
                    ) : (
                      <div className="flex h-full items-center justify-center text-xs text-ink-500">PDF preview is unavailable.</div>
                    )}
                  </div>
                ) : null}

                {!isHtml && isRawVideo ? (
                  <div className="flex h-full items-center justify-center rounded-lg border border-ink-800/50 bg-[var(--surface-base)] p-3">
                    {preview.rawUrl ? (
                      <video controls className="h-full max-h-full w-full rounded bg-black" src={preview.rawUrl} />
                    ) : (
                      <p className="text-xs text-ink-500">Video preview is unavailable.</p>
                    )}
                  </div>
                ) : null}

                {!isHtml && isRawAudio ? (
                  <div className="flex h-full items-center justify-center rounded-lg border border-ink-800/50 bg-[var(--surface-base)] p-6">
                    {preview.rawUrl ? (
                      <audio controls className="w-full max-w-2xl" src={preview.rawUrl} />
                    ) : (
                      <p className="text-xs text-ink-500">Audio preview is unavailable.</p>
                    )}
                  </div>
                ) : null}

                {!isHtml && preview.kind === "binary" ? (
                  <div className="flex h-full items-center justify-center rounded-lg border border-ink-800/50 bg-[var(--surface-raised)] px-4 py-6 text-center text-xs text-ink-500">
                    {preview.message ?? "Preview is unavailable for this file type."}
                  </div>
                ) : null}
              </div>

              <footer className="border-t border-ink-800 px-4 py-2">
                <p className="text-[11px] text-ink-600">
                  {isHtml
                    ? "Rendered in a sandbox. Scripts are blocked; relative assets load only from scoped storage."
                    : "Preview is limited to supported file formats and safe storage scope only."}
                </p>
                {preview.truncated ? (
                  <p className="mt-1 text-[11px] text-amber-500">
                    Large file: showing first {formatSize(preview.maxBytes ?? 0)}.
                  </p>
                ) : null}
              </footer>
            </div>
          </motion.div>
        </>
      ) : null}
    </AnimatePresence>,
    document.body
  );
});
