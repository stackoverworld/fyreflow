import { nanoid } from "nanoid";
import type { PipelineLink, PipelineStep } from "./types.js";

export function createLinearLinks(steps: Array<Pick<PipelineStep, "id">>): PipelineLink[] {
  if (steps.length < 2) {
    return [];
  }

  const links: PipelineLink[] = [];

  for (let index = 0; index < steps.length - 1; index += 1) {
    links.push({
      id: nanoid(),
      sourceStepId: steps[index].id,
      targetStepId: steps[index + 1].id,
      condition: "always"
    });
  }

  return links;
}

export function normalizePipelineLinks(
  rawLinks: Array<Partial<PipelineLink> & Pick<PipelineLink, "sourceStepId" | "targetStepId">> | undefined,
  steps: PipelineStep[]
): PipelineLink[] {
  if (steps.length < 2) {
    return [];
  }

  if (!rawLinks || rawLinks.length === 0) {
    return [];
  }

  const validIds = new Set(steps.map((step) => step.id));
  const seen = new Set<string>();
  const links: PipelineLink[] = [];

  for (const link of rawLinks) {
    const condition = link.condition ?? "always";
    if (
      !link.sourceStepId ||
      !link.targetStepId ||
      link.sourceStepId === link.targetStepId ||
      !validIds.has(link.sourceStepId) ||
      !validIds.has(link.targetStepId)
    ) {
      continue;
    }

    const dedupeKey = `${link.sourceStepId}->${link.targetStepId}:${condition}`;
    if (seen.has(dedupeKey)) {
      continue;
    }

    seen.add(dedupeKey);
    links.push({
      id: link.id && link.id.length > 0 ? link.id : nanoid(),
      sourceStepId: link.sourceStepId,
      targetStepId: link.targetStepId,
      condition
    });
  }

  return links.length > 0 ? links : [];
}

export function orderPipelineSteps(steps: PipelineStep[], links: PipelineLink[]): PipelineStep[] {
  if (steps.length < 2) {
    return [...steps];
  }

  const stepById = new Map(steps.map((step) => [step.id, step]));
  const indexById = new Map(steps.map((step, index) => [step.id, index]));
  const indegree = new Map<string, number>(steps.map((step) => [step.id, 0]));
  const outgoing = new Map<string, string[]>();

  for (const link of links) {
    if (!stepById.has(link.sourceStepId) || !stepById.has(link.targetStepId)) {
      continue;
    }

    const current = outgoing.get(link.sourceStepId) ?? [];
    current.push(link.targetStepId);
    outgoing.set(link.sourceStepId, current);
    indegree.set(link.targetStepId, (indegree.get(link.targetStepId) ?? 0) + 1);
  }

  const ordered: PipelineStep[] = [];
  const visited = new Set<string>();
  const ready = steps
    .filter((step) => (indegree.get(step.id) ?? 0) === 0)
    .sort((a, b) => (indexById.get(a.id) ?? 0) - (indexById.get(b.id) ?? 0))
    .map((step) => step.id);

  while (ready.length > 0) {
    const stepId = ready.shift();
    if (!stepId || visited.has(stepId)) {
      continue;
    }

    visited.add(stepId);
    const step = stepById.get(stepId);
    if (step) {
      ordered.push(step);
    }

    const neighbors = outgoing.get(stepId) ?? [];
    for (const neighborId of neighbors) {
      const nextInDegree = (indegree.get(neighborId) ?? 0) - 1;
      indegree.set(neighborId, nextInDegree);
      if (nextInDegree <= 0 && !visited.has(neighborId)) {
        ready.push(neighborId);
      }
    }
  }

  for (const step of steps) {
    if (!visited.has(step.id)) {
      ordered.push(step);
    }
  }

  return ordered;
}
