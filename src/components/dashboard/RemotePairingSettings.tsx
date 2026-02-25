import { CheckCircle2, KeyRound, Link2, Loader2, Settings2, XCircle } from "lucide-react";
import { useMemo, useState } from "react";

import { Button } from "@/components/optics/button";
import { Input } from "@/components/optics/input";
import { Select } from "@/components/optics/select";
import {
  approvePairingSession,
  claimPairingSession,
  createPairingSession,
  getHealth,
  getState
} from "@/lib/api";
import {
  getActiveConnectionSettings,
  loadConnectionSettings,
  notifyConnectionSettingsChanged,
  setConnectionSettings,
  type ConnectionSettings,
  type RuntimeConnectionMode
} from "@/lib/connectionSettingsStorage";
import {
  getActiveApiBaseUrlField,
  getRemoteAuthErrorMessage
} from "@/components/dashboard/remotePairingSettingsModel";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface ActionFeedback {
  tone: "success" | "error";
  message: string;
}

type BusyAction = "save_connect" | "generate_token";

function toErrorMessage(error: unknown): string {
  return error instanceof Error && error.message.trim().length > 0
    ? error.message
    : "Action failed.";
}

function isUnauthorizedMessage(rawMessage: string): boolean {
  const normalized = rawMessage.trim().toLowerCase();
  return normalized === "unauthorized" || normalized.includes("401");
}

function sameConnectionSettings(left: ConnectionSettings, right: ConnectionSettings): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

// ---------------------------------------------------------------------------
// Feedback banner
// ---------------------------------------------------------------------------

function FeedbackBanner({ feedback }: { feedback: ActionFeedback }) {
  return (
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
  );
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function RemotePairingSettings() {
  // Connection state
  const [savedConnection, setSavedConnection] = useState<ConnectionSettings>(() => loadConnectionSettings());
  const [connectionDraft, setConnectionDraft] = useState<ConnectionSettings>(() => loadConnectionSettings());
  const [connectionFeedback, setConnectionFeedback] = useState<ActionFeedback | null>(null);

  // Advanced toggle
  const [showAdvanced, setShowAdvanced] = useState(false);

  // Device token generation
  const [tokenFeedback, setTokenFeedback] = useState<ActionFeedback | null>(null);

  // Shared busy
  const [busyAction, setBusyAction] = useState<BusyAction | null>(null);

  // Derived
  const isRemote = connectionDraft.mode === "remote";
  const isConnectionDirty = useMemo(
    () => !sameConnectionSettings(savedConnection, connectionDraft),
    [connectionDraft, savedConnection]
  );
  const activeApiBaseUrlField = useMemo(() => getActiveApiBaseUrlField(connectionDraft), [connectionDraft]);
  const activeConnection = useMemo(
    () => getActiveConnectionSettings(savedConnection),
    [savedConnection]
  );

  const hasAdminToken = activeConnection.apiToken.trim().length > 0;

  // ---------------------------------------------------------------------------
  // Connection actions
  // ---------------------------------------------------------------------------

  const handleSaveAndConnect = async () => {
    setBusyAction("save_connect");
    setConnectionFeedback(null);
    try {
      // 1. Save
      const next = setConnectionSettings(connectionDraft);
      setSavedConnection(next);
      setConnectionDraft(next);
      notifyConnectionSettingsChanged();

      // 2. Validate
      try {
        const state = await getState();
        setConnectionFeedback({
          tone: "success",
          message: `Connected — ${state.pipelines.length} pipeline${state.pipelines.length !== 1 ? "s" : ""}, ${state.runs.length} run${state.runs.length !== 1 ? "s" : ""}.`
        });
      } catch (error) {
        const message = toErrorMessage(error);
        if (
          next.mode === "remote" &&
          next.apiToken.trim().length === 0 &&
          isUnauthorizedMessage(message)
        ) {
          await getHealth();
          setConnectionFeedback({
            tone: "success",
            message: "Server reachable. Add an auth token for full access."
          });
          return;
        }

        if (
          next.mode === "remote" &&
          next.apiToken.trim().length > 0 &&
          isUnauthorizedMessage(message)
        ) {
          setConnectionFeedback({
            tone: "error",
            message: "Saved, but authorization failed. Check your auth token."
          });
          return;
        }

        setConnectionFeedback({
          tone: "error",
          message: `Saved, but connection failed: ${message}`
        });
      }
    } catch (nextError) {
      setConnectionFeedback({
        tone: "error",
        message: getRemoteAuthErrorMessage(toErrorMessage(nextError), "connection")
      });
    } finally {
      setBusyAction(null);
    }
  };

  const handleDiscardChanges = () => {
    const current = loadConnectionSettings();
    setSavedConnection(current);
    setConnectionDraft(current);
    setConnectionFeedback(null);
  };

  // ---------------------------------------------------------------------------
  // Generate device token (create → approve → claim in one shot)
  // ---------------------------------------------------------------------------

  const handleGenerateDeviceToken = async () => {
    setBusyAction("generate_token");
    setTokenFeedback(null);
    try {
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

      // 1. Create session
      const created = await createPairingSession({ clientName, platform });

      // 2. Approve (requires admin token)
      await approvePairingSession(created.session.id, created.session.code);

      // 3. Claim device token
      const claimed = await claimPairingSession(created.session.id, created.session.code);

      // 4. Save to connection settings
      const nextConnection = setConnectionSettings({
        ...savedConnection,
        deviceToken: claimed.deviceToken,
        apiToken:
          savedConnection.apiToken.trim().length > 0
            ? savedConnection.apiToken
            : claimed.deviceToken
      });
      setSavedConnection(nextConnection);
      setConnectionDraft(nextConnection);
      notifyConnectionSettingsChanged();

      setTokenFeedback({
        tone: "success",
        message:
          savedConnection.apiToken.trim().length > 0
            ? "Device token generated and saved."
            : "Device token generated and applied as your auth token."
      });
    } catch (nextError) {
      const message = toErrorMessage(nextError);
      setTokenFeedback({
        tone: "error",
        message: getRemoteAuthErrorMessage(message, "pairingAdmin")
      });
    } finally {
      setBusyAction(null);
    }
  };

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  return (
    <div>
      {/* ================================================================== */}
      {/* Section 1 — Connection */}
      {/* ================================================================== */}
      <section className="space-y-4">
        <div className="flex items-center gap-2 text-ink-400">
          <Link2 className="h-3.5 w-3.5" />
          <span className="text-[11px] font-semibold uppercase tracking-wider">Connection</span>
        </div>

        {/* Mode selector */}
        <label className="block space-y-1.5">
          <span className="text-xs text-ink-400">Mode</span>
          <Select
            value={connectionDraft.mode}
            onValueChange={(value) =>
              setConnectionDraft((current) => ({
                ...current,
                mode: value as RuntimeConnectionMode
              }))
            }
            options={[
              { value: "local", label: "Local" },
              { value: "remote", label: "Remote" }
            ]}
          />
        </label>

        {/* URL field */}
        <label className="block space-y-1.5">
          <span className="text-xs text-ink-400">{activeApiBaseUrlField.label}</span>
          <Input
            value={activeApiBaseUrlField.value}
            onChange={(event) =>
              setConnectionDraft((current) =>
                current.mode === "remote"
                  ? { ...current, remoteApiBaseUrl: event.target.value }
                  : { ...current, localApiBaseUrl: event.target.value }
              )
            }
            placeholder={activeApiBaseUrlField.placeholder}
          />
        </label>

        {/* Auth token — remote only */}
        {isRemote ? (
          <label className="block space-y-1.5">
            <span className="text-xs text-ink-400">Auth token</span>
            <Input
              type="password"
              value={connectionDraft.apiToken}
              onChange={(event) =>
                setConnectionDraft((current) => ({
                  ...current,
                  apiToken: event.target.value
                }))
              }
              placeholder="Paste your API token"
            />
            {connectionDraft.deviceToken.trim().length > 0 ? (
              <div>
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-7 px-2 text-[11px]"
                  onClick={() =>
                    setConnectionDraft((current) => ({
                      ...current,
                      apiToken: current.deviceToken
                    }))
                  }
                >
                  Use saved device token
                </Button>
              </div>
            ) : null}
          </label>
        ) : null}

        {/* Advanced toggle — WS path */}
        <div>
          <Button
            size="sm"
            variant="ghost"
            className="h-7 px-2 text-[11px] text-ink-500"
            onClick={() => setShowAdvanced((v) => !v)}
          >
            <Settings2 className="h-3.5 w-3.5" />
            {showAdvanced ? "Hide advanced" : "Show advanced"}
          </Button>
          {showAdvanced ? (
            <label className="mt-2 block space-y-1.5">
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
          ) : null}
        </div>

        {/* Save & connect + discard */}
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            variant={isConnectionDirty ? "primary" : "secondary"}
            disabled={busyAction !== null}
            onClick={handleSaveAndConnect}
          >
            {busyAction === "save_connect" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
            {isConnectionDirty ? "Save & connect" : "Test connection"}
          </Button>
          {isConnectionDirty ? (
            <Button
              size="sm"
              variant="ghost"
              disabled={busyAction !== null}
              onClick={handleDiscardChanges}
            >
              Discard
            </Button>
          ) : null}
        </div>

        {connectionFeedback ? <FeedbackBanner feedback={connectionFeedback} /> : null}
      </section>

      {/* ================================================================== */}
      {/* Section 2 — Device Token (remote only) */}
      {/* ================================================================== */}
      {isRemote ? (
        <>
          <div className="my-5 h-px bg-[var(--divider)]" />

          <section className="space-y-4">
            <div className="flex items-center gap-2 text-ink-400">
              <KeyRound className="h-3.5 w-3.5" />
              <span className="text-[11px] font-semibold uppercase tracking-wider">Device token</span>
            </div>

            <p className="text-xs text-ink-500">
              Generate a unique access token for this device. Requires the admin token to be set above.
            </p>

            <Button
              size="sm"
              variant="secondary"
              disabled={busyAction !== null || !hasAdminToken || isConnectionDirty}
              onClick={handleGenerateDeviceToken}
            >
              {busyAction === "generate_token" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <KeyRound className="h-3.5 w-3.5" />}
              Generate device token
            </Button>

            {!hasAdminToken ? (
              <p className="text-[11px] text-ink-600">
                Enter the admin token in the auth token field above first.
              </p>
            ) : null}

            {isConnectionDirty && hasAdminToken ? (
              <p className="text-[11px] text-ink-600">
                Save your connection settings before generating a token.
              </p>
            ) : null}

            {tokenFeedback ? <FeedbackBanner feedback={tokenFeedback} /> : null}
          </section>
        </>
      ) : null}
    </div>
  );
}
