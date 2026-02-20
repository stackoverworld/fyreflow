import { AlertTriangle, Plus, ShieldCheck, Trash2 } from "lucide-react";
import type { PipelinePayload, QualityGateKind } from "@/lib/types";
import { Button } from "@/components/optics/button";
import { Input } from "@/components/optics/input";
import { Select } from "@/components/optics/select";
import { Switch } from "@/components/optics/switch";
import { Textarea } from "@/components/optics/textarea";

interface QualityGatesPanelProps {
  draft: PipelinePayload;
  onChange: (next: PipelinePayload) => void;
}

const kindOptions: Array<{ value: QualityGateKind; label: string; hint: string }> = [
  {
    value: "regex_must_match",
    label: "regex must match",
    hint: "Output text must match the regex."
  },
  {
    value: "regex_must_not_match",
    label: "regex must not match",
    hint: "Output text must not match the regex."
  },
  {
    value: "json_field_exists",
    label: "json field exists",
    hint: "When output is JSON, this path must exist."
  },
  {
    value: "artifact_exists",
    label: "artifact exists",
    hint: "File must exist at the configured path."
  }
];

function createGateId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }

  return `gate-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function ensureGateDefaults(gate: PipelinePayload["qualityGates"][number]): PipelinePayload["qualityGates"][number] {
  return {
    id: gate.id,
    name: gate.name,
    targetStepId: gate.targetStepId,
    kind: gate.kind,
    blocking: gate.blocking,
    pattern: gate.pattern ?? "",
    flags: gate.flags ?? "",
    jsonPath: gate.jsonPath ?? "",
    artifactPath: gate.artifactPath ?? "",
    message: gate.message ?? ""
  };
}

export function QualityGatesPanel({ draft, onChange }: QualityGatesPanelProps) {
  const gates = (draft.qualityGates ?? []).map(ensureGateDefaults);
  const setGates = (nextGates: PipelinePayload["qualityGates"]) => {
    onChange({ ...draft, qualityGates: nextGates });
  };

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div className="space-y-1">
          <p className="text-xs font-semibold uppercase tracking-wide text-ink-400">Strict Workflow Contracts</p>
          <p className="text-xs text-ink-500">
            Configure hard quality checks that can force a step into fail state and trigger remediation links.
          </p>
        </div>
        <Button
          size="sm"
          variant="secondary"
          className="shrink-0 whitespace-nowrap"
          onClick={() =>
            setGates([
              ...gates,
              {
                id: createGateId(),
                name: `Gate ${gates.length + 1}`,
                targetStepId: "any_step",
                kind: "regex_must_match",
                blocking: true,
                pattern: "WORKFLOW_STATUS\\s*:\\s*(PASS|FAIL|NEUTRAL)",
                flags: "i",
                jsonPath: "",
                artifactPath: "",
                message: "Step output must include explicit workflow status."
              }
            ])
          }
        >
          <Plus className="h-3.5 w-3.5" />
          Add Gate
        </Button>
      </div>

      <div className="h-px bg-ink-800/60" />

      <section className="space-y-3">
        <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-ink-400">
          <ShieldCheck className="h-3.5 w-3.5" />
          Step contracts overview
        </p>
        <div className="space-y-2">
          {draft.steps.map((step) => (
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
          ))}
        </div>
      </section>

      <div className="h-px bg-ink-800/60" />

      <section className="space-y-3">
        <p className="text-xs font-semibold uppercase tracking-wide text-ink-400">Pipeline quality gates</p>

        {gates.length === 0 ? (
          <div className="rounded-lg bg-ink-900/25 px-4 py-6 text-center">
            <AlertTriangle className="mx-auto mb-2 h-4 w-4 text-ink-600" />
            <p className="text-xs text-ink-500">No gates configured yet.</p>
          </div>
        ) : (
          gates.map((gate, index) => {
            const targetOptions = [
              { value: "any_step", label: "Any step" },
              ...draft.steps.map((step) => ({ value: step.id, label: step.name || step.role }))
            ];
            const kindMeta = kindOptions.find((option) => option.value === gate.kind) ?? kindOptions[0];

            return (
              <div key={gate.id ?? `${gate.name}-${index}`} className="space-y-3 rounded-lg bg-ink-900/25 px-3 py-3">
                <div className="flex items-start justify-between gap-3">
                  <label className="flex-1 space-y-1">
                    <span className="text-[11px] uppercase tracking-wide text-ink-500">Name</span>
                    <Input
                      value={gate.name}
                      onChange={(event) => {
                        const next = [...gates];
                        next[index] = { ...gate, name: event.target.value };
                        setGates(next);
                      }}
                    />
                  </label>
                  <button
                    type="button"
                    onClick={() => {
                      const next = gates.filter((_, gateIndex) => gateIndex !== index);
                      setGates(next);
                    }}
                    className="mt-6 rounded-lg p-2 text-ink-600 transition-colors hover:bg-red-500/10 hover:text-red-400"
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
                      onValueChange={(value) => {
                        const next = [...gates];
                        next[index] = { ...gate, targetStepId: value };
                        setGates(next);
                      }}
                      options={targetOptions}
                    />
                  </label>

                  <label className="space-y-1">
                    <span className="text-[11px] uppercase tracking-wide text-ink-500">Gate kind</span>
                    <Select
                      value={gate.kind}
                      onValueChange={(value) => {
                        const next = [...gates];
                        next[index] = { ...gate, kind: value as QualityGateKind };
                        setGates(next);
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
                        onChange={(event) => {
                          const next = [...gates];
                          next[index] = { ...gate, pattern: event.target.value };
                          setGates(next);
                        }}
                        placeholder="WORKFLOW_STATUS\\s*:\\s*PASS"
                      />
                    </label>
                    <label className="space-y-1">
                      <span className="text-[11px] uppercase tracking-wide text-ink-500">Flags</span>
                      <Input
                        value={gate.flags ?? ""}
                        onChange={(event) => {
                          const next = [...gates];
                          next[index] = { ...gate, flags: event.target.value };
                          setGates(next);
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
                      onChange={(event) => {
                        const next = [...gates];
                        next[index] = { ...gate, jsonPath: event.target.value };
                        setGates(next);
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
                      onChange={(event) => {
                        const next = [...gates];
                        next[index] = { ...gate, artifactPath: event.target.value };
                        setGates(next);
                      }}
                      placeholder="{{shared_storage_path}}/qa-report.json"
                    />
                  </label>
                ) : null}

                <label className="space-y-1">
                  <span className="text-[11px] uppercase tracking-wide text-ink-500">Failure message</span>
                  <Textarea
                    className="min-h-[64px]"
                    value={gate.message ?? ""}
                    onChange={(event) => {
                      const next = [...gates];
                      next[index] = { ...gate, message: event.target.value };
                      setGates(next);
                    }}
                    placeholder="Describe why this gate is important."
                  />
                </label>

                <div className="flex items-center justify-between rounded-lg bg-ink-800/35 px-2.5 py-2">
                  <div>
                    <p className="text-xs text-ink-200">Blocking gate</p>
                    <p className="text-[11px] text-ink-500">Fail step immediately and route through `on_fail` links.</p>
                  </div>
                  <Switch
                    checked={gate.blocking}
                    onChange={(checked) => {
                      const next = [...gates];
                      next[index] = { ...gate, blocking: checked };
                      setGates(next);
                    }}
                  />
                </div>
              </div>
            );
          })
        )}
      </section>
    </div>
  );
}
