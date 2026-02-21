import { useCallback, type SetStateAction } from "react";
import type { PipelinePayload } from "@/lib/types";
import { buildApplyEditableDraftChangeCallback } from "../appStateActions";

type ApplyDraftChange = (next: SetStateAction<PipelinePayload>) => void;

export interface UseEditableDraftChangeArgs {
  applyDraftChange: ApplyDraftChange;
  selectedPipelineEditLocked: boolean;
}

export function useEditableDraftChange(args: UseEditableDraftChangeArgs): ApplyDraftChange {
  return useCallback(
    buildApplyEditableDraftChangeCallback(args.applyDraftChange, args.selectedPipelineEditLocked),
    [args.applyDraftChange, args.selectedPipelineEditLocked]
  );
}
