import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, ShieldAlert, X } from "lucide-react";
import { Badge } from "@/components/optics/badge";
import { Input } from "@/components/optics/input";
import { SegmentedControl } from "@/components/optics/segmented-control";
import { Select } from "@/components/optics/select";
import { Switch } from "@/components/optics/switch";
import { Textarea } from "@/components/optics/textarea";
import { cn } from "@/lib/cn";
import { ONE_MILLION_CONTEXT_TOKENS } from "@/lib/modelCatalog";
import {
  getClaude1MContextCapabilityState,
  getClaude1MContextUnavailableNote,
  getClaudeFastModeCapabilityState,
  getClaudeFastModeUnavailableNote,
  getOpenAiFastModeCapabilityState,
  getOpenAiFastModeUnavailableNote
} from "@/lib/providerCapabilities";
import {
  analyzeStepSandboxRequirement,
  normalizeStepSandboxMode,
  resolvePreferredSandboxMode
} from "@/lib/stepSandboxMode";
import type { GeneralSectionProps } from "../../../types";
import {
  buildDelegationCountPatch,
  buildDelegationPatch,
  buildEnableIsolatedStoragePatch,
  buildEnableSharedStoragePatch,
  buildSandboxModePatch,
  buildFastModePatch,
  buildMcpServerIdsPatch,
  buildOutputFilesPatch,
  buildOutputFormatPatch,
  buildOutputFieldsPatch,
  buildSkipIfArtifactsPatch,
  buildScenariosPatch,
  buildPolicyProfileIdsPatch,
  buildCacheBypassInputKeysPatch,
  buildCacheBypassOrchestratorPromptPatternsPatch,
  build1MContextPatch,
  outputFormats
} from "./executionFieldAdapters";

interface RetryPolicyFieldProps {
  mcpServers: GeneralSectionProps["mcpServers"];
  selectedStep: GeneralSectionProps["selectedStep"];
  selectedModelMeta: GeneralSectionProps["selectedModelMeta"];
  providerConfig: GeneralSectionProps["providers"][GeneralSectionProps["selectedStep"]["providerId"]];
  providerOAuthStatus: GeneralSectionProps["oauthStatuses"][GeneralSectionProps["selectedStep"]["providerId"]];
  openAiFastModeAvailable: GeneralSectionProps["openAiFastModeAvailable"];
  openAiFastModeUnavailableNote?: GeneralSectionProps["openAiFastModeUnavailableNote"];
  claudeFastModeAvailable: GeneralSectionProps["claudeFastModeAvailable"];
  claudeFastModeUnavailableNote?: GeneralSectionProps["claudeFastModeUnavailableNote"];
  onPatchSelectedStep: GeneralSectionProps["onPatchSelectedStep"];
}

export function RetryPolicyField({
  mcpServers,
  selectedStep,
  selectedModelMeta,
  providerConfig,
  providerOAuthStatus,
  openAiFastModeAvailable,
  openAiFastModeUnavailableNote,
  claudeFastModeAvailable,
  claudeFastModeUnavailableNote,
  onPatchSelectedStep
}: RetryPolicyFieldProps) {
  const [dismissedWarnings, setDismissedWarnings] = useState<Set<string>>(new Set());
  const sandboxMode = normalizeStepSandboxMode(selectedStep.sandboxMode);
  const sandboxRequirement = analyzeStepSandboxRequirement(selectedStep);
  const resolvedSandboxMode = resolvePreferredSandboxMode(selectedStep);
  const secureSandboxLocked = sandboxRequirement.requiresFullAccess;
  const sandboxReason = sandboxRequirement.reasons[0] ?? "This step needs outbound network access.";

  const dismissWarning = useCallback((key: string) => {
    setDismissedWarnings((prev) => new Set(prev).add(key));
  }, []);

  const handleFastModeChange = useCallback(
    (checked: boolean) => {
      if (
        checked &&
        selectedStep.providerId === "claude" &&
        !window.confirm(
          "Enable Claude fast mode for this step? Fast mode is Opus 4.6-only, premium-priced, and best reserved for interactive or time-sensitive work."
        )
      ) {
        return;
      }
      if (checked) {
        setDismissedWarnings((prev) => {
          const next = new Set(prev);
          next.delete("fastMode");
          return next;
        });
      }
      onPatchSelectedStep(buildFastModePatch(checked));
    },
    [onPatchSelectedStep]
  );

  const handle1MContextChange = useCallback(
    (checked: boolean) => {
      if (
        checked &&
        selectedStep.providerId === "claude" &&
        !window.confirm(
          "Enable Claude 1M context for this step? This beta can require Extra Usage, is unavailable on OAuth-authenticated Anthropic API paths, and should follow compaction/caching rather than replace them."
        )
      ) {
        return;
      }
      if (checked) {
        setDismissedWarnings((prev) => {
          const next = new Set(prev);
          next.delete("1mContext");
          return next;
        });
      }
      onPatchSelectedStep(
        build1MContextPatch({
          checked,
          selectedModelMeta,
          selectedStepContextWindowTokens: selectedStep.contextWindowTokens
        })
      );
    },
    [onPatchSelectedStep, selectedModelMeta, selectedStep.contextWindowTokens]
  );

  const showFastModeWarning = selectedStep.fastMode && !dismissedWarnings.has("fastMode");
  const modelUsesDefault1MContext = (selectedModelMeta?.contextWindowTokens ?? 0) >= ONE_MILLION_CONTEXT_TOKENS;
  const effective1MContext = modelUsesDefault1MContext || selectedStep.use1MContext;
  const show1MContextWarning = effective1MContext && !dismissedWarnings.has("1mContext");
  const fastModeCapabilityState =
    selectedStep.providerId === "openai"
      ? getOpenAiFastModeCapabilityState(providerConfig, selectedStep.model)
      : getClaudeFastModeCapabilityState(providerConfig, selectedStep.model, providerOAuthStatus);
  const context1MCapabilityState =
    selectedStep.providerId === "claude"
      ? getClaude1MContextCapabilityState(providerConfig, selectedStep.model, providerOAuthStatus)
      : "confirmed";
  const canToggle1MContext =
    !modelUsesDefault1MContext &&
    selectedModelMeta?.supports1MContext === true &&
    (selectedStep.providerId !== "claude" || context1MCapabilityState !== "unavailable");
  const fastModeSupportedByModel = selectedModelMeta?.supportsFastMode === true;
  const fastModeProviderAvailable =
    selectedStep.providerId === "openai"
      ? openAiFastModeAvailable && fastModeCapabilityState !== "unavailable"
      : claudeFastModeAvailable && fastModeCapabilityState !== "unavailable";
  const fastModeUnavailable = !fastModeSupportedByModel || !fastModeProviderAvailable;
  const fastModeUnavailableNote =
    selectedStep.providerId === "openai"
      ? getOpenAiFastModeUnavailableNote(providerConfig, selectedStep.model) || openAiFastModeUnavailableNote
      : getClaudeFastModeUnavailableNote(providerConfig, selectedStep.model, providerOAuthStatus) ||
        claudeFastModeUnavailableNote;
  const context1MUnavailableNote =
    selectedStep.providerId === "claude"
      ? getClaude1MContextUnavailableNote(providerConfig, selectedStep.model, providerOAuthStatus)
      : undefined;

  useEffect(() => {
    if (!fastModeUnavailable || !selectedStep.fastMode) {
      return;
    }

    onPatchSelectedStep(buildFastModePatch(false));
  }, [fastModeUnavailable, onPatchSelectedStep, selectedStep.fastMode]);

  useEffect(() => {
    if (!secureSandboxLocked || sandboxMode !== "secure") {
      return;
    }

    onPatchSelectedStep(buildSandboxModePatch("full"));
  }, [onPatchSelectedStep, sandboxMode, secureSandboxLocked]);

  return (
    <div className="space-y-3">
      <div className="space-y-2">
        <div className="flex items-center justify-between gap-3 rounded-lg px-1 py-1">
          <div className="flex items-center gap-2.5">
            <Switch
              checked={selectedStep.fastMode}
              disabled={fastModeUnavailable}
              onChange={handleFastModeChange}
            />
            <div>
              <p className="text-[13px] text-ink-100">Fast mode</p>
              <p className="text-[11px] text-ink-500">
                {selectedStep.providerId === "openai"
                  ? 'Priority processing for OpenAI runs. Codex CLI fallback requests `service_tier="fast"`.'
                  : "Premium, best-effort speed mode for Claude Opus 4.6."}
              </p>
              {!fastModeSupportedByModel ? (
                <p className="text-[11px] text-ink-600">The selected model does not support fast mode.</p>
              ) : !fastModeProviderAvailable ? (
                <p className="text-[11px] text-amber-400">
                  {fastModeUnavailableNote ?? "Fast mode requires an active provider credential in Provider Auth."}
                </p>
              ) : selectedStep.providerId === "claude" && fastModeCapabilityState === "maybe" ? (
                <p className="text-[11px] text-amber-400">
                  Claude fast mode is account-gated. Treat this as a best-effort premium override, not a guaranteed runtime capability.
                </p>
              ) : null}
            </div>
          </div>
        </div>

        {showFastModeWarning && (
          <div className="flex items-start gap-2 rounded-lg border border-amber-500/25 bg-amber-500/8 px-3 py-2">
            <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0 text-amber-500" />
            <div className="min-w-0 flex-1">
              <p className="text-[11px] leading-relaxed text-amber-600">
                {selectedStep.providerId === "openai" ? (
                  <>
                    Fast mode uses <span className="font-semibold">priority processing at 2x standard API rates</span>.
                    Codex CLI fallback also requests fast tier via <code>service_tier="fast"</code>.
                  </>
                ) : (
                  <>
                    Claude fast mode uses <span className="font-semibold">premium Opus 4.6 pricing</span>. Reserve it for
                    interactive or urgent runs instead of background/autonomous execution.
                  </>
                )}
              </p>
            </div>
            <button
              type="button"
              className="shrink-0 rounded p-0.5 text-amber-500/60 transition hover:text-amber-600"
              onClick={() => dismissWarning("fastMode")}
            >
              <X className="h-3 w-3" />
            </button>
          </div>
        )}

        <div className="flex items-center justify-between gap-3 rounded-lg px-1 py-1">
          <div className="flex items-center gap-2.5">
            <Switch
              checked={effective1MContext}
              disabled={!canToggle1MContext}
              onChange={handle1MContextChange}
            />
            <div>
              <p className="text-[13px] text-ink-100">1M context</p>
              <p className="text-[11px] text-ink-500">
                {modelUsesDefault1MContext
                  ? "Included by this model by default."
                  : "Extended window for large documents."}
              </p>
              {!modelUsesDefault1MContext && selectedModelMeta?.supports1MContext === false ? (
                <p className="text-[11px] text-ink-600">The selected model does not support 1M context.</p>
              ) : selectedStep.providerId === "claude" && context1MUnavailableNote ? (
                <p className={cn(
                  "text-[11px]",
                  context1MCapabilityState === "maybe" ? "text-amber-400" : "text-ink-600"
                )}>
                  {context1MUnavailableNote}
                </p>
              ) : null}
            </div>
          </div>
        </div>

        {show1MContextWarning && (
          <div className="flex items-start gap-2 rounded-lg border border-amber-500/25 bg-amber-500/8 px-3 py-2">
            <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0 text-amber-500" />
            <div className="min-w-0 flex-1">
              <p className="text-[11px] leading-relaxed text-amber-600">
                {selectedStep.providerId === "openai" ? (
                  <>
                    This model includes an expanded context window. Codex CLI fallback requests it via{" "}
                    <code>model_context_window</code> and <code>model_auto_compact_token_limit</code>.
                  </>
                ) : (
                  <>
                    Claude 1M context is beta, can require <span className="font-semibold">Extra Usage</span>, and should
                    follow compaction/prompt caching rather than replace them.
                  </>
                )}
              </p>
            </div>
            <button
              type="button"
              className="shrink-0 rounded p-0.5 text-amber-500/60 transition hover:text-amber-600"
              onClick={() => dismissWarning("1mContext")}
            >
              <X className="h-3 w-3" />
            </button>
          </div>
        )}

        <div className="flex items-center justify-between gap-3 rounded-lg px-1 py-1">
          <div className="flex items-center gap-2.5">
            <Switch
              checked={selectedStep.enableDelegation}
              onChange={(checked) => onPatchSelectedStep(buildDelegationPatch(checked))}
              disabled={selectedStep.role !== "executor" && selectedStep.role !== "orchestrator"}
            />
            <div>
              <p className="text-[13px] text-ink-100">Subagent delegation</p>
              <p className="text-[11px] text-ink-500">Spawn child agents from this step.</p>
            </div>
          </div>
          {selectedStep.enableDelegation && (
            <Input
              className="w-16 text-center"
              type="number"
              min={1}
              max={8}
              value={selectedStep.delegationCount}
              onChange={(event) =>
                onPatchSelectedStep(buildDelegationCountPatch({ value: event.target.value }))
              }
            />
          )}
        </div>

        <div className="flex items-center justify-between gap-3 rounded-lg px-1 py-1">
          <div className="flex items-center gap-2.5">
            <Switch
              checked={selectedStep.enableIsolatedStorage}
              onChange={(checked) => onPatchSelectedStep(buildEnableIsolatedStoragePatch(checked))}
            />
            <div>
              <p className="text-[13px] text-ink-100">Isolated storage</p>
              <p className="text-[11px] text-ink-500">
                Private step-only folder for scratch files and local caches.
              </p>
            </div>
          </div>
        </div>

        <div className="flex items-center justify-between gap-3 rounded-lg px-1 py-1">
          <div className="flex items-center gap-2.5">
            <Switch
              checked={selectedStep.enableSharedStorage}
              onChange={(checked) => onPatchSelectedStep(buildEnableSharedStoragePatch(checked))}
            />
            <div>
              <p className="text-[13px] text-ink-100">Shared storage</p>
              <p className="text-[11px] text-ink-500">
                Cross-step workspace for artifacts shared across agents.
              </p>
            </div>
          </div>
        </div>

        <p className="px-1 text-[11px] text-ink-600">
          Isolated and shared storage are independent. Enable both when a step needs private scratch space plus
          shared artifact handoff.
        </p>

        <div className="space-y-2 border-t border-[var(--divider)] pt-3">
          <div className="flex items-center justify-between gap-2 px-1">
            <div className="flex items-center gap-2 text-ink-300">
              <ShieldAlert className="h-3.5 w-3.5 text-amber-400" />
              <p className="text-[12px] font-medium">Sandbox mode</p>
            </div>
            <Badge variant={resolvedSandboxMode === "full" ? "warning" : "neutral"}>
              {resolvedSandboxMode === "full" ? "full access" : "secure"}
            </Badge>
          </div>

          <SegmentedControl
            size="sm"
            segments={[
              { value: "auto", label: "Auto" },
              { value: "secure", label: "Secure", disabled: secureSandboxLocked },
              { value: "full", label: "Full" }
            ]}
            value={sandboxMode}
            onValueChange={(value) =>
              onPatchSelectedStep(
                buildSandboxModePatch(value as GeneralSectionProps["selectedStep"]["sandboxMode"])
              )
            }
          />

          <p className="px-1 text-[11px] text-ink-500">
            Auto chooses mode from step intent. Secure keeps sandbox limits. Full enables unrestricted network/system access.
          </p>

          {secureSandboxLocked ? (
            <div className="flex items-start gap-2 rounded-lg bg-amber-500/8 px-3 py-2 text-[11px] text-amber-500">
              <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
              Secure mode is locked for this step: {sandboxReason}
            </div>
          ) : null}

          {!secureSandboxLocked && sandboxMode === "full" ? (
            <div className="flex items-start gap-2 rounded-lg bg-amber-500/8 px-3 py-2 text-[11px] text-amber-500">
              <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
              Full mode can execute networked and privileged commands. Keep it only where strictly required.
            </div>
          ) : null}
        </div>

        {mcpServers.length > 0 ? (
          <div className="space-y-2 border-t border-[var(--divider)] pt-3">
            <p className="px-1 text-[12px] font-medium text-ink-200">MCP access</p>
            {mcpServers.map((server) => {
              const checked = selectedStep.enabledMcpServerIds.includes(server.id);
              return (
                <div key={server.id} className="flex items-center justify-between gap-2 px-1">
                  <div className="min-w-0">
                    <p className="truncate text-xs text-ink-300">{server.name}</p>
                    <p className="truncate text-[10px] text-ink-600">{server.id}</p>
                  </div>
                  <Switch
                    checked={checked}
                    disabled={!server.enabled}
                    onChange={(next) => {
                      onPatchSelectedStep(
                        buildMcpServerIdsPatch({
                          enabled: next,
                          selectedStepEnabledMcpServerIds: selectedStep.enabledMcpServerIds,
                          serverId: server.id
                        })
                      );
                    }}
                  />
                </div>
              );
            })}
            <p className="px-1 text-[11px] text-ink-500">
              This step can call only selected MCP servers while running.
            </p>
          </div>
        ) : null}

        <div className="space-y-2 border-t border-[var(--divider)] pt-3">
          <p className="px-1 text-[12px] font-medium text-ink-200">Output contract</p>

          <div className="space-y-1.5">
            <span className="text-xs text-ink-400">Expected output format</span>
            <Select
              value={selectedStep.outputFormat}
              onValueChange={(value) => onPatchSelectedStep(buildOutputFormatPatch(value))}
              options={outputFormats.map((format) => ({
                value: format.value,
                label: format.label
              }))}
            />
          </div>

          {selectedStep.outputFormat === "json" ? (
            <label className="block space-y-1.5">
              <span className="text-xs text-ink-400">Required JSON fields (one path per line)</span>
              <Textarea
                className="min-h-[84px]"
                value={selectedStep.requiredOutputFields.join("\n")}
                onChange={(event) => onPatchSelectedStep(buildOutputFieldsPatch(event.target.value))}
                placeholder={"status\nartifacts.html\nqa.blockingIssues"}
              />
            </label>
          ) : null}

          <label className="block space-y-1.5">
            <span className="text-xs text-ink-400">Required artifact files (one path per line)</span>
            <Textarea
              className="min-h-[84px]"
              value={selectedStep.requiredOutputFiles.join("\n")}
              onChange={(event) => onPatchSelectedStep(buildOutputFilesPatch(event.target.value))}
              placeholder={"{{shared_storage_path}}/ui-kit.json\n{{run_storage_path}}/qa-report.json"}
            />
          </label>

          <label className="block space-y-1.5">
            <span className="text-xs text-ink-400">Skip-if artifacts (one path per line)</span>
            <Textarea
              className="min-h-[84px]"
              value={selectedStep.skipIfArtifacts.join("\n")}
              onChange={(event) => onPatchSelectedStep(buildSkipIfArtifactsPatch(event.target.value))}
              placeholder={"{{shared_storage_path}}/assets-manifest.json\n{{shared_storage_path}}/frame-map.json"}
            />
          </label>

          <label className="block space-y-1.5">
            <span className="text-xs text-ink-400">Scenario tags (one tag per line)</span>
            <Textarea
              className="min-h-[70px]"
              value={selectedStep.scenarios.join("\n")}
              onChange={(event) => onPatchSelectedStep(buildScenariosPatch(event.target.value))}
              placeholder={"default\ndesign_deck"}
            />
          </label>

          <label className="block space-y-1.5">
            <span className="text-xs text-ink-400">Policy profiles (one id per line)</span>
            <Textarea
              className="min-h-[70px]"
              value={selectedStep.policyProfileIds.join("\n")}
              onChange={(event) => onPatchSelectedStep(buildPolicyProfileIdsPatch(event.target.value))}
              placeholder={"design_deck_assets"}
            />
          </label>

          <label className="block space-y-1.5">
            <span className="text-xs text-ink-400">Cache bypass input keys (one key per line)</span>
            <Textarea
              className="min-h-[70px]"
              value={selectedStep.cacheBypassInputKeys.join("\n")}
              onChange={(event) => onPatchSelectedStep(buildCacheBypassInputKeysPatch(event.target.value))}
              placeholder={"force_refresh_design_assets\nforce_refresh_source_content"}
            />
          </label>

          <label className="block space-y-1.5">
            <span className="text-xs text-ink-400">Orchestrator cache-bypass patterns (regex per line)</span>
            <Textarea
              className="min-h-[84px]"
              value={selectedStep.cacheBypassOrchestratorPromptPatterns.join("\n")}
              onChange={(event) =>
                onPatchSelectedStep(buildCacheBypassOrchestratorPromptPatternsPatch(event.target.value))
              }
              placeholder={"source\\s+content\\s+extract(?:ion|or).*(runs?\\s+always|always\\s+regardless)"}
            />
          </label>

          <p className="px-1 text-[11px] text-ink-500">
            Blocking contracts fail the step automatically and trigger fail routes when configured. Policy profiles
            and cache-bypass controls are fully pipeline-configurable.
          </p>
        </div>
      </div>
    </div>
  );
}
