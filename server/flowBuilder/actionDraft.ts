import {
  buildFlowDraft,
  buildFlowDraftFromExisting
} from "./draftMapping.js";
import type {
  DraftActionResult,
  FlowBuilderAction,
  FlowBuilderRequest
} from "./contracts.js";
import type { GeneratedFlowSpec } from "./schema.js";

export function buildDraftForAction(
  action: FlowBuilderAction,
  spec: GeneratedFlowSpec,
  request: FlowBuilderRequest
): DraftActionResult {
  if (action === "answer") {
    return { action, draft: undefined, notes: [] };
  }

  if (action === "update_current_flow") {
    if (request.currentDraft) {
      return {
        action,
        draft: buildFlowDraftFromExisting(spec, request, request.currentDraft),
        notes: []
      };
    }

    return {
      action: "replace_flow",
      draft: buildFlowDraft(spec, request),
      notes: ["No current flow was loaded, so update_current_flow was treated as replace_flow."]
    };
  }

  return {
    action,
    draft: buildFlowDraft(spec, request),
    notes: []
  };
}
