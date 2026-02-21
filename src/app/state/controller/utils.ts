import type { MutableRefObject } from "react";

export function clearTimeoutRef(ref: MutableRefObject<number | undefined>): void {
  if (ref.current) {
    clearTimeout(ref.current);
    ref.current = undefined;
  }
}

export function setRefValue<T>(ref: MutableRefObject<T>, next: T): void {
  ref.current = next;
}

export function normalizeDraftTask(task: string): string {
  return task.trim();
}
