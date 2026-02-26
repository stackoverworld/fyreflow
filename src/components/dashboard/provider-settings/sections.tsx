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
  shouldShowOAuthConnectedNote,
  shouldShowOAuthTokenInput
} from "./validation";
import { useIconSpin } from "@/lib/useIconSpin";

interface ProviderSettingsSectionProps {
  providerId: ProviderId;
  provider: ProviderConfig;
  providerIndex: number;
  status: ProviderOAuthStatus | null;
  connectionMode: RuntimeConnectionMode;
  busy: boolean;
  saving: boolean;
  submittingOAuthCode: boolean;
  oauthCodeValue: string;
  oauthStatusText: string;
  onAuthModeChange: (providerId: ProviderId, nextAuthMode: AuthMode) => void;
  onCredentialChange: (providerId: ProviderId, value: string) => void;
  onBaseUrlChange: (providerId: ProviderId, value: string) => void;
  onDefaultModelChange: (providerId: ProviderId, value: string) => void;
  onOAuthCodeChange: (providerId: ProviderId, value: string) => void;
  onConnect: (providerId: ProviderId) => Promise<void>;
  onSubmitOAuthCode: (providerId: ProviderId) => Promise<void>;
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
  busy,
  saving,
  submittingOAuthCode,
  oauthCodeValue,
  oauthStatusText,
  onAuthModeChange,
  onCredentialChange,
  onBaseUrlChange,
  onDefaultModelChange,
  onOAuthCodeChange,
  onConnect,
  onSubmitOAuthCode,
  onImportToken,
  onRefresh,
  onSave
}: ProviderSettingsSectionProps) {
  const { rotation: refreshRotation, triggerSpin: triggerRefreshSpin } = useIconSpin();
  const authMode: AuthMode = provider.authMode;
  const isLoggedIn = status?.loggedIn === true;
  const cliAvailable = status?.cliAvailable === true;
  const runtimeProbe = status?.runtimeProbe;
  const showOauthTokenInput = shouldShowOAuthTokenInput(authMode, providerId);
  const showAutoConnectedNote = shouldShowOAuthConnectedNote(provider, status);
  const shouldShowOAuthModeConnectedNote = authMode === "api_key" && showAutoConnectedNote;

  return (
    <div>
      {providerIndex > 0 ? <div className="my-5 h-px bg-[var(--divider)]" /> : null}

      <section className="space-y-4">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 text-ink-400">
            {providerId === "openai" ? <OpenAIIcon className="h-3.5 w-3.5" /> : <AnthropicIcon className="h-3.5 w-3.5" />}
            <span className="text-[11px] font-semibold uppercase tracking-wider">{PROVIDER_DISPLAY_LABEL[providerId]}</span>
          </div>
          <span className="text-[11px] text-ink-600">{new Date(provider.updatedAt).toLocaleString()}</span>
        </div>

        <div className="space-y-1.5">
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
        </div>

        {showOauthTokenInput ? (
          <label className="block space-y-1.5">
            <span className="flex items-center gap-1 text-xs text-ink-400">
              {authMode === "oauth" ? <LockKeyhole className="h-3 w-3" /> : <KeyRound className="h-3 w-3" />}
              {authMode === "oauth" ? "OAuth token (optional)" : "API key"}
            </span>
            <Input
              type="password"
              value={authMode === "oauth" ? provider.oauthToken : provider.apiKey}
              onChange={(event) => {
                onCredentialChange(providerId, event.target.value);
              }}
              placeholder={authMode === "oauth" ? "Auto-managed or paste token" : "sk-..."}
            />
          </label>
        ) : (
          <div className="space-y-1.5">
            <span className="flex items-center gap-1 text-xs text-ink-400">
              <LockKeyhole className="h-3 w-3" />
              OAuth managed by CLI
            </span>
            <p className="text-xs text-ink-500">Claude stores OAuth credentials internally. No token will appear in this panel.</p>
          </div>
        )}

        {authMode === "oauth" ? (
          <div className="space-y-2 pt-1">
            <div className="flex flex-wrap items-center gap-2">
              {isLoggedIn ? (
                <Badge variant="success">
                  <CheckCircle2 className="mr-1 h-3 w-3" /> Auth connected
                </Badge>
              ) : (
                <Badge variant="danger">
                  <XCircle className="mr-1 h-3 w-3" /> Auth missing
                </Badge>
              )}
              {cliAvailable ? <Badge variant="running">CLI installed</Badge> : <Badge variant="warning">CLI missing</Badge>}
              {runtimeProbe ? (
                <Badge variant={runtimeProbe.status === "pass" ? "success" : "danger"}>
                  {runtimeProbe.status === "pass" ? "Runtime ready" : "Runtime issue"}
                </Badge>
              ) : (
                <Badge variant="warning">Runtime unchecked</Badge>
              )}
            </div>

            <p className="text-xs text-ink-500 break-words">{oauthStatusText}</p>
            {status?.cliCommand ? <p className="text-xs text-ink-600 break-all">CLI command: {status.cliCommand}</p> : null}
            {runtimeProbe ? (
              <p className={runtimeProbe.status === "pass" ? "text-xs text-ink-500 break-words" : "text-xs text-red-400 break-words"}>
                {runtimeProbe.message}
                {runtimeProbe.latencyMs !== undefined ? ` (${runtimeProbe.latencyMs}ms)` : ""}
              </p>
            ) : (
              <p className="text-xs text-ink-600 break-words">
                Runtime probe was not executed yet. Click Refresh to validate real run capability.
              </p>
            )}

            <div className="flex flex-wrap gap-2">
              <Button
                size="sm"
                variant="secondary"
                disabled={busy}
                onClick={async () => {
                  await onConnect(providerId);
                }}
              >
                <Link2 className="mr-1 h-4 w-4" /> {isLoggedIn ? "Reconnect" : "Connect"}
              </Button>

              {providerId === "openai" ? (
                <Button
                  size="sm"
                  variant="secondary"
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
                <RefreshCw className="mr-1 h-4 w-4" style={{ transform: `rotate(${refreshRotation}deg)`, transition: "transform 0.45s ease-in-out" }} /> Refresh
              </Button>
            </div>

            {providerId === "claude" && connectionMode === "remote" ? (
              <div className="space-y-1.5">
                <span className="text-xs text-ink-400">Authentication code from browser</span>
                <div className="flex flex-wrap gap-2">
                  <Input
                    value={oauthCodeValue}
                    onChange={(event) => {
                      onOAuthCodeChange(providerId, event.target.value);
                    }}
                    name={`${providerId}-oauth-code`}
                    autoComplete="off"
                    autoCorrect="off"
                    autoCapitalize="none"
                    spellCheck={false}
                    placeholder="Paste auth code or full platform.claude.com/oauth/code/callback URL"
                  />
                  <Button
                    size="sm"
                    variant="secondary"
                    disabled={busy}
                    onClick={async () => {
                      await onSubmitOAuthCode(providerId);
                    }}
                  >
                    {submittingOAuthCode ? "Submitting..." : "Submit code"}
                  </Button>
                </div>
                <p className="text-xs text-ink-500">
                  If browser shows “Authentication Code”, paste the code here (or full callback URL) and submit it to the remote Claude CLI session.
                </p>
              </div>
            ) : null}

            {providerId === "claude" ? <p className="text-xs text-ink-500">In OAuth mode the dashboard uses Claude CLI auth automatically when no token is set.</p> : null}
          </div>
        ) : null}

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

        <Button
          variant="secondary"
          onClick={async () => {
            await onSave(providerId);
          }}
          disabled={busy}
        >
          <Save className="mr-2 h-4 w-4" /> {saving ? "Saving..." : "Save"}
        </Button>
      </section>
    </div>
  );
}
