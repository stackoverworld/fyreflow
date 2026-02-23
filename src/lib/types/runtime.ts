import type {
  AgentRole,
  QualityGateKind,
  WorkflowOutcome,
} from "./pipeline";

export type StepRunStatus = "pending" | "running" | "completed" | "failed";
export type StepTriggerReason =
  | "entry_step"
  | "cycle_bootstrap"
  | "route"
  | "skip_if_artifacts"
  | "disconnected_fallback";
export type RunStatus =
  | "queued"
  | "running"
  | "paused"
  | "awaiting_approval"
  | "completed"
  | "failed"
  | "cancelled";
export type SmartRunFieldType = "text" | "multiline" | "secret" | "path" | "url";
export type SmartRunCheckStatus = "pass" | "warn" | "fail";
export type RunInputRequestType = SmartRunFieldType | "select";
export type RunStartupStatus = "pass" | "needs_input" | "blocked";
export type RunApprovalStatus = "pending" | "approved" | "rejected";
export type QualityGateResultStatus = "pass" | "fail";

export interface RunApproval {
  id: string;
  gateId: string;
  gateName: string;
  stepId: string;
  stepName: string;
  status: RunApprovalStatus;
  blocking: boolean;
  message: string;
  requestedAt: string;
  resolvedAt?: string;
  note?: string;
}

export interface StepQualityGateResult {
  gateId: string;
  gateName: string;
  kind: QualityGateKind | "step_contract";
  status: QualityGateResultStatus;
  blocking: boolean;
  message: string;
  details: string;
}

export interface StepRun {
  stepId: string;
  triggeredByStepId?: string;
  triggeredByReason?: StepTriggerReason;
  stepName: string;
  role: AgentRole;
  status: StepRunStatus;
  attempts: number;
  workflowOutcome: WorkflowOutcome;
  inputContext: string;
  output: string;
  subagentNotes: string[];
  qualityGateResults: StepQualityGateResult[];
  startedAt?: string;
  finishedAt?: string;
  error?: string;
}

export interface PipelineRun {
  id: string;
  pipelineId: string;
  pipelineName: string;
  task: string;
  inputs: Record<string, string>;
  scenario?: string;
  status: RunStatus;
  startedAt: string;
  finishedAt?: string;
  logs: string[];
  steps: StepRun[];
  approvals: RunApproval[];
}

export interface SmartRunField {
  key: string;
  label: string;
  type: SmartRunFieldType;
  required: boolean;
  description: string;
  placeholder: string;
  sources: string[];
}

export interface SmartRunCheck {
  id: string;
  title: string;
  status: SmartRunCheckStatus;
  message: string;
  details?: string;
}

export interface SmartRunPlan {
  fields: SmartRunField[];
  checks: SmartRunCheck[];
  canRun: boolean;
}

export interface RunInputRequestOption {
  value: string;
  label: string;
  description?: string;
}

export interface RunInputRequest {
  key: string;
  label: string;
  type: RunInputRequestType;
  required: boolean;
  reason: string;
  placeholder?: string;
  options?: RunInputRequestOption[];
  allowCustom?: boolean;
  defaultValue?: string;
}

export interface RunStartupBlocker {
  id: string;
  title: string;
  message: string;
  details?: string;
}

export interface RunStartupCheck {
  status: RunStartupStatus;
  summary: string;
  requests: RunInputRequest[];
  blockers: RunStartupBlocker[];
  source: "deterministic" | "model" | "merged";
  notes: string[];
}
