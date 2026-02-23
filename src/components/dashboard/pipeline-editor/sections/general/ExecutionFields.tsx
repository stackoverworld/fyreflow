import { ExecutionModeField } from "./execution-fields/ExecutionModeField";
import { RetryPolicyField } from "./execution-fields/RetryPolicyField";
import { TimeoutField } from "./execution-fields/TimeoutField";
import type { GeneralSectionProps } from "../../types";

interface ExecutionFieldsProps {
  draft: GeneralSectionProps["draft"];
  modelCatalog: GeneralSectionProps["modelCatalog"];
  mcpServers: GeneralSectionProps["mcpServers"];
  claudeFastModeAvailable: GeneralSectionProps["claudeFastModeAvailable"];
  claudeFastModeUnavailableNote?: GeneralSectionProps["claudeFastModeUnavailableNote"];
  selectedStep: GeneralSectionProps["selectedStep"];
  selectedModelMeta: GeneralSectionProps["selectedModelMeta"];
  reasoningModes: GeneralSectionProps["reasoningModes"];
  providerDefaultModel: GeneralSectionProps["providerDefaultModel"];
  onPatchSelectedStep: GeneralSectionProps["onPatchSelectedStep"];
}

export function ExecutionFields({
  modelCatalog,
  mcpServers,
  claudeFastModeAvailable,
  claudeFastModeUnavailableNote,
  selectedStep,
  selectedModelMeta,
  reasoningModes,
  providerDefaultModel,
  onPatchSelectedStep
}: ExecutionFieldsProps) {
  return (
    <>
      <ExecutionModeField
        modelCatalog={modelCatalog}
        selectedStep={selectedStep}
        selectedModelMeta={selectedModelMeta}
        reasoningModes={reasoningModes}
        providerDefaultModel={providerDefaultModel}
        onPatchSelectedStep={onPatchSelectedStep}
      />

      <div className="my-5 h-px bg-[var(--divider)]" />

      <RetryPolicyField
        mcpServers={mcpServers}
        selectedStep={selectedStep}
        selectedModelMeta={selectedModelMeta}
        claudeFastModeAvailable={claudeFastModeAvailable}
        claudeFastModeUnavailableNote={claudeFastModeUnavailableNote}
        onPatchSelectedStep={onPatchSelectedStep}
      />

      <div className="my-5 h-px bg-[var(--divider)]" />

      <TimeoutField selectedStep={selectedStep} onPatchSelectedStep={onPatchSelectedStep} />
    </>
  );
}
