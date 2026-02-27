import {
  CheckCircle2,
  KeyRound,
  Link2,
  LockKeyhole,
  RefreshCw,
  Save,
  XCircle
} from "lucide-react";
import { AnthropicIcon, OpenAIIcon } from "@/components/optics/icons";
import { Badge } from "@/components/optics/badge";
import { Button } from "@/components/optics/button";
import { Input } from "@/components/optics/input";
import { Select } from "@/components/optics/select";
import type { RuntimeConnectionMode } from "@/lib/connectionSettingsStorage";
import type { AuthMode, ProviderConfig, ProviderId, ProviderOAuthStatus } from "@/lib/types";
import { PROVIDER_DISPLAY_LABEL, getProviderModelOptions } from "./mappers";
import {
  shouldShowOAuthConnectedNote
} from "./validation";
import { useIconSpin } from "@/lib/useIconSpin";

interface ProviderSettingsSectionProps {
  providerId: ProviderId;
  provider: ProviderConfig;
  providerIndex: number;
  status: ProviderOAuthStatus | null;
  connectionMode: RuntimeConnectionMode;
  hasUnsavedChanges: boolean;
  busy: boolean;
  saving: boolean;
  oauthStatusText: string;
  onAuthModeChange: (providerId: ProviderId, nextAuthMode: AuthMode) => void;
  onCredentialChange: (providerId: ProviderId, value: string) => void;
  onBaseUrlChange: (providerId: ProviderId, value: string) => void;
  onDefaultModelChange: (providerId: ProviderId, value: string) => void;
  onConnect: (providerId: ProviderId) => Promise<void>;
  onImportToken: (providerId: ProviderId) => Promise<void>;
  onRefresh: (providerId: ProviderId) => Promise<void>;
  onSave: (providerId: ProviderId) => Promise<void>;
}

export function ProviderSettingsSection({
  providerId,
  provider,
  providerIndex,
  status,
  connectionMode,
  hasUnsavedChanges,
  busy,
  saving,
  oauthStatusText,
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
  const isLoggedIn = status?.loggedIn === true;
  const isAuthReady = status ? status.canUseApi || status.canUseCli || status.loggedIn : false;
  const cliAvailable = status?.cliAvailable === true;
  const runtimeProbe = status?.runtimeProbe;
  const showAutoConnectedNote = shouldShowOAuthConnectedNote(provider, status);
  const shouldShowOAuthModeConnectedNote = authMode === "api_key" && showAutoConnectedNote;
  const isRemoteMode = connectionMode === "remote";
  const saveButtonLabel = saving ? "Saving..." : hasUnsavedChanges ? "Save changes" : "Saved";

  return (
    <div data-testid={`provider-settings-${providerId}`}>
      {providerIndex > 0 ? <div className="my-5 h-px bg-[var(--divider)]" /> : null}

      <section className="space-y-4">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 text-ink-400">
            {providerId === "openai" ? <OpenAIIcon className="h-3.5 w-3.5" /> : <AnthropicIcon className="h-3.5 w-3.5" />}
            <span className="text-[11px] font-semibold uppercase tracking-wider">{PROVIDER_DISPLAY_LABEL[providerId]}</span>
          </div>
          <span className="text-[11px] text-ink-600">{new Date(provider.updatedAt).toLocaleString()}</span>
        </div>

        <label className="block space-y-1.5">
          <span className="text-xs text-ink-400">Auth mode</span>
          <Select
            value={authMode}
            onValueChange={(next) => {
              onAuthModeChange(providerId, next as AuthMode);
            }}
            options={[
              { value: "api_key", label: "API key" },
              { value: "oauth", label: isLoggedIn ? "OAuth (connected)" : "OAuth" }
            ]}
          />
          {shouldShowOAuthModeConnectedNote ? (
            <p className="text-[11px] text-ink-500">
              OAuth is already connected via CLI. This provider will switch to OAuth automatically.
            </p>
          ) : null}
        </label>

        <div className="rounded-lg border border-ink-800/50 bg-[var(--surface-raised)] px-3 py-2.5 text-[11px] text-ink-400">
          {hasUnsavedChanges
            ? "You have unsaved provider changes. Click Save changes to apply auth mode, token, and model updates."
            : "Provider settings are applied."}
        </div>
      </section>

      <div className="my-5 h-px bg-[var(--divider)]" />

      {authMode === "oauth" ? (
        <>
          <section className="space-y-4">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 text-ink-400">
                <Link2 className="h-3.5 w-3.5 shrink-0" />
                <span className="text-[11px] font-semibold uppercase tracking-wider">Connect CLI</span>
              </div>
              {isAuthReady ? (
                <Badge variant="success">
                  <CheckCircle2 className="mr-1 h-3 w-3" /> Connected
                </Badge>
              ) : (
                <Badge variant="danger">
                  <XCircle className="mr-1 h-3 w-3" /> Not connected
                </Badge>
              )}
            </div>

            <div className="flex flex-wrap items-center gap-2">
              {cliAvailable ? <Badge variant="running">CLI installed</Badge> : <Badge variant="warning">CLI missing</Badge>}
              {runtimeProbe ? (
                <Badge variant={runtimeProbe.status === "pass" ? "success" : "danger"}>
                  {runtimeProbe.status === "pass" ? "Runtime ready" : "Runtime issue"}
                </Badge>
              ) : (
                <Badge variant="warning">Runtime unchecked</Badge>
              )}
            </div>

            <div className="rounded-lg border border-ink-800/50 bg-[var(--surface-raised)] px-3 py-2.5">
              <p className="text-xs text-ink-400 break-words">{oauthStatusText}</p>
              {status?.cliCommand ? <p className="mt-1 text-[11px] text-ink-600 break-all">CLI command: {status.cliCommand}</p> : null}
              {runtimeProbe ? (
                <p className="mt-1 text-[11px] text-ink-500 break-words">
                  {runtimeProbe.status === "pass" ? runtimeProbe.message : `Runtime issue: ${runtimeProbe.message}`}
                  {runtimeProbe.latencyMs !== undefined ? ` (${runtimeProbe.latencyMs}ms)` : ""}
                </p>
              ) : (
                <p className="mt-1 text-[11px] text-ink-600 break-words">
                  Runtime probe was not executed yet. Click Refresh to validate run capability.
                </p>
              )}
            </div>

            <div className="flex flex-wrap gap-2">
              <Button
                size="sm"
                variant="secondary"
                disabled={busy}
                onClick={async () => {
                  await onConnect(providerId);
                }}
              >
                <Link2 className="mr-1 h-4 w-4" /> {isLoggedIn ? "Reconnect CLI" : "Connect CLI"}
              </Button>

              {providerId === "openai" ? (
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={busy}
                  onClick={async () => {
                    await onImportToken(providerId);
                  }}
                >
                  Import token
                </Button>
              ) : null}

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
                  className="mr-1 h-4 w-4"
                  style={{ transform: `rotate(${refreshRotation}deg)`, transition: "transform 0.45s ease-in-out" }}
                />
                Refresh
              </Button>
            </div>

          </section>

          <div className="my-5 h-px bg-[var(--divider)]" />

          <section className="space-y-4">
            <div className="flex items-center gap-2 text-ink-400">
              <LockKeyhole className="h-3.5 w-3.5 shrink-0" />
              <span className="text-[11px] font-semibold uppercase tracking-wider">
                {providerId === "claude" ? "OAuth Credential" : "Optional OAuth Token"}
              </span>
            </div>

            <label className="block space-y-1.5">
              <span className="text-xs text-ink-400">
                {providerId === "claude"
                  ? "Setup-token OR browser Authentication Code / callback URL"
                  : "OAuth token (optional)"}
              </span>
              <Input
                type="password"
                value={provider.oauthToken}
                onChange={(event) => {
                  onCredentialChange(providerId, event.target.value);
                }}
                placeholder={
                  providerId === "claude"
                    ? "sk-ant-oat01-... OR CODE#STATE OR callback URL"
                    : "sk-..."
                }
              />
            </label>

            {providerId === "claude" ? (
              <p className="text-[11px] text-ink-500">
                One field flow: paste setup-token (`sk-ant-oat...`) or browser Authentication Code (or full callback URL), then
                click Save changes. {isRemoteMode ? "In remote mode setup-token is the most reliable path." : ""}
              </p>
            ) : (
              <p className="text-[11px] text-ink-500">If you edit this token manually, click Save changes to apply it.</p>
            )}
          </section>
        </>
      ) : (
        <section className="space-y-4">
          <div className="flex items-center gap-2 text-ink-400">
            <KeyRound className="h-3.5 w-3.5 shrink-0" />
            <span className="text-[11px] font-semibold uppercase tracking-wider">API Credentials</span>
          </div>
          <label className="block space-y-1.5">
            <span className="text-xs text-ink-400">API key</span>
            <Input
              type="password"
              value={provider.apiKey}
              onChange={(event) => {
                onCredentialChange(providerId, event.target.value);
              }}
              placeholder="sk-..."
            />
          </label>
        </section>
      )}

      <div className="my-5 h-px bg-[var(--divider)]" />

      <section className="space-y-4">
        <label className="block space-y-1.5">
          <span className="text-xs text-ink-400">Base URL</span>
          <Input
            value={provider.baseUrl}
            onChange={(event) => {
              onBaseUrlChange(providerId, event.target.value);
            }}
            placeholder="https://api.openai.com/v1"
          />
        </label>

        <div className="space-y-1.5">
          <span className="text-xs text-ink-400">Default model</span>
          <Select
            value={provider.defaultModel}
            onValueChange={(value) => {
              onDefaultModelChange(providerId, value);
            }}
            options={getProviderModelOptions(providerId)}
            placeholder="Select model..."
          />
        </div>
      </section>

      <div className="my-5 h-px bg-[var(--divider)]" />

      <section className="space-y-3">
        <p className="text-[11px] text-ink-500">
          {hasUnsavedChanges
            ? "Unsaved changes will not apply until you click Save changes."
            : "No pending provider changes."}
        </p>
        <Button
          variant="secondary"
          onClick={async () => {
            await onSave(providerId);
          }}
          disabled={busy || !hasUnsavedChanges}
        >
          <Save className="mr-2 h-4 w-4" /> {saveButtonLabel}
        </Button>
      </section>
    </div>
  );
}
