import { CheckCircle2, Download, Loader2, RefreshCw, RotateCcw, XCircle } from "lucide-react";
import { useEffect, useState } from "react";

import { Badge } from "@/components/optics/badge";
import { Button } from "@/components/optics/button";
import { applyManagedUpdate, checkManagedUpdateStatus, getManagedUpdateStatus, rollbackManagedUpdate } from "@/lib/api";
import type { UpdateServiceStatus } from "@/lib/types";

interface ActionFeedback {
  tone: "success" | "error";
  message: string;
}

type BusyAction = "check" | "update" | "rollback";

function toErrorMessage(error: unknown): string {
  return error instanceof Error && error.message.trim().length > 0
    ? error.message
    : "Action failed.";
}

function formatTimeAgo(value: string | undefined): string {
  if (!value) {
    return "Never";
  }

  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) {
    return value;
  }

  const seconds = Math.floor((Date.now() - parsed) / 1000);
  if (seconds < 60) {
    return "Just now";
  }

  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) {
    return `${minutes}m ago`;
  }

  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    return `${hours}h ago`;
  }

  return new Date(parsed).toLocaleDateString();
}

export function UpdatesSettings() {
  const [status, setStatus] = useState<UpdateServiceStatus | null>(null);
  const [busyAction, setBusyAction] = useState<BusyAction | null>(null);
  const [feedback, setFeedback] = useState<ActionFeedback | null>(null);
  const [loaded, setLoaded] = useState(false);

  const runAction = async (action: BusyAction, callback: () => Promise<void>) => {
    setBusyAction(action);
    setFeedback(null);
    try {
      await callback();
    } catch (error) {
      setFeedback({
        tone: "error",
        message: toErrorMessage(error)
      });
    } finally {
      setBusyAction(null);
    }
  };

  const handleCheck = async () => {
    await runAction("check", async () => {
      const response = await checkManagedUpdateStatus();
      setStatus(response.status);
      setFeedback({
        tone: "success",
        message: response.status.updateAvailable
          ? `Update available: ${response.status.latestTag}`
          : "You're on the latest version."
      });
    });
  };

  const handleApply = async () => {
    await runAction("update", async () => {
      const response = await applyManagedUpdate();
      setStatus(response.status);
      setFeedback({
        tone: "success",
        message: `Updated to ${response.status.currentTag}.`
      });
    });
  };

  const handleRollback = async () => {
    await runAction("rollback", async () => {
      const response = await rollbackManagedUpdate();
      setStatus(response.status);
      setFeedback({
        tone: "success",
        message: `Rolled back to ${response.status.currentTag}.`
      });
    });
  };

  useEffect(() => {
    let cancelled = false;

    void getManagedUpdateStatus()
      .then((response) => {
        if (!cancelled) {
          setStatus(response.status);
        }
      })
      .catch(() => {
        // Silent load — user can check manually
      })
      .finally(() => {
        if (!cancelled) {
          setLoaded(true);
        }
      });

    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div>
      <section className="space-y-4">
        <div className="flex items-center gap-2 text-ink-400">
          <RefreshCw className="h-3.5 w-3.5" />
          <span className="text-[11px] font-semibold uppercase tracking-wider">Release Updates</span>
        </div>

        {/* Version card */}
        <div className="rounded-lg border border-ink-800/50 bg-ink-900/35 px-4 py-3">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="truncate font-display text-base text-ink-100">
                {status?.currentTag ?? (loaded ? "Not checked yet" : "Loading…")}
              </p>
              {status?.currentVersion ? (
                <p className="mt-0.5 text-[11px] text-ink-500">{status.currentVersion}</p>
              ) : null}
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <Badge variant="neutral">{status?.channel ?? "stable"}</Badge>
              {status?.busy ? <Badge variant="running">Busy</Badge> : null}
            </div>
          </div>
          <p className="mt-2 text-[11px] text-ink-600">
            Last checked: {formatTimeAgo(status?.lastCheckedAt)}
          </p>
        </div>

        {/* Update available banner */}
        {status?.updateAvailable && status.latestTag ? (
          <div className="flex items-center justify-between gap-3 rounded-lg border border-amber-500/20 bg-amber-500/5 px-4 py-2.5">
            <div className="min-w-0">
              <p className="text-xs font-medium text-amber-400">Update available</p>
              <p className="mt-0.5 truncate font-mono text-[11px] text-ink-400">{status.latestTag}</p>
            </div>
            <Button
              size="sm"
              variant="primary"
              disabled={busyAction !== null || status.busy === true}
              onClick={handleApply}
            >
              {busyAction === "update" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}
              Update now
            </Button>
          </div>
        ) : null}

        {/* Primary action + rollback */}
        <div className="flex items-center gap-2">
          {!status?.updateAvailable ? (
            <Button
              size="sm"
              variant="secondary"
              disabled={busyAction !== null}
              onClick={handleCheck}
            >
              {busyAction === "check" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
              Check for updates
            </Button>
          ) : (
            <Button
              size="sm"
              variant="ghost"
              disabled={busyAction !== null}
              onClick={handleCheck}
            >
              {busyAction === "check" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
              Re-check
            </Button>
          )}
          {status?.rollbackAvailable && !status.busy ? (
            <Button
              size="sm"
              variant="ghost"
              disabled={busyAction !== null}
              onClick={handleRollback}
            >
              {busyAction === "rollback" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RotateCcw className="h-3.5 w-3.5" />}
              Rollback
            </Button>
          ) : null}
        </div>

        {/* Backend error */}
        {status?.lastError ? (
          <div className="flex items-start gap-2 rounded-lg bg-red-500/8 px-3 py-2 text-xs text-red-400">
            <XCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span>{status.lastError}</span>
          </div>
        ) : null}

        {/* Action feedback */}
        {feedback ? (
          <div
            className={
              feedback.tone === "error"
                ? "flex items-start gap-2 rounded-lg bg-red-500/8 px-3 py-2 text-xs text-red-400"
                : "flex items-start gap-2 rounded-lg border border-ink-800/50 bg-ink-900/35 px-3 py-2 text-xs text-ink-400"
            }
          >
            {feedback.tone === "error" ? (
              <XCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            ) : (
              <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-400" />
            )}
            <span>{feedback.message}</span>
          </div>
        ) : null}
      </section>
    </div>
  );
}
