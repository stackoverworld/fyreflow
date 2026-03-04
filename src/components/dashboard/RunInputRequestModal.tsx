import { AlertTriangle, ShieldAlert, X } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useEffect, useMemo, useState } from "react";
import type { RunInputRequest, RunStartupBlocker } from "@/lib/types";
import { Button } from "@/components/optics/button";
import { Input } from "@/components/optics/input";
import { Select } from "@/components/optics/select";
import { Textarea } from "@/components/optics/textarea";

interface RunInputRequestModalProps {
  open: boolean;
  title: string;
  summary?: string;
  requests: RunInputRequest[];
  blockers?: RunStartupBlocker[];
  initialValues?: Record<string, string>;
  busy?: boolean;
  confirmLabel?: string;
  onClose: () => void;
  onConfirm: (values: Record<string, string>) => Promise<void> | void;
}

const CUSTOM_VALUE = "__custom__";
export const MASKED_SECRET_INPUT_VALUE = "[secure]";
const REPO_SLUG_REGEX = /^[^/\s]+(?:\/[^/\s]+)+$/;
const REPO_HINT_REGEX = /(owner\/repo|repo format|without protocol|nested url)/i;
const RELATIVE_PATH_HINT_REGEX = /(without leading ["/]?\/["/]?|no leading \/|relative path)/i;

function isValidHttpUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

function formatRequestTypeLabel(type: RunInputRequest["type"]): string {
  if (type === "multiline") return "Multiline";
  if (type === "secret") return "Secret";
  if (type === "path") return "Path";
  if (type === "url") return "URL";
  if (type === "select") return "Select";
  return "Text";
}

export function normalizeSeededInputValue(request: RunInputRequest, seededRaw: string): string {
  const trimmed = seededRaw.trim();
  if (request.type === "secret" && trimmed === MASKED_SECRET_INPUT_VALUE) {
    return MASKED_SECRET_INPUT_VALUE;
  }
  if (trimmed === MASKED_SECRET_INPUT_VALUE) {
    return "";
  }
  return trimmed;
}

export function isRequiredMissing(request: RunInputRequest, values: Record<string, string>): boolean {
  if (!request.required) {
    return false;
  }

  const normalized = (values[request.key] ?? "").trim();
  if (request.type === "secret" && normalized === MASKED_SECRET_INPUT_VALUE) {
    return false;
  }

  return normalized.length === 0;
}

export function getRequestValidationError(request: RunInputRequest, values: Record<string, string>): string | null {
  const value = (values[request.key] ?? "").trim();
  if (value.length === 0) {
    return null;
  }

  if (request.type === "secret") {
    return null;
  }

  const repoHint = REPO_HINT_REGEX.test(`${request.reason} ${request.placeholder ?? ""}`);
  const relativePathHint = RELATIVE_PATH_HINT_REGEX.test(`${request.reason} ${request.placeholder ?? ""}`);

  if (/repo|repository/i.test(request.key) && repoHint) {
    if (/https?:\/\/|ssh:\/\/|git@/i.test(value)) {
      return 'Expected owner/repo format without protocol (example: "org/project").';
    }
    if (!REPO_SLUG_REGEX.test(value)) {
      return 'Use owner/repo format (example: "org/project").';
    }
    return null;
  }

  if (request.type === "url" && !isValidHttpUrl(value)) {
    return "Enter a valid URL starting with https://";
  }

  if (request.type === "path" && relativePathHint && /^\/+/.test(value)) {
    return 'Use a relative path without leading "/"';
  }

  return null;
}

export function RunInputRequestModal({
  open,
  title,
  summary,
  requests,
  blockers = [],
  initialValues,
  busy,
  confirmLabel = "Apply",
  onClose,
  onConfirm
}: RunInputRequestModalProps) {
  const [values, setValues] = useState<Record<string, string>>({});
  const [selectChoice, setSelectChoice] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!open) {
      return;
    }

    const nextValues: Record<string, string> = {};
    const nextChoice: Record<string, string> = {};

    for (const request of requests) {
      const key = request.key;
      const seededRaw = initialValues?.[key] ?? request.defaultValue ?? "";
      const seededValue = normalizeSeededInputValue(request, seededRaw);

      if (request.type === "select" && request.options && request.options.length > 0) {
        const matching = request.options.find((option) => option.value === seededValue);
        if (matching) {
          nextValues[key] = matching.value;
          nextChoice[key] = matching.value;
        } else if (seededValue.length > 0 && (request.allowCustom ?? true)) {
          nextValues[key] = seededValue;
          nextChoice[key] = CUSTOM_VALUE;
        } else {
          nextValues[key] = "";
          nextChoice[key] = "";
        }
      } else {
        nextValues[key] = seededValue;
      }
    }

    setValues(nextValues);
    setSelectChoice(nextChoice);
  }, [initialValues, open, requests]);

  const missingRequired = useMemo(
    () => requests.filter((request) => isRequiredMissing(request, values)),
    [requests, values]
  );
  const invalidFields = useMemo(
    () =>
      requests
        .map((request) => ({ request, error: getRequestValidationError(request, values) }))
        .filter((entry): entry is { request: RunInputRequest; error: string } => Boolean(entry.error)),
    [requests, values]
  );
  const canConfirm = !busy && missingRequired.length === 0 && invalidFields.length === 0;

  return (
    <AnimatePresence>
      {open ? (
        <>
          <motion.div
            className="fixed inset-0 z-[90] bg-[var(--surface-overlay)] backdrop-blur-[2px]"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => {
              if (!busy) {
                onClose();
              }
            }}
          />
          <motion.div
            className="fixed inset-0 z-[95] flex items-center justify-center p-4"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 8 }}
            transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
          >
            <section
              className="glass-panel-dense w-full max-w-[560px] overflow-hidden rounded-2xl border border-ink-700/40"
              role="dialog"
              aria-modal="true"
              aria-label={title}
            >
              <header className="flex items-start justify-between gap-3 border-b border-ink-800 px-4 py-3">
                <div>
                  <p className="text-[11px] font-semibold uppercase tracking-wider text-ink-500">AI Input Required</p>
                  <h2 className="mt-1 text-sm font-semibold text-ink-100">{title}</h2>
                  {summary ? <p className="mt-1 text-xs text-ink-400">{summary}</p> : null}
                </div>
                <button
                  type="button"
                  disabled={busy}
                  onClick={onClose}
                  className="rounded-md p-1.5 text-ink-500 transition-colors hover:bg-ink-800 hover:text-ink-100 disabled:cursor-not-allowed disabled:opacity-60"
                  aria-label="Close"
                >
                  <X className="h-4 w-4" />
                </button>
              </header>

              <div className="max-h-[70vh] space-y-4 overflow-y-auto px-4 py-4">
                {blockers.length > 0 ? (
                  <section className="rounded-xl border border-red-500/20 bg-red-500/8 p-3">
                    <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-red-300">
                      <ShieldAlert className="h-3.5 w-3.5" />
                      Blocking Issues
                    </div>
                    <div className="mt-2 space-y-2">
                      {blockers.map((blocker) => (
                        <div key={blocker.id} className="rounded-lg bg-ink-950/40 px-2.5 py-2">
                          <p className="text-xs font-medium text-red-200">{blocker.title}</p>
                          <p className="mt-0.5 text-[11px] text-red-100/80">{blocker.message}</p>
                          {blocker.details ? <p className="mt-0.5 text-[11px] text-red-200/70">{blocker.details}</p> : null}
                        </div>
                      ))}
                    </div>
                  </section>
                ) : null}

                {requests.length > 0 ? (
                  <section className="space-y-3">
                    {requests.map((request) => {
                      const key = request.key;
                      const showSelect = request.type === "select" && (request.options?.length ?? 0) > 0;
                      const useCustomInput = showSelect && selectChoice[key] === CUSTOM_VALUE;
                      const missing = isRequiredMissing(request, values);
                      const validationError = missing ? null : getRequestValidationError(request, values);

                      return (
                        <label key={key} className="block space-y-1.5">
                          <span className="flex items-center gap-1 text-xs text-ink-300">
                            {request.label}
                            {request.required ? <span className="text-red-400">*</span> : null}
                            <span className="ml-1 rounded border border-ink-700 bg-ink-900/50 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-ink-500">
                              {formatRequestTypeLabel(request.type)}
                            </span>
                          </span>

                          {showSelect ? (
                            <>
                              <Select
                                value={selectChoice[key] ?? ""}
                                disabled={busy}
                                onValueChange={(next) => {
                                  setSelectChoice((current) => ({
                                    ...current,
                                    [key]: next
                                  }));

                                  if (next === CUSTOM_VALUE) {
                                    setValues((current) => ({
                                      ...current,
                                      [key]: current[key] ?? ""
                                    }));
                                    return;
                                  }

                                  setValues((current) => ({
                                    ...current,
                                    [key]: next
                                  }));
                                }}
                                options={[
                                  { value: "", label: "Select an option" },
                                  ...(request.options ?? []).map((option) => ({
                                    value: option.value,
                                    label: option.label
                                  })),
                                  ...(request.allowCustom ?? true ? [{ value: CUSTOM_VALUE, label: "Custom value..." }] : [])
                                ]}
                              />

                              {useCustomInput ? (
                                request.type === "multiline" ? (
                                  <Textarea
                                    className="min-h-[74px]"
                                    value={values[key] ?? ""}
                                    disabled={busy}
                                    onChange={(event) =>
                                      setValues((current) => ({
                                        ...current,
                                        [key]: event.target.value
                                      }))
                                    }
                                    placeholder={request.placeholder ?? "Enter custom value"}
                                  />
                                ) : (
                                  <Input
                                    type="text"
                                    value={values[key] ?? ""}
                                    disabled={busy}
                                    onChange={(event) =>
                                      setValues((current) => ({
                                        ...current,
                                        [key]: event.target.value
                                      }))
                                    }
                                    placeholder={request.placeholder ?? "Enter custom value"}
                                  />
                                )
                              ) : null}
                            </>
                          ) : request.type === "multiline" ? (
                            <Textarea
                              className="min-h-[74px]"
                              value={values[key] ?? ""}
                              disabled={busy}
                              onChange={(event) =>
                                setValues((current) => ({
                                  ...current,
                                  [key]: event.target.value
                                }))
                              }
                              placeholder={request.placeholder}
                            />
                          ) : (
                            <Input
                              type={request.type === "secret" ? "password" : request.type === "url" ? "url" : "text"}
                              value={
                                request.type === "secret" && (values[key] ?? "") === MASKED_SECRET_INPUT_VALUE
                                  ? ""
                                  : (values[key] ?? "")
                              }
                              disabled={busy}
                              onChange={(event) =>
                                setValues((current) => ({
                                  ...current,
                                  [key]: event.target.value
                                }))
                              }
                              placeholder={
                                request.type === "secret" && (values[key] ?? "") === MASKED_SECRET_INPUT_VALUE
                                  ? "Stored securely (leave empty to reuse)"
                                  : request.placeholder
                              }
                            />
                          )}

                          <p className="text-[11px] text-ink-500">{request.reason}</p>
                          {missing ? <p className="text-[11px] text-red-400">Required field is empty.</p> : null}
                          {validationError ? <p className="text-[11px] text-red-400">{validationError}</p> : null}
                        </label>
                      );
                    })}
                  </section>
                ) : (
                  <div className="rounded-lg border border-ink-800/60 bg-ink-900/30 px-3 py-3 text-xs text-ink-500">
                    No input fields were requested.
                  </div>
                )}

                {missingRequired.length > 0 ? (
                  <div className="flex items-start gap-2 rounded-lg bg-amber-500/10 px-3 py-2 text-xs text-amber-500">
                    <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                    Missing required: {missingRequired.map((entry) => entry.label).join(", ")}
                  </div>
                ) : null}

                {invalidFields.length > 0 ? (
                  <div className="flex items-start gap-2 rounded-lg bg-amber-500/10 px-3 py-2 text-xs text-amber-500">
                    <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                    Invalid format: {invalidFields.map((entry) => entry.request.label).join(", ")}
                  </div>
                ) : null}
              </div>

              <footer className="flex items-center justify-end gap-2 border-t border-ink-800 px-4 py-3">
                <Button variant="secondary" disabled={busy} onClick={onClose}>
                  Cancel
                </Button>
                <Button
                  disabled={!canConfirm}
                  onClick={() => {
                    void onConfirm(values);
                  }}
                >
                  {confirmLabel}
                </Button>
              </footer>
            </section>
          </motion.div>
        </>
      ) : null}
    </AnimatePresence>
  );
}
