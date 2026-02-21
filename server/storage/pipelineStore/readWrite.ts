import { createLinearLinks, normalizePipelineLinks } from "../../pipelineGraph.js";
import { nanoid } from "nanoid";
import type {
  Pipeline,
  PipelineInput,
  PipelineStep
} from "../../types.js";
import type { PipelineStateContainer } from "../types.js";
import { createDefaultStep, defaultRuntimeConfig, defaultScheduleConfig } from "./contracts.js";
import { normalizeQualityGates, normalizeRuntimeConfig, normalizeScheduleConfig, normalizeStep } from "./normalization.js";

function nowIso(): string {
  return new Date().toISOString();
}

function createFallbackStep(index: number): PipelineStep {
  return createDefaultStep("analysis", "1. Analysis Bot", "openai", index);
}

export function createDefaultPipeline(now: string): Pipeline {
  const starterSteps: PipelineStep[] = [
    createDefaultStep("analysis", "1. Analysis Bot", "openai", 0),
    createDefaultStep("planner", "2. Planner Bot", "openai", 1),
    createDefaultStep("executor", "3. Executor / Orchestrator", "claude", 2),
    createDefaultStep("tester", "4. Tester Bot", "claude", 3),
    createDefaultStep("review", "5. Review Gate (You)", "openai", 4)
  ];

  return {
    id: nanoid(),
    name: "Default Multi-Agent Delivery",
    description: "Analysis -> Planner -> Executor (orchestrator) -> Tester -> Human review",
    createdAt: now,
    updatedAt: now,
    steps: starterSteps,
    links: createLinearLinks(starterSteps),
    runtime: defaultRuntimeConfig(),
    schedule: defaultScheduleConfig(),
    qualityGates: []
  };
}

export function sanitizePipelines(rawPipelines: unknown, now: string): Pipeline[] {
  const defaultPipeline = createDefaultPipeline(now);
  const inputPipelines =
    Array.isArray(rawPipelines) && rawPipelines.length > 0 ? rawPipelines : [defaultPipeline];

  return inputPipelines
    .map((pipeline) => {
      const normalizedSteps =
        Array.isArray(pipeline?.steps) && pipeline.steps.length > 0
          ? pipeline.steps.map((step: Parameters<typeof normalizeStep>[0], index: number) => normalizeStep(step, index))
          : [createFallbackStep(0)];

      return {
        id: pipeline?.id && pipeline.id.length > 0 ? pipeline.id : nanoid(),
        name: pipeline?.name || "Untitled Pipeline",
        description: pipeline?.description || "",
        createdAt: pipeline?.createdAt || now,
        updatedAt: pipeline?.updatedAt || now,
        steps: normalizedSteps,
        links: normalizePipelineLinks(pipeline?.links, normalizedSteps),
        runtime: normalizeRuntimeConfig(pipeline?.runtime),
        schedule: normalizeScheduleConfig(pipeline?.schedule),
        qualityGates: normalizeQualityGates(pipeline?.qualityGates, normalizedSteps)
      };
    });
}

export function listPipelines(state: PipelineStateContainer): Pipeline[] {
  return state.pipelines;
}

export function getPipeline(state: PipelineStateContainer, id: string): Pipeline | undefined {
  return state.pipelines.find((entry) => entry.id === id);
}

export function createPipeline(state: PipelineStateContainer, input: PipelineInput): Pipeline {
  const now = nowIso();
  const steps = input.steps.map((step, index) => normalizeStep(step, index));
  const pipeline: Pipeline = {
    id: nanoid(),
    name: input.name,
    description: input.description,
    createdAt: now,
    updatedAt: now,
    steps,
    links: normalizePipelineLinks(input.links, steps),
    runtime: normalizeRuntimeConfig(input.runtime),
    schedule: normalizeScheduleConfig(input.schedule),
    qualityGates: normalizeQualityGates(input.qualityGates, steps)
  };

  state.pipelines.unshift(pipeline);
  return pipeline;
}

export function updatePipeline(state: PipelineStateContainer, id: string, input: PipelineInput): Pipeline | undefined {
  const index = state.pipelines.findIndex((entry) => entry.id === id);
  if (index === -1) {
    return undefined;
  }

  const existing = state.pipelines[index];
  const steps = input.steps.map((step, stepIndex) => normalizeStep(step, stepIndex));
  const updated: Pipeline = {
    ...existing,
    name: input.name,
    description: input.description,
    updatedAt: nowIso(),
    steps,
    links: normalizePipelineLinks(input.links, steps),
    runtime: normalizeRuntimeConfig(input.runtime),
    schedule: normalizeScheduleConfig(input.schedule),
    qualityGates: normalizeQualityGates(input.qualityGates, steps)
  };

  state.pipelines[index] = updated;
  return updated;
}

export function deletePipeline(state: PipelineStateContainer, id: string): boolean {
  const previousCount = state.pipelines.length;
  state.pipelines = state.pipelines.filter((entry) => entry.id !== id);

  if (state.pipelines.length === previousCount) {
    return false;
  }

  return true;
}
