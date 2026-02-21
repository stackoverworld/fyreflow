import type { SetStateAction } from "react";
import type { PipelinePayload } from "@/lib/types";

const DRAFT_HISTORY_LIMIT = 120;

export interface DraftHistoryState {
  draft: PipelinePayload;
  undoStack: PipelinePayload[];
  redoStack: PipelinePayload[];
}

export type DraftHistoryAction =
  | { type: "apply"; next: SetStateAction<PipelinePayload> }
  | { type: "reset"; draft: PipelinePayload }
  | { type: "undo" }
  | { type: "redo" };

function jsonEquals(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

function withHistoryLimit(stack: PipelinePayload[], draft: PipelinePayload): PipelinePayload[] {
  if (stack.length >= DRAFT_HISTORY_LIMIT) {
    return [...stack.slice(stack.length - DRAFT_HISTORY_LIMIT + 1), draft];
  }
  return [...stack, draft];
}

function resolveNextDraft(current: PipelinePayload, next: SetStateAction<PipelinePayload>): PipelinePayload {
  if (typeof next === "function") {
    return (next as (previous: PipelinePayload) => PipelinePayload)(current);
  }
  return next;
}

export function draftHistoryReducer(state: DraftHistoryState, action: DraftHistoryAction): DraftHistoryState {
  if (action.type === "reset") {
    return {
      draft: action.draft,
      undoStack: [],
      redoStack: []
    };
  }

  if (action.type === "undo") {
    const previous = state.undoStack[state.undoStack.length - 1];
    if (!previous) {
      return state;
    }

    return {
      draft: previous,
      undoStack: state.undoStack.slice(0, -1),
      redoStack: withHistoryLimit(state.redoStack, state.draft)
    };
  }

  if (action.type === "redo") {
    const next = state.redoStack[state.redoStack.length - 1];
    if (!next) {
      return state;
    }

    return {
      draft: next,
      undoStack: withHistoryLimit(state.undoStack, state.draft),
      redoStack: state.redoStack.slice(0, -1)
    };
  }

  const nextDraft = resolveNextDraft(state.draft, action.next);
  if (jsonEquals(state.draft, nextDraft)) {
    return state;
  }

  return {
    draft: nextDraft,
    undoStack: withHistoryLimit(state.undoStack, state.draft),
    redoStack: []
  };
}
