import { FileText } from "lucide-react";
import { Textarea } from "@/components/optics/textarea";
import type { GeneralSectionProps } from "../../../types";
import {
  buildContextTemplatePatch,
  buildPromptPatch
} from "./executionFieldAdapters";

interface TimeoutFieldProps {
  selectedStep: GeneralSectionProps["selectedStep"];
  onPatchSelectedStep: GeneralSectionProps["onPatchSelectedStep"];
}

export function TimeoutField({ selectedStep, onPatchSelectedStep }: TimeoutFieldProps) {
  return (
    <div className="space-y-3">
      <label className="block space-y-1.5">
        <span className="text-xs text-ink-400">Instructions</span>
        <Textarea
          value={selectedStep.prompt}
          onChange={(event) => onPatchSelectedStep(buildPromptPatch(event.target.value))}
          placeholder="Define what this agent should do and how it should format output..."
        />
        <p className="text-[11px] text-ink-600">The system prompt sent to the model at runtime.</p>
      </label>

      <label className="block space-y-1.5">
        <span className="flex items-center gap-1.5 text-xs text-ink-400">
          <FileText className="h-3 w-3" /> Context template
        </span>
        <Textarea
          className="min-h-[100px]"
          value={selectedStep.contextTemplate}
          onChange={(event) => onPatchSelectedStep(buildContextTemplatePatch(event.target.value))}
          placeholder={"Task:\n{{task}}\n\nPrevious output:\n{{previous_output}}"}
        />
        <p className="text-[11px] text-ink-600">
          Variables: <code className="rounded bg-[var(--divider)] px-1 py-0.5 text-ink-300">{"{{task}}"}</code>{" "}
          <code className="rounded bg-[var(--divider)] px-1 py-0.5 text-ink-300">{"{{previous_output}}"}</code>{" "}
          <code className="rounded bg-[var(--divider)] px-1 py-0.5 text-ink-300">{"{{all_outputs}}"}</code>{" "}
          <code className="rounded bg-[var(--divider)] px-1 py-0.5 text-ink-300">{"{{run_inputs}}"}</code>{" "}
          <code className="rounded bg-[var(--divider)] px-1 py-0.5 text-ink-300">{"{{shared_storage_path}}"}</code>{" "}
          <code className="rounded bg-[var(--divider)] px-1 py-0.5 text-ink-300">{"{{isolated_storage_path}}"}</code>{" "}
          <code className="rounded bg-[var(--divider)] px-1 py-0.5 text-ink-300">{"{{run_storage_path}}"}</code>{" "}
          <code className="rounded bg-[var(--divider)] px-1 py-0.5 text-ink-300">{"{{storage_policy}}"}</code>{" "}
          <code className="rounded bg-[var(--divider)] px-1 py-0.5 text-ink-300">{"{{mcp_servers}}"}</code>
          {" · dynamic: "}
          <code className="rounded bg-[var(--divider)] px-1 py-0.5 text-ink-300">{"{{input.<key>}}"}</code>
        </p>
      </label>
    </div>
  );
}
