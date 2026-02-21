import type { PipelineLink, PipelineStep } from "../../types.js";

export function buildGraph(
  steps: PipelineStep[],
  links: PipelineLink[]
): {
  outgoingById: Map<string, PipelineLink[]>;
  incomingById: Map<string, PipelineLink[]>;
} {
  const stepIds = new Set(steps.map((step) => step.id));
  const outgoingById = new Map<string, PipelineLink[]>();
  const incomingById = new Map<string, PipelineLink[]>();

  for (const link of links) {
    if (
      !stepIds.has(link.sourceStepId) ||
      !stepIds.has(link.targetStepId) ||
      link.sourceStepId === link.targetStepId
    ) {
      continue;
    }

    const normalized: PipelineLink = {
      ...link,
      condition: link.condition ?? "always"
    };
    const outgoing = outgoingById.get(link.sourceStepId) ?? [];
    outgoing.push(normalized);
    outgoingById.set(link.sourceStepId, outgoing);

    const incoming = incomingById.get(link.targetStepId) ?? [];
    incoming.push(normalized);
    incomingById.set(link.targetStepId, incoming);
  }

  return { outgoingById, incomingById };
}
