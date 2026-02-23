import type { AgentRole } from "../types.js";

export const defaultRolePrompts: Record<AgentRole, string> = {
  analysis: "Analyze the request, constraints, and acceptance criteria. Produce structured inputs for downstream steps.",
  planner: "Turn requirements into an execution plan with concrete stage outputs and dependencies.",
  orchestrator:
    "Act as main orchestrator. Route work to connected agents, enforce quality gates, and drive pass/fail remediation loops.",
  executor: "Execute implementation tasks and produce concrete artifacts for the next stage.",
  tester: "Run validation and detect defects or regressions before approval.",
  review:
    "Review quality against requirements and output WORKFLOW_STATUS: PASS or WORKFLOW_STATUS: FAIL with actionable issues."
};

export interface FlowRuntime {
  maxLoops: number;
  maxStepExecutions: number;
  stageTimeoutMs: number;
}

export const defaultRuntime: FlowRuntime = {
  maxLoops: 2,
  maxStepExecutions: 18,
  stageTimeoutMs: 420000
};

export interface FlowSchedule {
  enabled: boolean;
  cron: string;
  timezone: string;
  task: string;
  runMode: "smart" | "quick";
  inputs: Record<string, string>;
}

export const defaultSchedule: FlowSchedule = {
  enabled: false,
  cron: "",
  timezone: "UTC",
  task: "",
  runMode: "smart",
  inputs: {} as Record<string, string>
};

export const orchestratorClaudeModel = "claude-sonnet-4-6";
export const orchestratorContextWindowCap = 220_000;

export const defaultContextTemplate =
  "Task:\n{{task}}\n\nAttempt:\n{{attempt}}\n\nIncoming outputs:\n{{incoming_outputs}}\n\nAll outputs:\n{{all_outputs}}";
export const workflowStatusPattern = "WORKFLOW_STATUS\\s*:\\s*(PASS|FAIL|NEUTRAL)";

export const maxHistoryCharsPerMessage = 1400;
export const maxHistoryContextChars = 28_000;
export const maxHistoryCompactionChars = 8_000;
export const maxHistorySummaryLineChars = 220;
