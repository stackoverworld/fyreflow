import { ListChecks, ShieldCheck } from "lucide-react";
import type { PipelinePayload, QualityGateKind } from "@/lib/types";
import { SegmentedControl, type Segment } from "@/components/optics/segmented-control";
import { usePersistedTab } from "@/components/dashboard/usePersistedTab";
import { QualityGateControls } from "@/components/dashboard/quality-gates/QualityGateControls";
import { QualityGateList } from "@/components/dashboard/quality-gates/QualityGateList";

/* ── Tab config ── */

type ContractsTab = "contracts" | "gates";

const CONTRACTS_TABS = ["contracts", "gates"] as const;

const TAB_SEGMENTS: Segment<ContractsTab>[] = [
  { value: "contracts", label: "Contracts", icon: <ListChecks className="h-3.5 w-3.5" /> },
  { value: "gates", label: "Gates", icon: <ShieldCheck className="h-3.5 w-3.5" /> }
];

/* ── Gate helpers ── */

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
  },
  {
    value: "manual_approval",
    label: "manual approval",
    hint: "Pause run and require explicit human approval before routing continues."
  }
];

function createGateId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }

  return `gate-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function ensureGateDefaults(
  gate: PipelinePayload["qualityGates"][number]
): PipelinePayload["qualityGates"][number] {
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

/* ── Panel ── */

interface QualityGatesPanelProps {
  draft: PipelinePayload;
  onChange: (next: PipelinePayload) => void;
  readOnly?: boolean;
}

export function QualityGatesPanel({ draft, onChange, readOnly = false }: QualityGatesPanelProps) {
  const [activeTab, handleTabChange] = usePersistedTab<ContractsTab>("fyreflow:contracts-tab", "contracts", CONTRACTS_TABS);

  const gates = (draft.qualityGates ?? []).map(ensureGateDefaults);
  const setGates = (nextGates: PipelinePayload["qualityGates"]) => {
    onChange({ ...draft, qualityGates: nextGates });
  };

  const addGate = () => {
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
    ]);
  };

  const updateGate = (
    index: number,
    nextGate: Partial<PipelinePayload["qualityGates"][number]>
  ) => {
    const next = [...gates];
    next[index] = { ...gates[index], ...nextGate };
    setGates(next);
  };

  return (
    <div className="flex h-full flex-col">
      {/* ── Sticky tab bar ── */}
      <div className="sticky top-0 z-10 border-b border-[var(--divider)] bg-[var(--surface-base)] px-3 py-2">
        <SegmentedControl segments={TAB_SEGMENTS} value={activeTab} onValueChange={handleTabChange} />
      </div>

      {/* ── Scrollable tab content ── */}
      <div className="flex-1 overflow-y-auto p-3">
        {activeTab === "contracts" && (
          <QualityGateControls readOnly={readOnly} draft={draft} />
        )}

        {activeTab === "gates" && (
          <QualityGateList
            gates={gates}
            onDeleteGate={(index) => {
              const next = gates.filter((_, gateIndex) => gateIndex !== index);
              setGates(next);
            }}
            onUpdateGate={updateGate}
            kindOptions={kindOptions}
            readOnly={readOnly}
            steps={draft.steps}
            onAdd={addGate}
          />
        )}
      </div>
    </div>
  );
}
