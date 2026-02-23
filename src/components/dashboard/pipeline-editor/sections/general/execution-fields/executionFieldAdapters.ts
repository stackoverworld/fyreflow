import { getDefaultContextWindowForModel } from "@/lib/modelCatalog";
import type { GeneralSectionProps } from "../../../types";
import {
  getModelMeta,
  normalizeReasoning,
  outputFormats,
  parseLineList,
  resolvePreferredModel
} from "../validation";

const MIN_CONTEXT_WINDOW_TOKENS = 64000;
const MAX_CONTEXT_WINDOW_TOKENS = 1000000;

export { outputFormats, parseLineList };

export function buildProviderPatch({
  modelCatalog,
  selectedStep,
  providerId
}: {
  modelCatalog: GeneralSectionProps["modelCatalog"];
  selectedStep: GeneralSectionProps["selectedStep"];
  providerId: GeneralSectionProps["selectedStep"]["providerId"];
}) {
  const defaultModel = resolvePreferredModel(modelCatalog, providerId);
  const contextWindowTokens = getDefaultContextWindowForModel(providerId, defaultModel);

  return {
    providerId,
    model: defaultModel,
    reasoningEffort: normalizeReasoning(modelCatalog, providerId, defaultModel, "medium"),
    fastMode: providerId === "claude" ? selectedStep.fastMode : false,
    use1MContext: providerId === "claude" ? selectedStep.use1MContext : false,
    contextWindowTokens
  };
}

export function getModelPresetOptions(
  modelCatalog: GeneralSectionProps["modelCatalog"],
  providerId: GeneralSectionProps["selectedStep"]["providerId"]
) {
  return [
    ...(modelCatalog[providerId] ?? []).map((option) => ({
      value: option.id,
      label: option.label
    })),
    { value: "__custom__", label: "Custom model id" }
  ];
}

export function buildModelPresetPatch({
  modelCatalog,
  selectedStep,
  providerId,
  selectedModelId
}: {
  modelCatalog: GeneralSectionProps["modelCatalog"];
  selectedStep: GeneralSectionProps["selectedStep"];
  providerId: GeneralSectionProps["selectedStep"]["providerId"];
  selectedModelId: string;
}) {
  if (selectedModelId === "__custom__") {
    return null;
  }

  const modelMeta = getModelMeta(modelCatalog, providerId, selectedModelId);

  return {
    model: selectedModelId,
    reasoningEffort: normalizeReasoning(
      modelCatalog,
      providerId,
      selectedModelId,
      selectedStep.reasoningEffort
    ),
    contextWindowTokens: modelMeta?.contextWindowTokens ?? selectedStep.contextWindowTokens,
    use1MContext:
      providerId === "claude" && selectedStep.use1MContext
        ? modelMeta?.supports1MContext === true
        : false
  };
}

export function buildModelIdPatch({
  modelCatalog,
  providerId,
  selectedStep,
  modelId
}: {
  modelCatalog: GeneralSectionProps["modelCatalog"];
  providerId: GeneralSectionProps["selectedStep"]["providerId"];
  selectedStep: GeneralSectionProps["selectedStep"];
  modelId: string;
}) {
  return {
    model: modelId,
    reasoningEffort: normalizeReasoning(modelCatalog, providerId, modelId, selectedStep.reasoningEffort)
  };
}

export function buildContextWindowPatch({
  rawValue
}: {
  rawValue: string;
}) {
  return {
    contextWindowTokens: Math.max(
      MIN_CONTEXT_WINDOW_TOKENS,
      Math.min(MAX_CONTEXT_WINDOW_TOKENS, Number.parseInt(rawValue, 10) || MIN_CONTEXT_WINDOW_TOKENS)
    )
  };
}

export function buildFastModePatch(fastMode: boolean) {
  return { fastMode };
}

export function build1MContextPatch({
  checked,
  selectedModelMeta,
  selectedStepContextWindowTokens
}: {
  checked: boolean;
  selectedModelMeta: GeneralSectionProps["selectedModelMeta"];
  selectedStepContextWindowTokens: number;
}) {
  return {
    use1MContext: checked,
    contextWindowTokens: checked
      ? Math.max(selectedStepContextWindowTokens, MAX_CONTEXT_WINDOW_TOKENS)
      : selectedModelMeta?.contextWindowTokens ?? selectedStepContextWindowTokens
  };
}

export function buildDelegationPatch(enableDelegation: boolean) {
  return { enableDelegation };
}

export function buildDelegationCountPatch({ value }: { value: string }) {
  return {
    delegationCount: Number.parseInt(value, 10) || 1
  };
}

export function buildEnableIsolatedStoragePatch(enableIsolatedStorage: boolean) {
  return { enableIsolatedStorage };
}

export function buildEnableSharedStoragePatch(enableSharedStorage: boolean) {
  return { enableSharedStorage };
}

export function buildMcpServerIdsPatch({
  enabled,
  selectedStepEnabledMcpServerIds,
  serverId
}: {
  enabled: boolean;
  selectedStepEnabledMcpServerIds: string[];
  serverId: string;
}) {
  const current = new Set(selectedStepEnabledMcpServerIds);
  if (enabled) {
    current.add(serverId);
  } else {
    current.delete(serverId);
  }

  return { enabledMcpServerIds: [...current] };
}

export function buildOutputFormatPatch(value: string) {
  return {
    outputFormat:
      (value === "json" ? "json" : "markdown") as GeneralSectionProps["selectedStep"]["outputFormat"]
  };
}

export function buildOutputFieldsPatch(value: string) {
  return {
    requiredOutputFields: parseLineList(value)
  };
}

export function buildOutputFilesPatch(value: string) {
  return {
    requiredOutputFiles: parseLineList(value)
  };
}

export function buildSkipIfArtifactsPatch(value: string) {
  return {
    skipIfArtifacts: parseLineList(value)
  };
}

export function buildScenariosPatch(value: string) {
  return {
    scenarios: parseLineList(value)
  };
}

export function buildPolicyProfileIdsPatch(value: string) {
  return {
    policyProfileIds: parseLineList(value)
  };
}

export function buildCacheBypassInputKeysPatch(value: string) {
  return {
    cacheBypassInputKeys: parseLineList(value)
  };
}

export function buildCacheBypassOrchestratorPromptPatternsPatch(value: string) {
  return {
    cacheBypassOrchestratorPromptPatterns: parseLineList(value)
  };
}

export function buildPromptPatch(prompt: string) {
  return { prompt };
}

export function buildContextTemplatePatch(contextTemplate: string) {
  return { contextTemplate };
}
