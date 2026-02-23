import { getRunInputValue, normalizeRunInputKey, type RunInputs } from "../runInputs.js";
import type { PipelineStep } from "../types.js";
import {
  resolveCacheBypassInputKeysForStep,
  resolveCacheBypassOrchestratorPromptPatternsForStep
} from "./policyProfiles.js";

const STEP_ALWAYS_RUN_PATTERN =
  /\bruns?\s+every\s+time\b|\balways\s+regardless\b|\bregardless\s+of\s+whether\b|\bmust\s+run\s+always\b|\bno\s+cache\b|\bdisable\s+cache\b/i;

export type SkipIfArtifactsBypassReason =
  | "run_input_cache_bypass"
  | "step_prompt_always_run"
  | "step_cache_bypass_input_key"
  | "step_orchestrator_prompt_pattern";

function hasStrictAlwaysRunInstruction(text: string | undefined): boolean {
  if (!text || text.trim().length === 0) {
    return false;
  }
  return STEP_ALWAYS_RUN_PATTERN.test(text);
}

function toBooleanLike(value: string | undefined): boolean | null {
  if (!value || value.trim().length === 0) {
    return null;
  }

  const normalized = value.trim().toLowerCase();
  if (["1", "true", "yes", "on", "enabled"].includes(normalized)) {
    return true;
  }
  if (["0", "false", "no", "off", "disabled"].includes(normalized)) {
    return false;
  }
  return null;
}

function readInputBool(runInputs: RunInputs, key: string): boolean | null {
  return toBooleanLike(getRunInputValue(runInputs, key));
}

function isCacheBypassRequested(runInputs: RunInputs): boolean {
  const forceRebuild = readInputBool(runInputs, "force_rebuild");
  if (forceRebuild === true) {
    return true;
  }

  const disableCacheKeys = ["no_cache", "disable_cache", "ignore_cache", "fresh_run", "rebuild"];
  for (const key of disableCacheKeys) {
    if (readInputBool(runInputs, key) === true) {
      return true;
    }
  }

  const cacheMode = (getRunInputValue(runInputs, "cache_mode") ?? "").trim().toLowerCase();
  if (["off", "disabled", "none", "fresh"].includes(cacheMode)) {
    return true;
  }

  if (readInputBool(runInputs, "use_cache") === false) {
    return true;
  }

  return false;
}

function isStepSpecificCacheBypassRequested(step: PipelineStep, runInputs: RunInputs): boolean {
  const configuredKeys = resolveCacheBypassInputKeysForStep(step);
  if (configuredKeys.length === 0) {
    return false;
  }

  return configuredKeys.some((key) => readInputBool(runInputs, normalizeRunInputKey(key)) === true);
}

function compilePattern(pattern: string): RegExp | null {
  const trimmed = pattern.trim();
  if (trimmed.length === 0) {
    return null;
  }

  if (trimmed.startsWith("/") && trimmed.lastIndexOf("/") > 0) {
    const lastSlash = trimmed.lastIndexOf("/");
    const body = trimmed.slice(1, lastSlash);
    const flags = trimmed.slice(lastSlash + 1);
    try {
      return new RegExp(body, flags.length > 0 ? flags : "i");
    } catch {
      return null;
    }
  }

  try {
    return new RegExp(trimmed, "i");
  } catch {
    return null;
  }
}

function isOrchestratorPatternBypassRequested(step: PipelineStep, orchestratorPrompt?: string): boolean {
  if (!orchestratorPrompt || step.role === "orchestrator") {
    return false;
  }

  const patterns = resolveCacheBypassOrchestratorPromptPatternsForStep(step);
  if (patterns.length === 0) {
    return false;
  }

  return patterns.some((pattern) => {
    const regex = compilePattern(pattern);
    return regex ? regex.test(orchestratorPrompt) : false;
  });
}

export function resolveSkipIfArtifactsBypassReason(
  step: PipelineStep,
  runInputs: RunInputs,
  orchestratorPrompt?: string
): SkipIfArtifactsBypassReason | null {
  if (isCacheBypassRequested(runInputs)) {
    return "run_input_cache_bypass";
  }

  if (isStepSpecificCacheBypassRequested(step, runInputs)) {
    return "step_cache_bypass_input_key";
  }

  if (hasStrictAlwaysRunInstruction(step.prompt)) {
    return "step_prompt_always_run";
  }

  if (isOrchestratorPatternBypassRequested(step, orchestratorPrompt)) {
    return "step_orchestrator_prompt_pattern";
  }

  return null;
}

export function shouldBypassSkipIfArtifacts(
  step: PipelineStep,
  runInputs: RunInputs,
  orchestratorPrompt?: string
): boolean {
  return resolveSkipIfArtifactsBypassReason(step, runInputs, orchestratorPrompt) !== null;
}
