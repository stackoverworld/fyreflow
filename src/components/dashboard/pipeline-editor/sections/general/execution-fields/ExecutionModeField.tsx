import { OpenAIIcon, AnthropicIcon } from "@/components/optics/icons";
import { Input } from "@/components/optics/input";
import { SegmentedControl } from "@/components/optics/segmented-control";
import { Select } from "@/components/optics/select";
import type { GeneralSectionProps } from "../../../types";
import {
  buildContextWindowPatch,
  buildModelIdPatch,
  buildModelPresetPatch,
  buildProviderPatch,
  getModelPresetOptions
} from "./executionFieldAdapters";

const providerSegments = [
  { value: "openai", label: "OpenAI", icon: <OpenAIIcon className="h-3.5 w-3.5" /> },
  { value: "claude", label: "Anthropic", icon: <AnthropicIcon className="h-3.5 w-3.5" /> }
];

interface ExecutionModeFieldProps {
  modelCatalog: GeneralSectionProps["modelCatalog"];
  selectedStep: GeneralSectionProps["selectedStep"];
  selectedModelMeta: GeneralSectionProps["selectedModelMeta"];
  reasoningModes: GeneralSectionProps["reasoningModes"];
  providerDefaultModel: GeneralSectionProps["providerDefaultModel"];
  onPatchSelectedStep: GeneralSectionProps["onPatchSelectedStep"];
}

export function ExecutionModeField({
  modelCatalog,
  selectedStep,
  selectedModelMeta,
  reasoningModes,
  providerDefaultModel,
  onPatchSelectedStep
}: ExecutionModeFieldProps) {
  return (
    <div className="space-y-3">
      <div className="space-y-1.5">
        <span className="text-xs text-ink-400">Provider</span>
        <SegmentedControl
          segments={providerSegments}
          value={selectedStep.providerId}
          onValueChange={(providerId) => {
            onPatchSelectedStep(
              buildProviderPatch({
                modelCatalog,
                selectedStep,
                providerId: providerId as GeneralSectionProps["selectedStep"]["providerId"]
              })
            );
          }}
        />
      </div>

      <div className="space-y-1.5">
        <span className="text-xs text-ink-400">Model preset</span>
        <Select
          value={selectedModelMeta ? selectedStep.model : "__custom__"}
          onValueChange={(selectedModelId) => {
            const patch = buildModelPresetPatch({
              modelCatalog,
              selectedStep,
              providerId: selectedStep.providerId,
              selectedModelId
            });
            if (patch) {
              onPatchSelectedStep(patch);
            }
          }}
          options={getModelPresetOptions(modelCatalog, selectedStep.providerId)}
        />
      </div>

      <label className="block space-y-1.5">
        <span className="text-xs text-ink-400">Model ID override</span>
        <Input
          value={selectedStep.model}
          onChange={(event) => {
            onPatchSelectedStep(
              buildModelIdPatch({
                modelCatalog,
                providerId: selectedStep.providerId,
                selectedStep,
                modelId: event.target.value
              })
            );
          }}
          placeholder={selectedStep.providerId === "openai" ? "gpt-5.3-codex" : "claude-sonnet-4-6"}
        />
        <p className="text-[11px] text-ink-600">
          {selectedModelMeta?.notes || `Enter any model ID. Default: ${providerDefaultModel}`}
        </p>
      </label>

      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <span className="text-xs text-ink-400">Reasoning</span>
          <Select
            value={selectedStep.reasoningEffort}
            onValueChange={(val) =>
              onPatchSelectedStep({
                reasoningEffort: val as GeneralSectionProps["selectedStep"]["reasoningEffort"]
              })
            }
            options={reasoningModes.map((mode) => ({ value: mode, label: mode }))}
          />
        </div>

        <label className="space-y-1.5">
          <span className="text-xs text-ink-400">Context tokens</span>
          <Input
            type="number"
            min={64000}
            max={1000000}
            value={selectedStep.contextWindowTokens}
            onChange={(event) =>
              onPatchSelectedStep(
                buildContextWindowPatch({
                  rawValue: event.target.value
                })
              )
            }
          />
        </label>
      </div>
    </div>
  );
}
