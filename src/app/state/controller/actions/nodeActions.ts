import type { SetStateAction } from "react";
import { createDraftStep, createOrchestratorStep, connectNodes } from "@/lib/pipelineDraft";
import type { PipelinePayload } from "@/lib/types";

export function handleAddStepAction(ctx: {
  selectedPipelineEditLocked: boolean;
  applyDraftChange: (next: SetStateAction<PipelinePayload>) => void;
  setNotice: (message: string) => void;
}): void {
  if (ctx.selectedPipelineEditLocked) {
    ctx.setNotice("This flow is running. Flow settings are locked while it runs.");
    return;
  }

  ctx.applyDraftChange((current: PipelinePayload) => {
    const nextStep = createDraftStep(current.steps.length);
    const linkedSources = new Set(current.links.map((link) => link.sourceStepId));
    const anchorStep = [...current.steps].reverse().find((step) => !linkedSources.has(step.id)) ?? current.steps[current.steps.length - 1];

    if (anchorStep) {
      nextStep.position = {
        x: anchorStep.position.x + 300,
        y: anchorStep.position.y
      };
    }

    return {
      ...current,
      steps: [...current.steps, nextStep],
      links: anchorStep ? connectNodes(current.links, anchorStep.id, nextStep.id) : current.links
    };
  });

  ctx.setNotice("Step added.");
}

export function handleSpawnOrchestratorAction(ctx: {
  selectedPipelineEditLocked: boolean;
  applyDraftChange: (next: SetStateAction<PipelinePayload>) => void;
  setNotice: (message: string) => void;
}): void {
  if (ctx.selectedPipelineEditLocked) {
    ctx.setNotice("This flow is running. Flow settings are locked while it runs.");
    return;
  }

  ctx.applyDraftChange((current: PipelinePayload) => {
    if (current.steps.some((step) => step.role === "orchestrator")) {
      return current;
    }

    const nextStep = createOrchestratorStep(current.steps.length);
    nextStep.position = {
      x: 80,
      y: 60
    };

    return {
      ...current,
      steps: [nextStep, ...current.steps]
    };
  });

  ctx.setNotice("Main orchestrator spawned.");
}
