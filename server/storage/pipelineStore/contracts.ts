import { nanoid } from "nanoid";
import {
  resolveDefaultContextWindow,
  resolveDefaultModel
} from "../../modelCatalog.js";
import type { AgentRole, PipelineRuntimeConfig, PipelineScheduleConfig, PipelineStep, ProviderId } from "../../types.js";

export const MAX_CONTRACT_ITEMS = 40;
export const MAX_QUALITY_GATES = 80;
export const DEFAULT_STEP_X = 80;
export const DEFAULT_STEP_Y = 130;
export const DEFAULT_STEP_GAP_X = 280;
export const DEFAULT_MAX_LOOPS = 2;
export const DEFAULT_MAX_STEP_EXECUTIONS = 18;
export const DEFAULT_STAGE_TIMEOUT_MS = 420000;

const rolePromptDefaults: Record<AgentRole, string> = {
  analysis: "Analyze requirements, constraints, unknowns, and acceptance criteria. Produce a risk-aware technical brief.",
  planner: "Convert analysis into a concrete plan with milestones, dependencies, and expected outputs per milestone.",
  orchestrator:
    "Coordinate connected agents as a workflow manager. Route tasks, decide retries via pass/fail outcomes, and produce concise gate decisions.",
  executor:
    "Implement the plan in small validated increments. If delegation is enabled, partition work for subagents and consolidate outputs.",
  tester: "Validate the solution with test strategy, edge cases, regressions, and release confidence scoring.",
  review: "Review final output for quality, risks, and production readiness. Provide concise approval feedback."
};

export function defaultRuntimeConfig(): PipelineRuntimeConfig {
  return {
    maxLoops: DEFAULT_MAX_LOOPS,
    maxStepExecutions: DEFAULT_MAX_STEP_EXECUTIONS,
    stageTimeoutMs: DEFAULT_STAGE_TIMEOUT_MS
  };
}

export function defaultScheduleConfig(): PipelineScheduleConfig {
  return {
    enabled: false,
    cron: "",
    timezone: "UTC",
    task: "",
    runMode: "smart",
    inputs: {}
  };
}

export function defaultStepPosition(index: number): PipelineStep["position"] {
  return {
    x: DEFAULT_STEP_X + index * DEFAULT_STEP_GAP_X,
    y: DEFAULT_STEP_Y + (index % 2 === 0 ? 0 : 24)
  };
}

export function createDefaultStep(role: AgentRole, name: string, providerId: ProviderId, index: number): PipelineStep {
  const model = resolveDefaultModel(providerId);
  return {
    id: nanoid(),
    name,
    role,
    prompt: rolePromptDefaults[role],
    providerId,
    model,
    reasoningEffort: "medium",
    fastMode: false,
    use1MContext: false,
    contextWindowTokens: resolveDefaultContextWindow(providerId, model),
    position: defaultStepPosition(index),
    contextTemplate:
      "Task:\n{{task}}\n\nPrevious output:\n{{previous_output}}\n\nDeliverable for this step:\n- Keep concise\n- Make assumptions explicit",
    enableDelegation: role === "executor" || role === "orchestrator",
    delegationCount: role === "executor" || role === "orchestrator" ? 2 : 1,
    enableIsolatedStorage: false,
    enableSharedStorage: false,
    enabledMcpServerIds: [],
    outputFormat: "markdown",
    requiredOutputFields: [],
    requiredOutputFiles: [],
    scenarios: [],
    skipIfArtifacts: [],
    policyProfileIds: [],
    cacheBypassInputKeys: [],
    cacheBypassOrchestratorPromptPatterns: []
  };
}
