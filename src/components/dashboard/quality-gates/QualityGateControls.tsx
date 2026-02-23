import { ListChecks, ShieldCheck } from "lucide-react";
import type { PipelinePayload } from "@/lib/types";

interface QualityGateControlsProps {
  draft: PipelinePayload;
  readOnly?: boolean;
}

export function QualityGateControls({ draft, readOnly = false }: QualityGateControlsProps) {
  return (
    <>
      <section className="space-y-4">
        <div className="flex items-center gap-2 text-ink-400">
          <ShieldCheck className="h-3.5 w-3.5" />
          <span className="text-[11px] font-semibold uppercase tracking-wider">
            Workflow Contracts
          </span>
        </div>

        <p className="text-xs text-ink-500">
          Quality checks that force a step into fail state and trigger remediation links. Manage gates in the Gates tab.
        </p>
      </section>

      <div className="my-5 h-px bg-[var(--divider)]" />

      {/* ── Step contracts ── */}
      <section className="space-y-4">
        <div className="flex items-center gap-2 text-ink-400">
          <ListChecks className="h-3.5 w-3.5" />
          <span className="text-[11px] font-semibold uppercase tracking-wider">Step contracts</span>
        </div>
        <div className="space-y-2">
          {draft.steps.length === 0 ? (
            <div className="rounded-lg border border-ink-800/50 bg-[var(--surface-raised)] px-3 py-4 text-center text-xs text-ink-500">
              No steps in this flow yet.
            </div>
          ) : (
            draft.steps.map((step) => (
              <div key={step.id} className="rounded-lg bg-ink-800/20 px-3 py-2">
                <div className="flex items-center justify-between gap-2">
                  <p className="truncate text-xs font-medium text-ink-200">{step.name || step.role}</p>
                  <span className="text-[10px] uppercase tracking-wide text-ink-500">{step.outputFormat}</span>
                </div>
                <p className="mt-0.5 text-[11px] text-ink-500">
                  required fields {step.requiredOutputFields.length}
                  {" · "}
                  required files {step.requiredOutputFiles.length}
                </p>
              </div>
            ))
          )}
        </div>
      </section>
    </>
  );
}
