import type { PipelineLink, PipelineQualityGate, PipelineStep } from "../types.js";

function isDeliveryCompletionGate(gate: PipelineQualityGate): boolean {
  if (gate.kind !== "regex_must_match") {
    return false;
  }

  return /\bworkflow_status\b/i.test(gate.pattern) && /\bcomplete\b/i.test(gate.pattern);
}

function resolveDeliveryTargetStepId(steps: PipelineStep[], links: PipelineLink[]): string | null {
  if (steps.length === 0) {
    return null;
  }

  const outgoingCounts = new Map<string, number>();
  for (const step of steps) {
    outgoingCounts.set(step.id, 0);
  }
  for (const link of links) {
    outgoingCounts.set(link.sourceStepId, (outgoingCounts.get(link.sourceStepId) ?? 0) + 1);
  }

  const terminalSteps = steps.filter((step) => (outgoingCounts.get(step.id) ?? 0) === 0);
  const terminalExecutors = terminalSteps.filter((step) => step.role === "executor");
  if (terminalExecutors.length > 0) {
    return terminalExecutors[terminalExecutors.length - 1]?.id ?? null;
  }

  if (terminalSteps.length > 0) {
    return terminalSteps[terminalSteps.length - 1]?.id ?? null;
  }

  const trailingExecutor = [...steps].reverse().find((step) => step.role === "executor");
  if (trailingExecutor) {
    return trailingExecutor.id;
  }

  return steps[steps.length - 1]?.id ?? null;
}

export function retargetDeliveryCompletionGates(
  gates: PipelineQualityGate[],
  steps: PipelineStep[],
  links: PipelineLink[]
): PipelineQualityGate[] {
  if (gates.length === 0) {
    return gates;
  }

  const targetStepId = resolveDeliveryTargetStepId(steps, links);
  if (!targetStepId) {
    return gates;
  }

  let changed = false;
  const next = gates.map((gate) => {
    if (!isDeliveryCompletionGate(gate)) {
      return gate;
    }

    if (gate.targetStepId === targetStepId) {
      return gate;
    }

    changed = true;
    return {
      ...gate,
      targetStepId
    };
  });

  return changed ? next : gates;
}
