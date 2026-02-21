import { BasicFields } from "./general/BasicFields";
import { ExecutionFields } from "./general/ExecutionFields";
import { SchedulingFields } from "./general/SchedulingFields";
import { type GeneralSectionProps } from "../types";

export function GeneralSection({
  draft,
  modelCatalog,
  mcpServers,
  selectedStep,
  selectedStepIndex,
  selectedModelMeta,
  reasoningModes,
  providerDefaultModel,
  pendingTargetId,
  pendingCondition,
  stepNameById,
  outgoingLinks,
  incomingLinks,
  setPendingTargetId,
  setPendingCondition,
  onPatchSelectedStep,
  onAddConnection,
  onUpdateLinkCondition,
  onRemoveLink
}: GeneralSectionProps) {
  return (
    <>
      <BasicFields
        selectedStep={selectedStep}
        selectedStepIndex={selectedStepIndex}
        onPatchSelectedStep={onPatchSelectedStep}
      />

      <div className="my-5 h-px bg-[var(--divider)]" />

      <ExecutionFields
        draft={draft}
        modelCatalog={modelCatalog}
        mcpServers={mcpServers}
        selectedStep={selectedStep}
        selectedModelMeta={selectedModelMeta}
        reasoningModes={reasoningModes}
        providerDefaultModel={providerDefaultModel}
        onPatchSelectedStep={onPatchSelectedStep}
      />

      <div className="my-5 h-px bg-[var(--divider)]" />

      <SchedulingFields
        draft={draft}
        selectedStepId={selectedStep.id}
        stepNameById={stepNameById}
        outgoingLinks={outgoingLinks}
        incomingLinks={incomingLinks}
        pendingTargetId={pendingTargetId}
        pendingCondition={pendingCondition}
        setPendingTargetId={setPendingTargetId}
        setPendingCondition={setPendingCondition}
        onAddConnection={onAddConnection}
        onUpdateLinkCondition={onUpdateLinkCondition}
        onRemoveLink={onRemoveLink}
      />
    </>
  );
}
