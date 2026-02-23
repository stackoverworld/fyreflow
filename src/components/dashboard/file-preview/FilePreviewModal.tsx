import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "motion/react";
import { Code2, Eye, FileText, X } from "lucide-react";
import { SegmentedControl, type Segment } from "@/components/optics/segmented-control";
import type { StorageFileContentResponse } from "@/lib/types";

type PreviewMode = "rendered" | "source";

const MODE_SEGMENTS: Segment<PreviewMode>[] = [
  { value: "rendered", label: "Rendered", icon: <Eye className="h-3.5 w-3.5" /> },
  { value: "source", label: "Source", icon: <Code2 className="h-3.5 w-3.5" /> },
];

interface FilePreviewModalProps {
  open: boolean;
  preview: StorageFileContentResponse | null;
  onClose: () => void;
}

function formatSize(sizeBytes: number): string {
  if (sizeBytes < 1024) return `${sizeBytes} B`;
  if (sizeBytes < 1024 * 1024) return `${(sizeBytes / 1024).toFixed(1)} KB`;
  return `${(sizeBytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function FilePreviewModal({ open, preview, onClose }: FilePreviewModalProps) {
  const [mode, setMode] = useState<PreviewMode>("rendered");

  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [open, onClose]);

  useEffect(() => {
    if (open) setMode("rendered");
  }, [open]);

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
              onClick={(e) => e.stopPropagation()}
            >
              {/* Header */}
              <header className="flex items-center justify-between gap-3 border-b border-ink-800 px-4 py-3">
                <div className="flex min-w-0 items-center gap-2">
                  <FileText className="h-4 w-4 shrink-0 text-ink-400" />
                  <span className="truncate text-sm font-medium text-ink-200">{preview.name}</span>
                  <span className="shrink-0 text-xs text-ink-500">
                    {preview.mimeType} · {formatSize(preview.sizeBytes)}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <SegmentedControl
                    size="sm"
                    segments={MODE_SEGMENTS}
                    value={mode}
                    onValueChange={setMode}
                  />
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

              {/* Content */}
              <div className="flex-1 overflow-hidden p-3">
                {mode === "rendered" ? (
                  <div className="h-full rounded-lg border border-ink-800/50 bg-white p-1.5">
                    <iframe
                      title={`Preview ${preview.name}`}
                      sandbox=""
                      srcDoc={preview.content}
                      className="h-full w-full rounded border-0 bg-white"
                    />
                  </div>
                ) : (
                  <pre className="h-full overflow-auto whitespace-pre-wrap rounded-lg border border-ink-800/50 bg-[var(--surface-overlay)] p-2.5 font-mono text-[11px] text-ink-300">
                    {preview.content}
                  </pre>
                )}
              </div>

              {/* Footer */}
              <footer className="border-t border-ink-800 px-4 py-2">
                <p className="text-[11px] text-ink-600">Rendered in a sandbox. Scripts and external access are blocked.</p>
              </footer>
            </div>
          </motion.div>
        </>
      ) : null}
    </AnimatePresence>,
    document.body
  );
}
