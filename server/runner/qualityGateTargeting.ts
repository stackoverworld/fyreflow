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

export interface DeliveryCompletionGateTargetIssue {
  gateId: string;
  gateName: string;
  targetStepId: string;
  expectedStepId: string | null;
  reason: string;
}

export function validateDeliveryCompletionGateTargets(
  gates: PipelineQualityGate[],
  steps: PipelineStep[],
  links: PipelineLink[]
): DeliveryCompletionGateTargetIssue[] {
  if (gates.length === 0) {
    return [];
  }

  const expectedStepId = resolveDeliveryTargetStepId(steps, links);
  const stepIds = new Set(steps.map((step) => step.id));
  const issues: DeliveryCompletionGateTargetIssue[] = [];

  for (const gate of gates) {
    if (!isDeliveryCompletionGate(gate)) {
      continue;
    }

    const targetStepId = gate.targetStepId;
    if (targetStepId === "any_step") {
      issues.push({
        gateId: gate.id,
        gateName: gate.name,
        targetStepId,
        expectedStepId,
        reason: "Delivery completion gates must target an explicit final delivery step; any_step is not allowed."
      });
      continue;
    }

    if (!stepIds.has(targetStepId)) {
      issues.push({
        gateId: gate.id,
        gateName: gate.name,
        targetStepId,
        expectedStepId,
        reason: `Target step "${targetStepId}" is not present in the active pipeline graph.`
      });
      continue;
    }

    if (expectedStepId && targetStepId !== expectedStepId) {
      issues.push({
        gateId: gate.id,
        gateName: gate.name,
        targetStepId,
        expectedStepId,
        reason: `Target step "${targetStepId}" is not the terminal delivery step "${expectedStepId}".`
      });
      continue;
    }

    if (!expectedStepId) {
      issues.push({
        gateId: gate.id,
        gateName: gate.name,
        targetStepId,
        expectedStepId: null,
        reason: "Unable to resolve a terminal delivery step for delivery completion gate validation."
      });
    }
  }

  return issues;
}
