import { useCallback, useState } from "react";
import { AlertTriangle, X } from "lucide-react";
import { Input } from "@/components/optics/input";
import { Select } from "@/components/optics/select";
import { Switch } from "@/components/optics/switch";
import { Textarea } from "@/components/optics/textarea";
import type { GeneralSectionProps } from "../../../types";
import {
  buildDelegationCountPatch,
  buildDelegationPatch,
  buildEnableIsolatedStoragePatch,
  buildEnableSharedStoragePatch,
  buildFastModePatch,
  buildMcpServerIdsPatch,
  buildOutputFilesPatch,
  buildOutputFormatPatch,
  buildOutputFieldsPatch,
  build1MContextPatch,
  outputFormats
} from "./executionFieldAdapters";

interface RetryPolicyFieldProps {
  mcpServers: GeneralSectionProps["mcpServers"];
  selectedStep: GeneralSectionProps["selectedStep"];
  selectedModelMeta: GeneralSectionProps["selectedModelMeta"];
  onPatchSelectedStep: GeneralSectionProps["onPatchSelectedStep"];
}

export function RetryPolicyField({
  mcpServers,
  selectedStep,
  selectedModelMeta,
  onPatchSelectedStep
}: RetryPolicyFieldProps) {
  const [dismissedWarnings, setDismissedWarnings] = useState<Set<string>>(new Set());

  const dismissWarning = useCallback((key: string) => {
    setDismissedWarnings((prev) => new Set(prev).add(key));
  }, []);

  const handleFastModeChange = useCallback(
    (checked: boolean) => {
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
  const show1MContextWarning = selectedStep.use1MContext && !dismissedWarnings.has("1mContext");

  return (
    <div className="space-y-3">
      <div className="space-y-2">
        <div className="flex items-center justify-between gap-3 rounded-lg px-1 py-1">
          <div className="flex items-center gap-2.5">
            <Switch
              checked={selectedStep.fastMode}
              disabled={selectedStep.providerId !== "claude"}
              onChange={handleFastModeChange}
            />
            <div>
              <p className="text-[13px] text-ink-100">Fast mode</p>
              <p className="text-[11px] text-ink-500">Prioritized processing for Claude models.</p>
            </div>
          </div>
        </div>

        {showFastModeWarning && (
          <div className="flex items-start gap-2 rounded-lg border border-amber-500/25 bg-amber-500/8 px-3 py-2">
            <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0 text-amber-500" />
            <div className="min-w-0 flex-1">
              <p className="text-[11px] leading-relaxed text-amber-600">
                Fast mode runs at <span className="font-semibold">6x standard pricing</span> (up to 12x for prompts over 200K tokens). Same model intelligence, faster inference.
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
              checked={selectedStep.use1MContext}
              disabled={selectedStep.providerId !== "claude" || selectedModelMeta?.supports1MContext === false}
              onChange={handle1MContextChange}
            />
            <div>
              <p className="text-[13px] text-ink-100">1M context</p>
              <p className="text-[11px] text-ink-500">Extended window for large documents.</p>
            </div>
          </div>
        </div>

        {show1MContextWarning && (
          <div className="flex items-start gap-2 rounded-lg border border-amber-500/25 bg-amber-500/8 px-3 py-2">
            <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0 text-amber-500" />
            <div className="min-w-0 flex-1">
              <p className="text-[11px] leading-relaxed text-amber-600">
                Requests exceeding 200K input tokens incur <span className="font-semibold">2x token pricing</span> on all tokens in the request. Available for Opus 4.6 and Sonnet models only.
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

        {mcpServers.length > 0 ? (
          <div className="space-y-2 rounded-lg border border-ink-800 bg-[var(--surface-raised)] px-3 py-2">
            <p className="text-[12px] font-medium text-ink-200">MCP access</p>
            {mcpServers.map((server) => {
              const checked = selectedStep.enabledMcpServerIds.includes(server.id);
              return (
                <div key={server.id} className="flex items-center justify-between gap-2">
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
            <p className="text-[11px] text-ink-500">
              This step can call only selected MCP servers while running.
            </p>
          </div>
        ) : null}

        <div className="space-y-2 rounded-lg border border-ink-800 bg-[var(--surface-raised)] px-3 py-2">
          <p className="text-[12px] font-medium text-ink-200">Output contract</p>

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

          <p className="text-[11px] text-ink-500">
            Blocking contracts fail the step automatically and trigger fail routes when configured.
          </p>
        </div>
      </div>
    </div>
  );
}
