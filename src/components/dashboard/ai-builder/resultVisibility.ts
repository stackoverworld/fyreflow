import {
  isMutationAction as isSharedMutationAction,
  resolveFlowBuilderMessage as resolveSharedFlowBuilderMessage,
  type FlowBuilderDraftMetrics,
  type SharedFlowBuilderAction
} from "@shared/flowBuilder/rules";
import type { AiBuilderMode } from "@/components/dashboard/ai-builder/mode";
import type { FlowBuilderAction, PipelinePayload } from "@/lib/types";

export function shouldRevealAssistantTextDuringGeneration(requestMode: AiBuilderMode): boolean {
  return requestMode === "ask";
}

function toDraftMetrics(draft?: PipelinePayload): FlowBuilderDraftMetrics | undefined {
  if (!draft) {
    return undefined;
  }

  return {
    stepCount: draft.steps.length,
    linkCount: draft.links.length
  };
}

export function resolveDisplayedAssistantMessage(
  action: FlowBuilderAction,
  message: string,
  generatedDraft?: PipelinePayload
): string {
  return resolveSharedFlowBuilderMessage(
    action as SharedFlowBuilderAction,
    message,
    toDraftMetrics(generatedDraft)
  );
}

export function resolveCompletedAssistantMessage(
  resultAction: FlowBuilderAction,
  responseAction: FlowBuilderAction,
  message: string,
  options?: {
    appliedDraft?: PipelinePayload;
    intendedDraft?: PipelinePayload;
    mutationSuppressedByAskMode?: boolean;
  }
): string {
  const mutationAction = isSharedMutationAction(resultAction as SharedFlowBuilderAction);
  const summaryAction = mutationAction ? resultAction : responseAction;
  const summaryDraft = options?.appliedDraft ?? (mutationAction ? options?.intendedDraft : undefined);
  const displayed = resolveSharedFlowBuilderMessage(
    summaryAction as SharedFlowBuilderAction,
    message,
    toDraftMetrics(summaryDraft)
  );

  if (options?.mutationSuppressedByAskMode && mutationAction) {
    return `${displayed}\n\nAsk mode kept this response read-only; no flow changes were applied.`;
  }

  return displayed;
}

export function resolveCommittedAssistantContent(streamedContent: string, completedContent: string): string {
  return completedContent.trim().length > 0 ? completedContent : streamedContent;
}
