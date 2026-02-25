import { CheckCircle2, Download, Loader2, RefreshCw, RotateCcw, Save, XCircle } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { Badge } from "@/components/optics/badge";
import { Button } from "@/components/optics/button";
import { Input } from "@/components/optics/input";
import { applyUpdaterUpdate, checkUpdaterStatus, getUpdaterStatus, rollbackUpdaterUpdate, type UpdaterClientConfig } from "@/lib/api";
import type { UpdateServiceStatus } from "@/lib/types";
import { loadUpdateSettings, saveUpdateSettings, type UpdateSettings } from "@/lib/updateSettingsStorage";

interface ActionFeedback {
  tone: "success" | "error";
  message: string;
}

type BusyAction = "save" | "check" | "update" | "rollback";

function toErrorMessage(error: unknown): string {
  return error instanceof Error && error.message.trim().length > 0
    ? error.message
    : "Action failed.";
}

function sameSettings(left: UpdateSettings, right: UpdateSettings): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function buildUpdaterClientConfig(settings: UpdateSettings): UpdaterClientConfig {
  return {
    baseUrl: settings.updaterBaseUrl,
    authToken: settings.updaterAuthToken
  };
}

function formatTimestamp(value: string | undefined): string {
  if (!value) {
    return "-";
  }

  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) {
    return value;
  }

  return new Date(parsed).toLocaleString();
}

export function UpdatesSettings() {
  const [savedSettings, setSavedSettings] = useState<UpdateSettings>(() => loadUpdateSettings());
  const [draftSettings, setDraftSettings] = useState<UpdateSettings>(() => loadUpdateSettings());
  const [status, setStatus] = useState<UpdateServiceStatus | null>(null);
  const [busyAction, setBusyAction] = useState<BusyAction | null>(null);
  const [feedback, setFeedback] = useState<ActionFeedback | null>(null);

  const isDirty = useMemo(
    () => !sameSettings(savedSettings, draftSettings),
    [savedSettings, draftSettings]
  );

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

  const handleSave = async () => {
    await runAction("save", async () => {
      const next = saveUpdateSettings(draftSettings);
      setSavedSettings(next);
      setDraftSettings(next);
      setFeedback({
        tone: "success",
        message: "Updater connection settings saved."
      });
    });
  };

  const handleReload = () => {
    const current = loadUpdateSettings();
    setSavedSettings(current);
    setDraftSettings(current);
    setFeedback({
      tone: "success",
      message: "Loaded saved updater settings."
    });
  };

  const handleCheck = async () => {
    await runAction("check", async () => {
      if (isDirty) {
        throw new Error("Save updater settings before checking updates.");
      }

      const response = await checkUpdaterStatus(buildUpdaterClientConfig(savedSettings));
      setStatus(response.status);
      setFeedback({
        tone: "success",
        message: response.status.updateAvailable
          ? `Update available: ${response.status.latestTag}`
          : "You are on the latest version."
      });
    });
  };

  const handleApply = async () => {
    await runAction("update", async () => {
      if (isDirty) {
        throw new Error("Save updater settings before applying update.");
      }

      const response = await applyUpdaterUpdate(buildUpdaterClientConfig(savedSettings));
      setStatus(response.status);
      setFeedback({
        tone: "success",
        message: `Updated to ${response.status.currentTag}.`
      });
    });
  };

  const handleRollback = async () => {
    await runAction("rollback", async () => {
      if (isDirty) {
        throw new Error("Save updater settings before rollback.");
      }

      const response = await rollbackUpdaterUpdate(buildUpdaterClientConfig(savedSettings));
      setStatus(response.status);
      setFeedback({
        tone: "success",
        message: `Rollback complete. Current version: ${response.status.currentTag}.`
      });
    });
  };

  useEffect(() => {
    let cancelled = false;
    if (isDirty) {
      return;
    }

    void getUpdaterStatus(buildUpdaterClientConfig(savedSettings))
      .then((response) => {
        if (cancelled) {
          return;
        }
        setStatus(response.status);
      })
      .catch((error) => {
        if (cancelled) {
          return;
        }
        setFeedback({
          tone: "error",
          message: toErrorMessage(error)
        });
      });

    return () => {
      cancelled = true;
    };
  }, [isDirty, savedSettings]);

  return (
    <div>
      <section className="space-y-4">
        <div className="flex items-center gap-2 text-ink-400">
          <Download className="h-3.5 w-3.5" />
          <span className="text-[11px] font-semibold uppercase tracking-wider">Updater Connection</span>
        </div>

        <label className="block space-y-1.5">
          <span className="text-xs text-ink-400">Updater API base URL</span>
          <Input
            value={draftSettings.updaterBaseUrl}
            onChange={(event) =>
              setDraftSettings((current) => ({
                ...current,
                updaterBaseUrl: event.target.value
              }))
            }
            placeholder="http://localhost:8788"
          />
        </label>

        <label className="block space-y-1.5">
          <span className="text-xs text-ink-400">Updater admin token</span>
          <Input
            type="password"
            value={draftSettings.updaterAuthToken}
            onChange={(event) =>
              setDraftSettings((current) => ({
                ...current,
                updaterAuthToken: event.target.value
              }))
            }
            placeholder="UPDATER_AUTH_TOKEN"
          />
        </label>

        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="secondary" disabled={busyAction !== null || !isDirty} onClick={handleSave}>
            {busyAction === "save" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
            Save
          </Button>
          <Button size="sm" variant="ghost" disabled={busyAction !== null} onClick={handleReload}>
            Reload
          </Button>
        </div>
      </section>

      <div className="my-5 h-px bg-[var(--divider)]" />

      <section className="space-y-4">
        <div className="flex items-center gap-2 text-ink-400">
          <RefreshCw className="h-3.5 w-3.5" />
          <span className="text-[11px] font-semibold uppercase tracking-wider">Release Updates</span>
        </div>

        <div className="rounded-lg border border-ink-800/50 bg-ink-900/35 px-3 py-2.5">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant={status?.updateAvailable ? "warning" : "neutral"}>
              {status?.updateAvailable ? "Update Available" : "Current"}
            </Badge>
            {status?.busy ? <Badge variant="running">Updater Busy</Badge> : null}
            <span className="text-[11px] text-ink-500">Channel: {status?.channel ?? "stable"}</span>
          </div>

          <div className="mt-2 grid gap-1 text-[11px] text-ink-500">
            <p>Current tag: {status?.currentTag ?? "-"}</p>
            <p>Current core version: {status?.currentVersion ?? "-"}</p>
            <p>Latest tag: {status?.latestTag ?? "-"}</p>
            <p>Latest published: {formatTimestamp(status?.latestPublishedAt)}</p>
            <p>Last checked: {formatTimestamp(status?.lastCheckedAt)}</p>
            <p>Last applied: {formatTimestamp(status?.lastAppliedAt)}</p>
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="secondary" disabled={busyAction !== null || isDirty} onClick={handleCheck}>
            {busyAction === "check" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
            Check
          </Button>
          <Button
            size="sm"
            variant="secondary"
            disabled={busyAction !== null || isDirty || !status?.latestTag || status.busy === true || status.updateAvailable !== true}
            onClick={handleApply}
          >
            {busyAction === "update" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}
            Update
          </Button>
          <Button
            size="sm"
            variant="ghost"
            disabled={busyAction !== null || isDirty || !status?.rollbackAvailable || status.busy === true}
            onClick={handleRollback}
          >
            {busyAction === "rollback" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RotateCcw className="h-3.5 w-3.5" />}
            Rollback
          </Button>
        </div>

        {status?.lastError ? (
          <div className="flex items-start gap-2 rounded-lg bg-red-500/8 px-3 py-2 text-xs text-red-400">
            <XCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span>{status.lastError}</span>
          </div>
        ) : null}

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
