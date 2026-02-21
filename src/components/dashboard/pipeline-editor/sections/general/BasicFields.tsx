import { Input } from "@/components/optics/input";
import { Select } from "@/components/optics/select";
import type { GeneralSectionProps } from "../../types";
import { makeStepName, roles } from "./validation";

interface BasicFieldsProps {
  selectedStep: GeneralSectionProps["selectedStep"];
  selectedStepIndex: number;
  onPatchSelectedStep: GeneralSectionProps["onPatchSelectedStep"];
}

export function BasicFields({ selectedStep, selectedStepIndex, onPatchSelectedStep }: BasicFieldsProps) {
  return (
    <div className="space-y-3">
      <label className="block space-y-1.5">
        <span className="text-xs text-ink-400">Name</span>
        <Input
          value={selectedStep.name}
          onChange={(event) => onPatchSelectedStep({ name: event.target.value })}
          placeholder="Give this agent a name"
        />
      </label>

      <div className="space-y-1.5">
        <span className="text-xs text-ink-400">Role</span>
        <Select
          value={selectedStep.role}
          onValueChange={(val) => {
            const role = val as GeneralSectionProps["selectedStep"]["role"];
            onPatchSelectedStep({
              role,
              enableDelegation:
                role === "executor" || role === "orchestrator"
                  ? selectedStep.enableDelegation || role === "orchestrator"
                  : false,
              name: selectedStep.name.trim().length > 0
                ? selectedStep.name
                : makeStepName(role, Math.max(selectedStepIndex, 0))
            });
          }}
          options={roles.map((role) => ({ value: role, label: role }))}
        />
        <p className="text-[11px] text-ink-600">Determines how this agent behaves in the pipeline.</p>
      </div>
    </div>
  );
}
