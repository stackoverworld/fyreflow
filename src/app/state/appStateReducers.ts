import type { Dispatch, SetStateAction } from "react";
import type { PipelinePayload } from "@/lib/types";

type DraftHistoryAction =
  | { type: "apply"; next: SetStateAction<PipelinePayload> }
  | { type: "reset"; draft: PipelinePayload }
  | { type: "undo" }
  | { type: "redo" };

export interface AppStateDraftReducers {
  applyDraftChange: (next: SetStateAction<PipelinePayload>) => void;
  resetDraftHistory: (nextDraft: PipelinePayload) => void;
  undoDraftChange: () => void;
  redoDraftChange: () => void;
}

export function createDraftHistoryReducers(dispatchDraftHistory: Dispatch<DraftHistoryAction>): AppStateDraftReducers {
  return {
    applyDraftChange: (next) => dispatchDraftHistory({ type: "apply", next }),
    resetDraftHistory: (nextDraft) => dispatchDraftHistory({ type: "reset", draft: nextDraft }),
    undoDraftChange: () => dispatchDraftHistory({ type: "undo" }),
    redoDraftChange: () => dispatchDraftHistory({ type: "redo" })
  };
}

export function withDraftEditLock(
  selectedPipelineEditLocked: boolean,
  applyChange: (next: SetStateAction<PipelinePayload>) => void,
  next: SetStateAction<PipelinePayload>
) {
  if (selectedPipelineEditLocked) {
    return;
  }

  applyChange(next);
}
