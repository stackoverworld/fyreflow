import type { PipelinePayload } from "@/lib/types";
import type { SetStateAction } from "react";

import { applyEditableDraftChangeAction } from "./controller/useAppStateController/dispatchers";

export function buildApplyEditableDraftChangeCallback(
  applyDraftChange: (next: SetStateAction<PipelinePayload>) => void,
  selectedPipelineEditLocked: boolean
): (next: SetStateAction<PipelinePayload>) => void {
  return (next) => {
    applyEditableDraftChangeAction(next, selectedPipelineEditLocked, applyDraftChange);
  };
}
