import { useState, useCallback } from "react";
import {
  AlertTriangle,
  Check,
  CheckCircle2,
  Copy,
  Download,
  ExternalLink,
  KeyRound,
  Link2,
  LockKeyhole,
  RefreshCw,
  Save,
  XCircle
} from "lucide-react";
import { Badge } from "@/components/optics/badge";
import { Button } from "@/components/optics/button";
import { Input } from "@/components/optics/input";
import { SegmentedControl } from "@/components/optics/segmented-control";
import { Select } from "@/components/optics/select";
import { Tooltip } from "@/components/optics/tooltip";
import type { RuntimeConnectionMode } from "@/lib/connectionSettingsStorage";
import type { AuthMode, ProviderConfig, ProviderId, ProviderOAuthStatus } from "@/lib/types";
import { getProviderModelOptions } from "./mappers";
import { shouldShowOAuthConnectedNote } from "./validation";
import { useIconSpin } from "@/lib/useIconSpin";

export interface PendingConnectInfo {
  authCode: string;
  authUrl: string;
}

interface ProviderSettingsSectionProps {
  providerId: ProviderId;
  provider: ProviderConfig;
  status: ProviderOAuthStatus | null;
  connectionMode: RuntimeConnectionMode;
  hasUnsavedChanges: boolean;
  busy: boolean;
  saving: boolean;
  oauthStatusText: string;
  pendingConnect: PendingConnectInfo | null;
  onAuthModeChange: (providerId: ProviderId, nextAuthMode: AuthMode) => void;
  onCredentialChange: (providerId: ProviderId, value: string) => void;
  onBaseUrlChange: (providerId: ProviderId, value: string) => void;
  onDefaultModelChange: (providerId: ProviderId, value: string) => void;
  onConnect: (providerId: ProviderId) => Promise<void>;
  onImportToken: (providerId: ProviderId) => Promise<void>;
  onRefresh: (providerId: ProviderId) => Promise<void>;
  onSave: (providerId: ProviderId) => Promise<void>;
}

const AUTH_MODE_SEGMENTS = [
  { value: "api_key" as const, label: "API Key", icon: <KeyRound className="h-3.5 w-3.5" /> },
  { value: "oauth" as const, label: "OAuth", icon: <Link2 className="h-3.5 w-3.5" /> }
];

function StepBadge({ children, variant = "default" }: { children: React.ReactNode; variant?: "default" | "warn" }) {
  return (
    <span
      className={
        variant === "warn"
          ? "flex h-5 w-5 shrink-0 items-center justify-center rounded-md bg-amber-500/10 ring-1 ring-amber-500/20"
          : "flex h-5 w-5 shrink-0 items-center justify-center rounded-md bg-ember-500/10 text-[10px] font-bold text-ember-400 ring-1 ring-ember-500/20"
      }
    >
      {children}
    </span>
  );
}

function ClaudeOAuthGuide({ isRemoteMode }: { isRemoteMode: boolean }) {
  return (
    <section className="rounded-xl border border-ink-800 bg-[var(--surface-inset)] overflow-hidden">
      <div className="flex items-center gap-2 px-3 py-2.5">
        <LockKeyhole className="h-3.5 w-3.5 shrink-0 text-ink-400" />
        <span className="text-[11px] font-semibold uppercase tracking-wider text-ink-300">
          How Anthropic OAuth works
        </span>
      </div>

      <div className="h-px bg-[var(--divider)]" />

      <div className="px-3 py-3 space-y-0">
        {/* Step 1 */}
        <div className="flex gap-2.5">
          <div className="flex flex-col items-center">
            <StepBadge>1</StepBadge>
            <div className="mt-1 flex-1 w-px bg-ink-800" />
          </div>
          <p className="text-[11px] text-ink-400 leading-relaxed pb-3 min-w-0">
            Run{" "}
            <code className="rounded bg-ink-900 px-1 py-px font-mono text-[10px] text-ink-200 ring-1 ring-ink-800">
              claude setup-token
            </code>{" "}
            in your local terminal.
          </p>
        </div>

        {/* Step 2 */}
        <div className="flex gap-2.5">
          <div className="flex flex-col items-center">
            <StepBadge>2</StepBadge>
            <div className="mt-1 flex-1 w-px bg-ink-800" />
          </div>
          <p className="text-[11px] text-ink-400 leading-relaxed pb-3 min-w-0">
            Paste token starting with{" "}
            <code className="rounded bg-ink-900 px-1 py-px font-mono text-[10px] text-ink-200 ring-1 ring-ink-800">
              sk-ant-oat...
            </code>{" "}
            into the field below and click Save changes.
          </p>
        </div>

        {/* Warning */}
        <div className="flex gap-2.5">
          <StepBadge variant="warn">
            <AlertTriangle className="h-3 w-3 text-amber-400" />
          </StepBadge>
          <p className="text-[11px] text-amber-300/80 leading-relaxed min-w-0">
            Do not paste browser code like{" "}
            <code className="rounded bg-amber-500/10 px-1 py-px font-mono text-[10px] text-amber-300 ring-1 ring-amber-500/20">
              xxxx#state
            </code>{" "}
            into token field.
            {isRemoteMode
              ? " In remote mode only setup-token is accepted for API fallback."
              : ""}
          </p>
        </div>
      </div>
    </section>
  );
}

/* ── Prominent device-auth-code card ── */

function AuthCodeCard({ code, authUrl }: { code: string; authUrl?: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* clipboard unavailable — user can select manually */
    }
  }, [code]);

  return (
    <div className="rounded-xl border border-ember-500/20 bg-ember-500/5 px-3 py-2.5 space-y-2">
      <p className="text-xs text-ember-300">Device code</p>

      <div className="flex items-center gap-2">
        <div className="flex-1 rounded-lg bg-ink-950/60 border border-ink-800 px-4 py-3 text-center select-all">
          <span className="font-mono text-lg font-bold tracking-[0.2em] text-ink-50">
            {code}
          </span>
        </div>
        <Tooltip content={copied ? "Copied!" : "Copy code"} side="left">
          <Button size="sm" variant="ghost" onClick={handleCopy} className="shrink-0">
            {copied ? (
              <Check className="h-3.5 w-3.5 text-emerald-400" />
            ) : (
              <Copy className="h-3.5 w-3.5" />
            )}
          </Button>
        </Tooltip>
      </div>

      <p className="text-[11px] text-ink-500">
        Enter this code on the device authorization page.
      </p>

      {authUrl ? (
        <a
          href={authUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 text-[11px] font-medium text-ember-400 hover:text-ember-300 transition-colors"
        >
          Open authorization page <ExternalLink className="h-3 w-3" />
        </a>
      ) : null}
    </div>
  );
}

/* ── Main section ── */

export function ProviderSettingsSection({
  providerId,
  provider,
  status,
  connectionMode,
  hasUnsavedChanges,
  busy,
  saving,
  oauthStatusText,
  pendingConnect,
  onAuthModeChange,
  onCredentialChange,
  onBaseUrlChange,
  onDefaultModelChange,
  onConnect,
  onImportToken,
  onRefresh,
  onSave
}: ProviderSettingsSectionProps) {
  const { rotation: refreshRotation, triggerSpin: triggerRefreshSpin } = useIconSpin();
  const authMode: AuthMode = provider.authMode;
  const isClaudeProvider = providerId === "claude";
  const isAuthReady = status ? status.canUseApi || status.canUseCli || status.loggedIn : false;
  const cliAvailable = status?.cliAvailable === true;
  const runtimeProbe = status?.runtimeProbe;
  const showAutoConnectedNote = shouldShowOAuthConnectedNote(provider, status);
  const isRemoteMode = connectionMode === "remote";
  const saveButtonLabel = saving ? "Saving..." : hasUnsavedChanges ? "Save changes" : "Saved";
  const hasAuthCode = !isClaudeProvider && (pendingConnect?.authCode ?? "").length > 0;
  const hasAuthUrl = !hasAuthCode && isRemoteMode && (pendingConnect?.authUrl ?? "").length > 0;
  const connectionSummary = oauthStatusText;
  const connectButtonLabel = isAuthReady ? "Reconnect" : "Connect";
  const claudeTokenConnected = status?.canUseApi === true;
  const claudeStatusSummary = claudeTokenConnected
    ? "Setup token is saved. API fallback is ready."
    : "Disconnected. Paste setup-token and click Save changes.";

  return (
    <div className="space-y-3" data-testid={`provider-settings-${providerId}`}>

      {/* ── Auth mode card ── */}
      <div className="rounded-xl border border-ink-800 bg-[var(--surface-inset)] px-3 py-2.5">
        <p className="text-xs text-ink-100 mb-2">Auth mode</p>
        <SegmentedControl
          size="sm"
          segments={AUTH_MODE_SEGMENTS}
          value={authMode}
          onValueChange={(next) => onAuthModeChange(providerId, next)}
        />
        {showAutoConnectedNote && authMode === "api_key" ? (
          <p className="mt-1.5 text-[11px] text-ember-400">
            OAuth detected via CLI — will auto-switch on next save.
          </p>
        ) : null}
      </div>

      {authMode === "oauth" ? (
        <>
          {isClaudeProvider ? (
            <div className="rounded-xl border border-ink-800 bg-[var(--surface-inset)]">
              <div className="flex items-center justify-between gap-2 px-3 py-2.5">
                <p className="text-xs text-ink-100">Status</p>
                {claudeTokenConnected ? (
                  <Badge variant="success">
                    <CheckCircle2 className="h-3 w-3" /> Connected
                  </Badge>
                ) : (
                  <Badge variant="danger">
                    <XCircle className="h-3 w-3" /> Disconnected
                  </Badge>
                )}
              </div>

              <div className="h-px bg-[var(--divider)]" />

              <div className="px-3 py-2.5 space-y-2">
                <p className="text-xs text-ink-300 leading-relaxed">
                  {claudeStatusSummary}
                </p>
                {runtimeProbe ? (
                  <Badge variant={runtimeProbe.status === "pass" ? "success" : "danger"}>
                    {runtimeProbe.status === "pass" ? "Runtime OK" : "Runtime issue"}
                    {runtimeProbe.latencyMs !== undefined ? ` \u00b7 ${runtimeProbe.latencyMs}ms` : ""}
                  </Badge>
                ) : null}
                <p className="text-[11px] text-ink-600 leading-relaxed break-words">
                  {oauthStatusText}
                </p>
              </div>
            </div>
          ) : null}

          {!isClaudeProvider ? (
            /* ── Connection card ── */
            <div className="rounded-xl border border-ink-800 bg-[var(--surface-inset)]">
              <div className="flex items-center justify-between gap-2 px-3 py-2.5">
                <p className="text-xs text-ink-100">Connection</p>
                <div className="flex items-center gap-1.5">
                  {isAuthReady ? (
                    <Badge variant="success">
                      <CheckCircle2 className="h-3 w-3" /> Connected
                    </Badge>
                  ) : (
                    <Badge variant="danger">
                      <XCircle className="h-3 w-3" /> Disconnected
                    </Badge>
                  )}
                  {cliAvailable ? (
                    <Badge variant="running">CLI</Badge>
                  ) : (
                    <Badge variant="warning">No CLI</Badge>
                  )}
                </div>
              </div>

              <div className="h-px bg-[var(--divider)]" />

              <div className="px-3 py-2.5 space-y-2">
                <p className="text-xs text-ink-300 leading-relaxed">
                  {connectionSummary}
                </p>

                {runtimeProbe ? (
                  <Badge variant={runtimeProbe.status === "pass" ? "success" : "danger"}>
                    {runtimeProbe.status === "pass" ? "Runtime OK" : "Runtime issue"}
                    {runtimeProbe.latencyMs !== undefined ? ` \u00b7 ${runtimeProbe.latencyMs}ms` : ""}
                  </Badge>
                ) : null}
              </div>

              <div className="h-px bg-[var(--divider)]" />

              <div className="flex items-center gap-2 px-3 py-2">
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={busy}
                  onClick={async () => {
                    await onConnect(providerId);
                  }}
                >
                  <Link2 className="mr-1 h-3.5 w-3.5" />
                  {connectButtonLabel}
                </Button>

                {providerId === "openai" ? (
                  <Tooltip content="Pull OAuth token from the OpenAI CLI session" side="top">
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={busy}
                      onClick={async () => {
                        await onImportToken(providerId);
                      }}
                    >
                      <Download className="mr-1 h-3.5 w-3.5" /> Sync from CLI
                    </Button>
                  </Tooltip>
                ) : null}

                <Tooltip content="Refresh connection status" side="top">
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={busy}
                    onClick={async () => {
                      triggerRefreshSpin();
                      await onRefresh(providerId);
                    }}
                  >
                    <RefreshCw
                      className="h-3.5 w-3.5"
                      style={{
                        transform: `rotate(${refreshRotation}deg)`,
                        transition: "transform 0.45s ease-in-out"
                      }}
                    />
                  </Button>
                </Tooltip>
              </div>
            </div>
          ) : null}

          {/* ── Auth code card (device flow) ── */}
          {hasAuthCode ? (
            <AuthCodeCard
              code={pendingConnect!.authCode}
              authUrl={pendingConnect!.authUrl || undefined}
            />
          ) : null}

          {isClaudeProvider ? (
            <ClaudeOAuthGuide isRemoteMode={isRemoteMode} />
          ) : null}

          {/* ── Auth URL link (remote fallback, no device code) ── */}
          {!isClaudeProvider && hasAuthUrl ? (
            <div className="rounded-xl border border-ink-800 bg-[var(--surface-inset)] px-3 py-2.5">
              <a
                href={pendingConnect!.authUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 text-[11px] font-medium text-ember-400 hover:text-ember-300 transition-colors"
              >
                <ExternalLink className="h-3 w-3 shrink-0" />
                Open login page in browser
              </a>
            </div>
          ) : null}

          {/* ── OAuth credential card ── */}
          <div className="rounded-xl border border-ink-800 bg-[var(--surface-inset)] px-3 py-2.5 space-y-1.5">
            <p className="text-xs text-ink-100">
              {isClaudeProvider ? "Setup token (API fallback)" : "OAuth Token"}
            </p>
            <Input
              type="password"
              value={provider.oauthToken}
              onChange={(event) => {
                onCredentialChange(providerId, event.target.value);
              }}
              placeholder={
                isClaudeProvider
                  ? "sk-ant-oat01-..."
                  : "sk-..."
              }
            />
            <p className="text-[11px] text-ink-500">
              {isClaudeProvider
                ? `Paste Claude setup-token from \`claude setup-token\` and save.${isRemoteMode ? " In remote mode this is the only token format accepted for API fallback." : " Browser Authentication Code from claude.ai cannot be saved in this field."}`
                : "Optional. Edit manually and save to apply."}
            </p>
          </div>
        </>
      ) : (
        /* ── API key card ── */
        <div className="rounded-xl border border-ink-800 bg-[var(--surface-inset)] px-3 py-2.5 space-y-1.5">
          <p className="text-xs text-ink-100">API Key</p>
          <Input
            type="password"
            value={provider.apiKey}
            onChange={(event) => {
              onCredentialChange(providerId, event.target.value);
            }}
            placeholder="sk-..."
          />
          <p className="text-[11px] text-ink-500">
            {providerId === "claude"
              ? "Your Anthropic API key. Find it at console.anthropic.com."
              : "Your OpenAI API key. Find it at platform.openai.com."}
          </p>
        </div>
      )}

      {/* ── Configuration card ── */}
      <div className="rounded-xl border border-ink-800 bg-[var(--surface-inset)]">
        <label className="block px-3 py-2.5 space-y-1.5">
          <p className="text-xs text-ink-100">Base URL</p>
          <Input
            value={provider.baseUrl}
            onChange={(event) => {
              onBaseUrlChange(providerId, event.target.value);
            }}
            placeholder={
              providerId === "claude"
                ? "https://api.anthropic.com/v1"
                : "https://api.openai.com/v1"
            }
          />
        </label>

        <div className="h-px bg-[var(--divider)]" />

        <div className="px-3 py-2.5 space-y-1.5">
          <p className="text-xs text-ink-100">Default model</p>
          <Select
            value={provider.defaultModel}
            onValueChange={(value) => {
              onDefaultModelChange(providerId, value);
            }}
            options={getProviderModelOptions(providerId)}
            placeholder="Select model..."
          />
        </div>
      </div>

      {/* ── Save row ── */}
      <div className="flex items-center justify-between gap-3 rounded-xl border border-ink-800 bg-[var(--surface-inset)] px-3 py-2.5">
        <p className="text-[11px] text-ink-500 min-w-0 truncate">
          {hasUnsavedChanges
            ? "You have unsaved changes."
            : `Last saved ${new Date(provider.updatedAt).toLocaleString()}`}
        </p>
        <Button
          size="sm"
          variant={hasUnsavedChanges ? "primary" : "secondary"}
          onClick={async () => {
            await onSave(providerId);
          }}
          disabled={busy || !hasUnsavedChanges}
          className="shrink-0"
        >
          <Save className="mr-1 h-3.5 w-3.5" /> {saveButtonLabel}
        </Button>
      </div>
    </div>
  );
}
