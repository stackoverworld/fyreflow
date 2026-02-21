import { nanoid } from "nanoid";
import { normalizeRunInputs, type RunInputs } from "../runInputs.js";
import { orderPipelineSteps } from "../pipelineGraph.js";
import { filterPipelineForScenario, normalizeScenario, resolveRunScenario } from "../scenarios.js";
import type {
  Pipeline,
  PipelineRun,
  RunApproval,
  RunStatus,
  StepQualityGateResult,
  StepRun
} from "../types.js";
import type { RunStateContainer } from "./types.js";

const MAX_RUN_APPROVALS = 300;
const MAX_STEP_GATE_RESULTS = 200;

function nowIso(): string {
  return new Date().toISOString();
}

function normalizeRunStatus(status: unknown): RunStatus {
  return status === "queued" ||
    status === "running" ||
    status === "paused" ||
    status === "awaiting_approval" ||
    status === "completed" ||
    status === "failed" ||
    status === "cancelled"
    ? status
    : "failed";
}

export function normalizeRunApprovals(raw: unknown): RunApproval[] {
  if (!Array.isArray(raw)) {
    return [];
  }

  return raw
    .map((entry) => {
      if (typeof entry !== "object" || entry === null) {
        return null;
      }

      const item = entry as Partial<RunApproval>;
      const status =
        item.status === "pending" || item.status === "approved" || item.status === "rejected"
          ? item.status
          : "pending";
      const gateId = typeof item.gateId === "string" ? item.gateId.trim() : "";
      const stepId = typeof item.stepId === "string" ? item.stepId.trim() : "";

      if (gateId.length === 0 || stepId.length === 0) {
        return null;
      }

      const normalized: RunApproval = {
        id: typeof item.id === "string" && item.id.trim().length > 0 ? item.id.trim() : `${gateId}:${stepId}`,
        gateId,
        gateName: typeof item.gateName === "string" && item.gateName.trim().length > 0 ? item.gateName.trim() : "Manual approval",
        stepId,
        stepName: typeof item.stepName === "string" ? item.stepName : stepId,
        status,
        blocking: item.blocking !== false,
        message: typeof item.message === "string" ? item.message : "",
        requestedAt: typeof item.requestedAt === "string" && item.requestedAt.length > 0 ? item.requestedAt : nowIso()
      };

      if (typeof item.resolvedAt === "string" && item.resolvedAt.length > 0) {
        normalized.resolvedAt = item.resolvedAt;
      }

      if (typeof item.note === "string" && item.note.trim().length > 0) {
        normalized.note = item.note.trim();
      }

      return normalized;
    })
    .filter((entry): entry is RunApproval => entry !== null)
    .slice(0, MAX_RUN_APPROVALS);
}

function normalizeStepQualityGateResults(raw: unknown): StepQualityGateResult[] {
  if (!Array.isArray(raw)) {
    return [];
  }

  return raw
    .map((entry) => {
      if (typeof entry !== "object" || entry === null) {
        return null;
      }

      const item = entry as Partial<StepQualityGateResult>;
      const kind =
        item.kind === "step_contract" ||
        item.kind === "regex_must_match" ||
        item.kind === "regex_must_not_match" ||
        item.kind === "json_field_exists" ||
        item.kind === "artifact_exists" ||
        item.kind === "manual_approval"
          ? item.kind
          : "step_contract";

      const status = item.status === "pass" || item.status === "fail" ? item.status : "fail";

      return {
        gateId: typeof item.gateId === "string" && item.gateId.trim().length > 0 ? item.gateId : nanoid(),
        gateName: typeof item.gateName === "string" && item.gateName.trim().length > 0 ? item.gateName : "Quality gate",
        kind,
        status,
        blocking: item.blocking !== false,
        message: typeof item.message === "string" ? item.message : "",
        details: typeof item.details === "string" ? item.details : ""
      } satisfies StepQualityGateResult;
    })
    .filter((entry): entry is StepQualityGateResult => entry !== null)
    .slice(0, MAX_STEP_GATE_RESULTS);
}

export function normalizeRuns(rawRuns: unknown): PipelineRun[] {
  if (!Array.isArray(rawRuns)) {
    return [];
  }

  return rawRuns
    .map((run) => ({
      ...run,
      scenario: normalizeScenario((run as { scenario?: unknown }).scenario),
      status: normalizeRunStatus((run as { status?: unknown }).status),
      inputs: typeof (run as { inputs?: unknown })?.inputs === "object" && (run as { inputs?: unknown }).inputs !== null ? normalizeRunInputs((run as { inputs?: unknown }).inputs) : {},
      logs: Array.isArray((run as { logs?: unknown }).logs) ? (run as { logs: string[] }).logs : [],
      approvals: normalizeRunApprovals((run as { approvals?: unknown }).approvals),
      steps: Array.isArray((run as { steps?: unknown }).steps)
        ? ((run as { steps: Array<{ [key: string]: unknown }> }).steps.map((step) => ({
            ...(step as object),
            attempts: typeof step.attempts === "number" ? step.attempts : 0,
            workflowOutcome:
              step.workflowOutcome === "pass" || step.workflowOutcome === "fail" || step.workflowOutcome === "neutral"
                ? step.workflowOutcome
                : "neutral",
            subagentNotes: Array.isArray(step.subagentNotes) ? step.subagentNotes : [],
            qualityGateResults: normalizeStepQualityGateResults(step.qualityGateResults)
          })))
        : []
    }))
    .slice(0, 80);
}

export function createRun(
  state: RunStateContainer,
  pipeline: Pipeline,
  task: string,
  rawInputs?: RunInputs,
  scenarioInput?: string
): PipelineRun {
  const inputs = normalizeRunInputs(rawInputs);
  const scenario = resolveRunScenario(scenarioInput, undefined, inputs);
  const scopedPipeline = filterPipelineForScenario(pipeline, scenario);
  const orderedSteps = orderPipelineSteps(scopedPipeline.steps, scopedPipeline.links);
  const run: PipelineRun = {
    id: nanoid(),
    pipelineId: pipeline.id,
    pipelineName: pipeline.name,
    task,
    inputs,
    ...(scenario ? { scenario } : {}),
    status: "queued",
    startedAt: nowIso(),
    logs: ["Run queued"],
    approvals: [],
    steps: orderedSteps.map<StepRun>((step) => ({
      stepId: step.id,
      stepName: step.name,
      role: step.role,
      status: "pending",
      attempts: 0,
      workflowOutcome: "neutral",
      inputContext: "",
      output: "",
      subagentNotes: [],
      qualityGateResults: []
    }))
  };

  state.runs.unshift(run);
  state.runs = state.runs.slice(0, 80);
  return run;
}

export function getRun(state: RunStateContainer, runId: string): PipelineRun | undefined {
  return state.runs.find((entry) => entry.id === runId);
}

export function updateRun(
  state: RunStateContainer,
  runId: string,
  updater: (run: PipelineRun) => PipelineRun
): PipelineRun | undefined {
  const index = state.runs.findIndex((entry) => entry.id === runId);
  if (index === -1) {
    return undefined;
  }

  state.runs[index] = updater(state.runs[index]);
  return state.runs[index];
}

export function listRuns(state: RunStateContainer, limit = 30): PipelineRun[] {
  return state.runs.slice(0, limit);
}
