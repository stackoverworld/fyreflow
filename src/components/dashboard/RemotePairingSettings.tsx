import { CheckCircle2, Copy, KeyRound, Link2, Loader2, RefreshCw, ShieldCheck, XCircle } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { Badge } from "@/components/optics/badge";
import { Button } from "@/components/optics/button";
import { Input } from "@/components/optics/input";
import { Select } from "@/components/optics/select";
import {
  approvePairingSession,
  cancelPairingSession,
  claimPairingSession,
  createPairingSession,
  getPairingSession,
  getState,
  subscribePairingSessionStatus
} from "@/lib/api";
import {
  getActiveConnectionSettings,
  loadConnectionSettings,
  notifyConnectionSettingsChanged,
  setConnectionSettings,
  type ConnectionSettings,
  type RuntimeConnectionMode
} from "@/lib/connectionSettingsStorage";
import type { PairingSessionCreated, PairingSessionStatus, PairingSessionSummary } from "@/lib/types";
import {
  getActiveApiBaseUrlField,
  getApiTokenSourceHint,
  getPairingRealtimeErrorMessage
} from "@/components/dashboard/remotePairingSettingsModel";

interface PairingSessionState extends PairingSessionCreated {
  deviceToken?: string;
}

interface ActionFeedback {
  tone: "success" | "error";
  message: string;
}

type BusyAction =
  | "save_connection"
  | "validate_connection"
  | "create_pairing"
  | "refresh_pairing"
  | "approve_pairing"
  | "claim_pairing"
  | "cancel_pairing";

function getPairingStatusBadge(status: PairingSessionStatus): {
  label: string;
  variant: "neutral" | "success" | "running" | "warning" | "danger";
} {
  if (status === "pending") {
    return { label: "Pending Approval", variant: "warning" };
  }

  if (status === "approved") {
    return { label: "Approved", variant: "running" };
  }

  if (status === "claimed") {
    return { label: "Claimed", variant: "success" };
  }

  if (status === "cancelled") {
    return { label: "Cancelled", variant: "danger" };
  }

  return { label: "Expired", variant: "danger" };
}

function mergePairingSessionState(
  current: PairingSessionState | null,
  next: PairingSessionSummary
): PairingSessionState | null {
  if (!current) {
    return current;
  }

  return {
    ...current,
    ...next
  };
}

function toErrorMessage(error: unknown): string {
  return error instanceof Error && error.message.trim().length > 0
    ? error.message
    : "Action failed.";
}

function sameConnectionSettings(left: ConnectionSettings, right: ConnectionSettings): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

export function RemotePairingSettings() {
  const [savedConnection, setSavedConnection] = useState<ConnectionSettings>(() => loadConnectionSettings());
  const [connectionDraft, setConnectionDraft] = useState<ConnectionSettings>(() => loadConnectionSettings());
  const [session, setSession] = useState<PairingSessionState | null>(null);
  const [deviceLabel, setDeviceLabel] = useState("");
  const [busyAction, setBusyAction] = useState<BusyAction | null>(null);
  const [connectionFeedback, setConnectionFeedback] = useState<ActionFeedback | null>(null);
  const [pairingFeedback, setPairingFeedback] = useState<ActionFeedback | null>(null);
  const [copiedCode, setCopiedCode] = useState(false);

  const activeConnection = useMemo(
    () => getActiveConnectionSettings(savedConnection),
    [savedConnection]
  );

  const isConnectionDirty = useMemo(
    () => !sameConnectionSettings(savedConnection, connectionDraft),
    [connectionDraft, savedConnection]
  );
  const activeApiBaseUrlField = useMemo(() => getActiveApiBaseUrlField(connectionDraft), [connectionDraft]);
  const apiTokenSourceHint = useMemo(() => getApiTokenSourceHint(connectionDraft.mode), [connectionDraft.mode]);

  useEffect(() => {
    if (!session?.id) {
      return;
    }

    return subscribePairingSessionStatus(session.id, {
      onEvent: (event) => {
        if (event.event !== "status") {
          return;
        }

        const payload = event.data as { session?: PairingSessionSummary };
        if (!payload.session) {
          return;
        }

        setSession((current) => mergePairingSessionState(current, payload.session));
      },
      onError: (nextError) => {
        setPairingFeedback({
          tone: "error",
          message: getPairingRealtimeErrorMessage(nextError.message)
        });
      }
    });
  }, [session?.id]);

  const statusBadge = useMemo(() => {
    if (!session) {
      return null;
    }
    return getPairingStatusBadge(session.status);
  }, [session]);

  const requiresPairingAdminToken = activeConnection.mode === "remote";
  const hasActiveApiToken = activeConnection.apiToken.trim().length > 0;
  const canApprove =
    (session?.status === "pending" || session?.status === "approved") &&
    (!requiresPairingAdminToken || hasActiveApiToken);
  const canClaim = session?.status === "approved";
  const canCancel =
    (session?.status === "pending" || session?.status === "approved") &&
    (!requiresPairingAdminToken || hasActiveApiToken);

  const runConnectionAction = async (action: BusyAction, callback: () => Promise<void>) => {
    setBusyAction(action);
    setConnectionFeedback(null);
    try {
      await callback();
    } catch (nextError) {
      setConnectionFeedback({
        tone: "error",
        message: toErrorMessage(nextError)
      });
    } finally {
      setBusyAction(null);
    }
  };

  const runPairingAction = async (action: BusyAction, callback: () => Promise<void>) => {
    setBusyAction(action);
    setPairingFeedback(null);
    try {
      await callback();
    } catch (nextError) {
      setPairingFeedback({
        tone: "error",
        message: toErrorMessage(nextError)
      });
    } finally {
      setBusyAction(null);
    }
  };

  const handleSaveConnection = async () => {
    await runConnectionAction("save_connection", async () => {
      const next = setConnectionSettings(connectionDraft);
      setSavedConnection(next);
      setConnectionDraft(next);
      notifyConnectionSettingsChanged();
      setConnectionFeedback({
        tone: "success",
        message: `Connection settings saved (${next.mode} mode).`
      });
    });
  };

  const handleValidateConnection = async () => {
    await runConnectionAction("validate_connection", async () => {
      if (isConnectionDirty) {
        throw new Error("Save connection settings before validation.");
      }

      const state = await getState();
      setConnectionFeedback({
        tone: "success",
        message: `Connection OK: ${state.pipelines.length} pipelines, ${state.runs.length} runs.`
      });
    });
  };

  const handleReloadDraftFromSaved = () => {
    const current = loadConnectionSettings();
    setSavedConnection(current);
    setConnectionDraft(current);
    setConnectionFeedback({
      tone: "success",
      message: "Loaded saved connection settings."
    });
  };

  const handleCreate = async () => {
    await runPairingAction("create_pairing", async () => {
      const platform =
        typeof window !== "undefined" && window.desktop?.platform
          ? window.desktop.platform
          : typeof navigator !== "undefined"
            ? navigator.platform
            : "web";
      const clientName =
        typeof window !== "undefined" && window.desktop?.isElectron
          ? "FyreFlow Desktop"
          : "FyreFlow Web";

      const response = await createPairingSession({
        clientName,
        platform
      });

      setSession({
        ...response.session
      });
      setDeviceLabel("");
      setPairingFeedback({
        tone: "success",
        message: "Pairing session started. Next: 1) Approve Device, 2) Claim Token. No extra link required."
      });
    });
  };

  const handleRefresh = async () => {
    if (!session) {
      return;
    }

    await runPairingAction("refresh_pairing", async () => {
      const response = await getPairingSession(session.id);
      setSession((current) => {
        if (!current) {
          return current;
        }

        return {
          ...current,
          ...response.session
        };
      });
      setPairingFeedback({
        tone: "success",
        message: "Session state refreshed."
      });
    });
  };

  const handleApprove = async () => {
    if (!session) {
      return;
    }

    await runPairingAction("approve_pairing", async () => {
      const response = await approvePairingSession(
        session.id,
        session.code,
        deviceLabel.trim()
      );
      setSession((current) => mergePairingSessionState(current, response.session));
      setPairingFeedback({
        tone: "success",
        message: "Pairing approved. Desktop can now claim device token."
      });
    });
  };

  const handleClaim = async () => {
    if (!session) {
      return;
    }

    await runPairingAction("claim_pairing", async () => {
      const response = await claimPairingSession(session.id, session.code);
      setSession((current) => {
        const next = mergePairingSessionState(current, response.session);
        if (!next) {
          return next;
        }

        return {
          ...next,
          deviceToken: response.deviceToken
        };
      });

      const nextConnection = setConnectionSettings({
        ...savedConnection,
        deviceToken: response.deviceToken,
        apiToken:
          savedConnection.apiToken.trim().length > 0
            ? savedConnection.apiToken
            : response.deviceToken
      });
      setSavedConnection(nextConnection);
      setConnectionDraft(nextConnection);
      notifyConnectionSettingsChanged();
      setPairingFeedback({
        tone: "success",
        message:
          savedConnection.apiToken.trim().length > 0
            ? "Device token issued and saved in connection settings."
            : "Device token issued and applied as active API token."
      });
    });
  };

  const handleCancel = async () => {
    if (!session) {
      return;
    }

    await runPairingAction("cancel_pairing", async () => {
      const response = await cancelPairingSession(session.id);
      setSession((current) => mergePairingSessionState(current, response.session));
      setPairingFeedback({
        tone: "success",
        message: "Pairing session cancelled."
      });
    });
  };

  const handleCopyCode = async () => {
    if (!session || typeof navigator === "undefined" || !navigator.clipboard) {
      setPairingFeedback({
        tone: "error",
        message: "Clipboard is unavailable in this runtime."
      });
      return;
    }

    try {
      await navigator.clipboard.writeText(session.code);
      setCopiedCode(true);
      window.setTimeout(() => {
        setCopiedCode(false);
      }, 1200);
    } catch (nextError) {
      setPairingFeedback({
        tone: "error",
        message: toErrorMessage(nextError)
      });
    }
  };

  return (
    <div>
      <section className="space-y-4">
        <div className="flex items-center gap-2 text-ink-400">
          <Link2 className="h-3.5 w-3.5" />
          <span className="text-[11px] font-semibold uppercase tracking-wider">Connection</span>
        </div>

        <div className="rounded-lg border border-ink-800/50 bg-ink-900/35 px-3 py-2.5">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant={activeConnection.mode === "remote" ? "running" : "neutral"}>
              Mode: {activeConnection.mode}
            </Badge>
            <span className="text-[11px] text-ink-500">Active endpoint: {activeConnection.apiBaseUrl}</span>
          </div>
        </div>

        <label className="block space-y-1.5">
          <span className="text-xs text-ink-400">Runtime mode</span>
          <Select
            value={connectionDraft.mode}
            onValueChange={(value) => {
              setConnectionDraft((current) => ({
                ...current,
                mode: value as RuntimeConnectionMode
              }));
            }}
            options={[
              { value: "local", label: "local" },
              { value: "remote", label: "remote" }
            ]}
          />
        </label>

        <label className="block space-y-1.5">
          <span className="text-xs text-ink-400">{activeApiBaseUrlField.label}</span>
          <Input
            value={activeApiBaseUrlField.value}
            onChange={(event) =>
              setConnectionDraft((current) =>
                current.mode === "remote"
                  ? {
                      ...current,
                      remoteApiBaseUrl: event.target.value
                    }
                  : {
                      ...current,
                      localApiBaseUrl: event.target.value
                    }
              )
            }
            placeholder={activeApiBaseUrlField.placeholder}
          />
          <p className="text-[11px] text-ink-600">
            Only the active mode URL is shown. Switch mode if you need to edit the other endpoint.
          </p>
        </label>

        <label className="block space-y-1.5">
          <span className="text-xs text-ink-400">API token</span>
          <Input
            type="password"
            value={connectionDraft.apiToken}
            onChange={(event) =>
              setConnectionDraft((current) => ({
                ...current,
                apiToken: event.target.value
              }))
            }
            placeholder="Optional if backend auth is disabled"
          />
        </label>

        <div className="rounded-lg border border-ink-800/50 bg-ink-900/35 px-3 py-2.5">
          <div className="flex items-start gap-2">
            <KeyRound className="mt-0.5 h-3.5 w-3.5 shrink-0 text-ink-400" />
            <div className="space-y-1">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-ink-400">Token Help</p>
              <p className="text-[11px] text-ink-500">
                Needed only when backend auth is enabled. The token is used for REST and realtime WS requests.
              </p>
              <p className="text-[11px] text-ink-500">
                Source:{" "}
                <span className="rounded bg-ink-950 px-1 py-0.5 font-mono text-[10px] text-ink-300">
                  DASHBOARD_API_TOKEN
                </span>{" "}
                ({apiTokenSourceHint})
              </p>
              <p className="text-[11px] text-ink-500">
                No token yet? Use Remote Pairing below and click <span className="font-medium text-ink-300">Claim Token</span>.
              </p>
            </div>
          </div>
        </div>

        <label className="block space-y-1.5">
          <span className="text-xs text-ink-400">Realtime WS path</span>
          <Input
            value={connectionDraft.realtimePath}
            onChange={(event) =>
              setConnectionDraft((current) => ({
                ...current,
                realtimePath: event.target.value
              }))
            }
            placeholder="/api/ws"
          />
        </label>

        <div className="flex flex-wrap gap-2">
          <Button
            size="sm"
            variant="secondary"
            disabled={busyAction !== null || !isConnectionDirty}
            onClick={handleSaveConnection}
          >
            {busyAction === "save_connection" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
            Save Connection
          </Button>
          <Button
            size="sm"
            variant="secondary"
            disabled={busyAction !== null || isConnectionDirty}
            onClick={handleValidateConnection}
          >
            {busyAction === "validate_connection" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
            Validate
          </Button>
          <Button size="sm" variant="ghost" disabled={busyAction !== null} onClick={handleReloadDraftFromSaved}>
            Reload
          </Button>
        </div>

        {connectionFeedback ? (
          <div
            className={
              connectionFeedback.tone === "error"
                ? "flex items-start gap-2 rounded-lg bg-red-500/8 px-3 py-2 text-xs text-red-400"
                : "flex items-start gap-2 rounded-lg border border-ink-800/50 bg-ink-900/35 px-3 py-2 text-xs text-ink-400"
            }
          >
            {connectionFeedback.tone === "error" ? (
              <XCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            ) : (
              <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-400" />
            )}
            <span>{connectionFeedback.message}</span>
          </div>
        ) : null}
      </section>

      <div className="my-5 h-px bg-[var(--divider)]" />

      <section className="space-y-4">
        <div className="flex items-center gap-2 text-ink-400">
          <ShieldCheck className="h-3.5 w-3.5" />
          <span className="text-[11px] font-semibold uppercase tracking-wider">Remote Pairing</span>
        </div>

        <p className="text-xs text-ink-500">
          Create a session on the active backend, approve via one-time code, then claim a device token.
        </p>

        <div className="rounded-lg border border-ink-800/50 bg-ink-900/35 px-3 py-2.5">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-ink-400">How To Pair</p>
          <p className="mt-1 text-[11px] text-ink-500">1. Click Start Pairing.</p>
          <p className="text-[11px] text-ink-500">2. Click 1. Approve Device.</p>
          <p className="text-[11px] text-ink-500">3. Click 2. Claim Token.</p>
          <p className="text-[11px] text-ink-500">No external page or link is required.</p>
          {requiresPairingAdminToken ? (
            <p className="mt-1 text-[11px] text-amber-400">
              Remote mode: Approve/Cancel require admin API token (`DASHBOARD_API_TOKEN`).
            </p>
          ) : null}
        </div>

        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="secondary" disabled={busyAction !== null} onClick={handleCreate}>
            {busyAction === "create_pairing" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ShieldCheck className="h-3.5 w-3.5" />}
            {session ? "Start New Pairing" : "Start Pairing"}
          </Button>
          {session ? (
            <Button size="sm" variant="ghost" disabled={busyAction !== null} onClick={handleRefresh}>
              {busyAction === "refresh_pairing" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
              Refresh
            </Button>
          ) : null}
        </div>

        {pairingFeedback ? (
          <div
            className={
              pairingFeedback.tone === "error"
                ? "flex items-start gap-2 rounded-lg bg-red-500/8 px-3 py-2 text-xs text-red-400"
                : "flex items-start gap-2 rounded-lg border border-ink-800/50 bg-ink-900/35 px-3 py-2 text-xs text-ink-400"
            }
          >
            {pairingFeedback.tone === "error" ? (
              <XCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            ) : (
              <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-400" />
            )}
            <span>{pairingFeedback.message}</span>
          </div>
        ) : null}

        {session ? (
          <>
            <div className="rounded-lg border border-ink-800/50 bg-ink-900/35 px-3 py-3">
              <div className="flex items-center justify-between gap-2">
                <p className="text-[11px] font-semibold uppercase tracking-wider text-ink-400">Session Status</p>
                {statusBadge ? <Badge variant={statusBadge.variant}>{statusBadge.label}</Badge> : null}
              </div>

              <div className="mt-2 flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="text-[11px] text-ink-500">Pair code</p>
                  <p className="font-mono text-lg tracking-[0.24em] text-ink-100">{session.code}</p>
                </div>

                <Button size="sm" variant="secondary" onClick={handleCopyCode}>
                  <Copy className="h-3.5 w-3.5" />
                  {copiedCode ? "Copied" : "Copy"}
                </Button>
              </div>

              <p className="mt-2 text-[11px] text-ink-500">Session ID: {session.id}</p>
              <p className="mt-0.5 text-[11px] text-ink-600">Realtime path: {session.realtimePath}</p>
              {session.label.trim().length > 0 ? (
                <p className="mt-0.5 text-[11px] text-ink-500">Device label: {session.label}</p>
              ) : null}
            </div>

            <label className="block space-y-1.5">
              <span className="text-xs text-ink-400">Device label (optional)</span>
              <Input
                value={deviceLabel}
                onChange={(event) => {
                  setDeviceLabel(event.target.value);
                }}
                placeholder="Workstation / Laptop / CI Runner"
                disabled={busyAction !== null || !canApprove}
              />
              <p className="text-[11px] text-ink-600">This label is stored with the paired session after approval.</p>
            </label>

            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="secondary" disabled={busyAction !== null || !canApprove} onClick={handleApprove}>
                {busyAction === "approve_pairing" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
                1. Approve Device
              </Button>

              <Button size="sm" variant="secondary" disabled={busyAction !== null || !canClaim} onClick={handleClaim}>
                {busyAction === "claim_pairing" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
                2. Claim Token
              </Button>

              <Button size="sm" variant="ghost" disabled={busyAction !== null || !canCancel} onClick={handleCancel}>
                {busyAction === "cancel_pairing" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
                Cancel
              </Button>
            </div>

            {session.deviceToken ? (
              <div className="rounded-lg border border-ink-800/50 bg-ink-900/35 px-3 py-2.5">
                <p className="text-[11px] font-semibold uppercase tracking-wider text-ink-400">Device Token</p>
                <p className="mt-1 break-all font-mono text-xs text-ink-200">{session.deviceToken}</p>
              </div>
            ) : null}
          </>
        ) : null}
      </section>
    </div>
  );
}
