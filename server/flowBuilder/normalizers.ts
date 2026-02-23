import { defaultRuntime, type FlowRuntime } from "./constants.js";

export {
  normalizeRef,
  isRecord,
  clip,
  normalizeRole,
  normalizeCondition,
  normalizeStringArray,
  normalizeAction,
  normalizeGeneratedFlow,
  normalizeFlowDecision
} from "./normalizers/common.js";

export { inferStrictQualityMode, normalizeQualityGateKind } from "./normalizers/qualityGates.js";
export { normalizeSchedule } from "./normalizers/schedule.js";

export function normalizeRuntime(runtime: Partial<FlowRuntime> | undefined): FlowRuntime {
  return {
    maxLoops:
      typeof runtime?.maxLoops === "number" ? Math.max(0, Math.min(12, Math.floor(runtime.maxLoops))) : defaultRuntime.maxLoops,
    maxStepExecutions:
      typeof runtime?.maxStepExecutions === "number"
        ? Math.max(4, Math.min(120, Math.floor(runtime.maxStepExecutions)))
        : defaultRuntime.maxStepExecutions,
    stageTimeoutMs:
      typeof runtime?.stageTimeoutMs === "number"
        ? Math.max(10_000, Math.min(18_000_000, Math.floor(runtime.stageTimeoutMs)))
        : defaultRuntime.stageTimeoutMs
  };
}
