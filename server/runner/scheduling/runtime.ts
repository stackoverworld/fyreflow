import type { Pipeline } from "../../types.js";
import type { RuntimeConfig } from "../types.js";
import {
  DEFAULT_MAX_LOOPS,
  DEFAULT_MAX_STEP_EXECUTIONS,
  DEFAULT_STAGE_TIMEOUT_MS
} from "./constants.js";

export function normalizeRuntime(pipeline: Pipeline): RuntimeConfig {
  return {
    maxLoops:
      typeof pipeline.runtime?.maxLoops === "number"
        ? Math.max(0, Math.min(12, Math.floor(pipeline.runtime.maxLoops)))
        : DEFAULT_MAX_LOOPS,
    maxStepExecutions:
      typeof pipeline.runtime?.maxStepExecutions === "number"
        ? Math.max(4, Math.min(120, Math.floor(pipeline.runtime.maxStepExecutions)))
        : DEFAULT_MAX_STEP_EXECUTIONS,
    stageTimeoutMs:
      typeof pipeline.runtime?.stageTimeoutMs === "number"
        ? Math.max(10_000, Math.min(18_000_000, Math.floor(pipeline.runtime.stageTimeoutMs)))
        : DEFAULT_STAGE_TIMEOUT_MS
  };
}
