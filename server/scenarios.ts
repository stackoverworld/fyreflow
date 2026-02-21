import { getRunInputValue, type RunInputs } from "./runInputs.js";
import type { Pipeline, PipelineLink, PipelineStep } from "./types.js";

function normalizeScenarioToken(value: string): string {
  return value.trim().toLowerCase().replace(/[\s-]+/g, "_");
}

export function normalizeScenario(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const normalized = normalizeScenarioToken(value);
  return normalized.length > 0 ? normalized : undefined;
}

export function resolveRunScenario(
  explicitScenario: string | undefined,
  runScenario: string | undefined,
  runInputs: RunInputs | undefined
): string | undefined {
  const candidate =
    normalizeScenario(explicitScenario) ??
    normalizeScenario(runScenario) ??
    normalizeScenario(getRunInputValue(runInputs ?? {}, "scenario")) ??
    normalizeScenario(getRunInputValue(runInputs ?? {}, "run_scenario")) ??
    normalizeScenario(getRunInputValue(runInputs ?? {}, "flow_scenario"));
  return candidate;
}

function matchesScenario(step: PipelineStep, scenario: string): boolean {
  if (!Array.isArray(step.scenarios) || step.scenarios.length === 0) {
    return true;
  }

  return step.scenarios.some((tag) => normalizeScenario(tag) === scenario);
}

export function filterPipelineForScenario(
  pipeline: Pipeline,
  scenario: string | undefined
): {
  steps: PipelineStep[];
  links: PipelineLink[];
} {
  if (!scenario) {
    return {
      steps: pipeline.steps,
      links: pipeline.links
    };
  }

  const allowedStepIds = new Set(
    pipeline.steps.filter((step) => matchesScenario(step, scenario)).map((step) => step.id)
  );

  const steps = pipeline.steps.filter((step) => allowedStepIds.has(step.id));
  const links = pipeline.links.filter(
    (link) => allowedStepIds.has(link.sourceStepId) && allowedStepIds.has(link.targetStepId)
  );

  return {
    steps,
    links
  };
}
