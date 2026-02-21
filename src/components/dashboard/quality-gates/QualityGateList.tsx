import { AlertTriangle, ShieldCheck, Trash2 } from "lucide-react";
import type { PipelinePayload, QualityGateKind } from "@/lib/types";
import { Input } from "@/components/optics/input";
import { Select } from "@/components/optics/select";
import { Switch } from "@/components/optics/switch";
import { Textarea } from "@/components/optics/textarea";

interface QualityGateListProps {
  gates: PipelinePayload["qualityGates"];
  kindOptions: Array<{ value: QualityGateKind; label: string; hint: string }>;
  onDeleteGate: (index: number) => void;
  onUpdateGate: (
    index: number,
    nextGate: Partial<PipelinePayload["qualityGates"][number]>
  ) => void;
  readOnly?: boolean;
  steps: PipelinePayload["steps"];
}

export function QualityGateList({
  gates,
  kindOptions,
  onDeleteGate,
  onUpdateGate,
  readOnly = false,
  steps
}: QualityGateListProps) {
  return (
    <section className="space-y-4">
      <div className="flex items-center gap-2 text-ink-400">
        <ShieldCheck className="h-3.5 w-3.5" />
        <span className="text-[11px] font-semibold uppercase tracking-wider">Pipeline quality gates</span>
      </div>

      {gates.length === 0 ? (
        <div className="rounded-lg bg-ink-900/25 px-4 py-6 text-center">
          <AlertTriangle className="mx-auto mb-2 h-4 w-4 text-ink-600" />
          <p className="text-xs text-ink-500">No gates configured yet.</p>
        </div>
      ) : (
        gates.map((gate, index) => {
          const targetOptions = [
            { value: "any_step", label: "Any step" },
            ...steps.map((step) => ({ value: step.id, label: step.name || step.role }))
          ];
          const kindMeta = kindOptions.find((option) => option.value === gate.kind) ?? kindOptions[0];

          return (
            <div
              key={gate.id ?? `${gate.name}-${index}`}
              className="space-y-3 rounded-lg bg-ink-900/25 px-3 py-3"
            >
              <div className="flex items-start justify-between gap-3">
                <label className="flex-1 space-y-1">
                  <span className="text-[11px] uppercase tracking-wide text-ink-500">Name</span>
                  <Input
                    value={gate.name}
                    disabled={readOnly}
                    onChange={(event) => {
                      onUpdateGate(index, { name: event.target.value });
                    }}
                  />
                </label>
                <button
                  type="button"
                  disabled={readOnly}
                  onClick={() => {
                    onDeleteGate(index);
                  }}
                  className={
                    readOnly
                      ? "mt-6 rounded-lg p-2 text-ink-700 cursor-not-allowed"
                      : "mt-6 rounded-lg p-2 text-ink-600 transition-colors hover:bg-red-500/10 hover:text-red-400"
                  }
                  aria-label="Delete quality gate"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <label className="space-y-1">
                  <span className="text-[11px] uppercase tracking-wide text-ink-500">Target step</span>
                  <Select
                    value={gate.targetStepId}
                    disabled={readOnly}
                    onValueChange={(value) => {
                      onUpdateGate(index, { targetStepId: value });
                    }}
                    options={targetOptions}
                  />
                </label>

                <label className="space-y-1">
                  <span className="text-[11px] uppercase tracking-wide text-ink-500">Gate kind</span>
                  <Select
                    value={gate.kind}
                    disabled={readOnly}
                    onValueChange={(value) => {
                      onUpdateGate(index, { kind: value as QualityGateKind });
                    }}
                    options={kindOptions.map((option) => ({ value: option.value, label: option.label }))}
                  />
                </label>
              </div>

              <p className="text-[11px] text-ink-500">{kindMeta.hint}</p>

              {(gate.kind === "regex_must_match" || gate.kind === "regex_must_not_match") ? (
                <div className="grid grid-cols-[1fr_80px] gap-2">
                  <label className="space-y-1">
                    <span className="text-[11px] uppercase tracking-wide text-ink-500">Regex pattern</span>
                    <Input
                      value={gate.pattern ?? ""}
                      disabled={readOnly}
                      onChange={(event) => {
                        onUpdateGate(index, { pattern: event.target.value });
                      }}
                      placeholder="WORKFLOW_STATUS\\s*:\\s*PASS"
                    />
                  </label>
                  <label className="space-y-1">
                    <span className="text-[11px] uppercase tracking-wide text-ink-500">Flags</span>
                    <Input
                      value={gate.flags ?? ""}
                      disabled={readOnly}
                      onChange={(event) => {
                        onUpdateGate(index, { flags: event.target.value });
                      }}
                      placeholder="i"
                    />
                  </label>
                </div>
              ) : null}

              {gate.kind === "json_field_exists" ? (
                <label className="space-y-1">
                  <span className="text-[11px] uppercase tracking-wide text-ink-500">JSON path</span>
                  <Input
                    value={gate.jsonPath ?? ""}
                    disabled={readOnly}
                    onChange={(event) => {
                      onUpdateGate(index, { jsonPath: event.target.value });
                    }}
                    placeholder="status"
                  />
                </label>
              ) : null}

              {gate.kind === "artifact_exists" ? (
                <label className="space-y-1">
                  <span className="text-[11px] uppercase tracking-wide text-ink-500">Artifact path</span>
                  <Input
                    value={gate.artifactPath ?? ""}
                    disabled={readOnly}
                    onChange={(event) => {
                      onUpdateGate(index, { artifactPath: event.target.value });
                    }}
                    placeholder="{{shared_storage_path}}/qa-report.json"
                  />
                </label>
              ) : null}

              <label className="space-y-1">
                <span className="text-[11px] uppercase tracking-wide text-ink-500">
                  {gate.kind === "manual_approval" ? "Approval message" : "Failure message"}
                </span>
                <Textarea
                  className="min-h-[64px]"
                  value={gate.message ?? ""}
                  disabled={readOnly}
                  onChange={(event) => {
                    onUpdateGate(index, { message: event.target.value });
                  }}
                  placeholder={
                    gate.kind === "manual_approval"
                      ? "Describe what reviewer should verify before approving."
                      : "Describe why this gate is important."
                  }
                />
              </label>

              <div className="flex items-center justify-between rounded-lg bg-ink-800/35 px-2.5 py-2">
                <div>
                  <p className="text-xs text-ink-200">Blocking gate</p>
                  <p className="text-[11px] text-ink-500">
                    Fail step immediately and route through `on_fail` links.
                  </p>
                </div>
                <Switch
                  checked={gate.blocking}
                  disabled={readOnly}
                  onChange={(checked) => {
                    onUpdateGate(index, { blocking: checked });
                  }}
                />
              </div>
            </div>
          );
        })
      )}
    </section>
  );
}
