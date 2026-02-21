import { Cable, GitFork, X } from "lucide-react";
import { Button } from "@/components/optics/button";
import { Select } from "@/components/optics/select";
import type { GeneralSectionProps } from "../../types";
import { linkConditions, linkConditionLabel, resolveCanvasLinkId } from "./validation";

interface SchedulingFieldsProps {
  draft: GeneralSectionProps["draft"];
  selectedStepId: string;
  stepNameById: GeneralSectionProps["stepNameById"];
  outgoingLinks: GeneralSectionProps["outgoingLinks"];
  incomingLinks: GeneralSectionProps["incomingLinks"];
  pendingTargetId: GeneralSectionProps["pendingTargetId"];
  pendingCondition: GeneralSectionProps["pendingCondition"];
  setPendingTargetId: GeneralSectionProps["setPendingTargetId"];
  setPendingCondition: GeneralSectionProps["setPendingCondition"];
  onAddConnection: GeneralSectionProps["onAddConnection"];
  onUpdateLinkCondition: GeneralSectionProps["onUpdateLinkCondition"];
  onRemoveLink: GeneralSectionProps["onRemoveLink"];
}

export function SchedulingFields({
  draft,
  selectedStepId,
  stepNameById,
  outgoingLinks,
  incomingLinks,
  pendingTargetId,
  pendingCondition,
  setPendingTargetId,
  setPendingCondition,
  onAddConnection,
  onUpdateLinkCondition,
  onRemoveLink
}: SchedulingFieldsProps) {
  return (
    <div className="space-y-3">
      <div className="space-y-2">
        <div className="grid grid-cols-[1fr_auto] gap-2">
          <Select
            value={pendingTargetId}
            onValueChange={setPendingTargetId}
            placeholder="Target step..."
            options={draft.steps
              .filter((step) => step.id !== selectedStepId)
              .map((step) => ({
                value: step.id,
                label: step.name || step.role
              }))}
          />
          <Select
            value={pendingCondition}
            onValueChange={(value) => setPendingCondition(value as GeneralSectionProps["pendingCondition"])}
            options={linkConditions.map((condition) => ({
              value: condition,
              label: linkConditionLabel(condition)
            }))}
          />
        </div>

        <Button
          variant="secondary"
          size="sm"
          className="w-full"
          disabled={!pendingTargetId || pendingTargetId === selectedStepId}
          onClick={() => {
            if (!pendingTargetId || pendingTargetId === selectedStepId) {
              return;
            }
            onAddConnection(pendingTargetId, pendingCondition);
          }}
        >
          <Cable className="mr-1.5 h-3.5 w-3.5" /> Add connection
        </Button>
      </div>

      {outgoingLinks.length > 0 && (
        <div className="space-y-1.5">
          <p className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wider text-ink-500">
            <GitFork className="h-3 w-3" /> Outgoing
          </p>
          {outgoingLinks.map((link) => {
            const linkIndex = draft.links.indexOf(link);
            const linkId = linkIndex >= 0 ? resolveCanvasLinkId(link, linkIndex) : link.id ?? "";
            const targetName = stepNameById.get(link.targetStepId) ?? link.targetStepId;
            return (
              <div
                key={`${link.id ?? `${link.sourceStepId}-${link.targetStepId}`}-out`}
                className="flex items-center gap-2 rounded-lg bg-ink-800/20 px-2 py-1.5"
              >
                <p className="min-w-0 flex-1 truncate text-xs text-ink-200">{targetName}</p>
                <Select
                  className="w-[112px]"
                  value={link.condition ?? "always"}
                  onValueChange={(value) => {
                    onUpdateLinkCondition(linkId, value as GeneralSectionProps["pendingCondition"]);
                  }}
                  options={linkConditions.map((condition) => ({
                    value: condition,
                    label: linkConditionLabel(condition)
                  }))}
                />
                <button
                  type="button"
                  onClick={() => onRemoveLink(linkId)}
                  className="rounded-md p-1 text-ink-600 transition-colors hover:text-red-400"
                  aria-label="Remove link"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            );
          })}
        </div>
      )}

      {incomingLinks.length > 0 && (
        <div className="space-y-1.5">
          <p className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wider text-ink-500">
            <GitFork className="h-3 w-3 rotate-180" /> Incoming
          </p>
          {incomingLinks.map((link) => {
            const sourceName = stepNameById.get(link.sourceStepId) ?? link.sourceStepId;
            return (
              <div
                key={`${link.id ?? `${link.sourceStepId}-${link.targetStepId}`}-in`}
                className="flex items-center justify-between gap-2 rounded-lg bg-ink-800/20 px-2 py-1.5"
              >
                <p className="min-w-0 truncate text-xs text-ink-200">{sourceName}</p>
                <span className="rounded-full bg-ink-800 px-2 py-0.5 text-[10px] uppercase tracking-wide text-ink-400">
                  {linkConditionLabel(link.condition ?? "always")}
                </span>
              </div>
            );
          })}
        </div>
      )}

      {outgoingLinks.length === 0 && incomingLinks.length === 0 && (
        <p className="py-2 text-center text-[11px] text-ink-600">
          No connections yet. Link steps by dragging on the canvas or using the form above.
        </p>
      )}
    </div>
  );
}
