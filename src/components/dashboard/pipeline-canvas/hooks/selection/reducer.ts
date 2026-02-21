import type { Dispatch, MutableRefObject, SetStateAction } from "react";
import { cloneManualRoutePoints, manualRoutePointsEqual, pushRouteHistorySnapshot } from "../../selectionState";
import type { FlowLink, Point, RouteAdjustState } from "../../types";

type RouteHistoryRef = MutableRefObject<Record<string, Point>[]>;
type RouteHistorySnapshotRef = MutableRefObject<Record<string, Point> | null>;

export function pruneManualRoutePoints(
  manualRoutePoints: Record<string, Point>,
  links: FlowLink[]
): { points: Record<string, Point>; removed: boolean } {
  const existing = new Set(links.map((link) => link.id));
  const entries = Object.entries(manualRoutePoints).filter(([linkId]) => existing.has(linkId));
  return {
    points: entries.length === Object.keys(manualRoutePoints).length ? manualRoutePoints : Object.fromEntries(entries),
    removed: entries.length !== Object.keys(manualRoutePoints).length
  };
}

export function clearRouteHistory(
  routeUndoStackRef: RouteHistoryRef,
  routeRedoStackRef: RouteHistoryRef,
  routeAdjustStartSnapshotRef: RouteHistorySnapshotRef
): void {
  routeUndoStackRef.current = [];
  routeRedoStackRef.current = [];
  routeAdjustStartSnapshotRef.current = null;
}

export function undoManualRoutePlacement({
  manualRoutePointsRef,
  routeUndoStackRef,
  routeRedoStackRef,
  routeAdjustStartSnapshotRef,
  setManualRoutePoints,
  setRouteAdjustState
}: {
  manualRoutePointsRef: MutableRefObject<Record<string, Point>>;
  routeUndoStackRef: RouteHistoryRef;
  routeRedoStackRef: RouteHistoryRef;
  routeAdjustStartSnapshotRef: RouteHistorySnapshotRef;
  setManualRoutePoints: Dispatch<SetStateAction<Record<string, Point>>>;
  setRouteAdjustState: Dispatch<SetStateAction<RouteAdjustState | null>>;
}): boolean {
  const previous = routeUndoStackRef.current[routeUndoStackRef.current.length - 1];
  if (!previous) {
    return false;
  }

  routeUndoStackRef.current = routeUndoStackRef.current.slice(0, -1);
  routeRedoStackRef.current = pushRouteHistorySnapshot(routeRedoStackRef.current, manualRoutePointsRef.current);
  routeAdjustStartSnapshotRef.current = null;
  setRouteAdjustState(null);
  setManualRoutePoints(cloneManualRoutePoints(previous));
  return true;
}

export function redoManualRoutePlacement({
  manualRoutePointsRef,
  routeUndoStackRef,
  routeRedoStackRef,
  routeAdjustStartSnapshotRef,
  setManualRoutePoints,
  setRouteAdjustState
}: {
  manualRoutePointsRef: MutableRefObject<Record<string, Point>>;
  routeUndoStackRef: RouteHistoryRef;
  routeRedoStackRef: RouteHistoryRef;
  routeAdjustStartSnapshotRef: RouteHistorySnapshotRef;
  setManualRoutePoints: Dispatch<SetStateAction<Record<string, Point>>>;
  setRouteAdjustState: Dispatch<SetStateAction<RouteAdjustState | null>>;
}): boolean {
  const next = routeRedoStackRef.current[routeRedoStackRef.current.length - 1];
  if (!next) {
    return false;
  }

  routeRedoStackRef.current = routeRedoStackRef.current.slice(0, -1);
  routeUndoStackRef.current = pushRouteHistorySnapshot(routeUndoStackRef.current, manualRoutePointsRef.current);
  routeAdjustStartSnapshotRef.current = null;
  setRouteAdjustState(null);
  setManualRoutePoints(cloneManualRoutePoints(next));
  return true;
}

export function finalizeRouteAdjustState({
  routeAdjustStartSnapshotRef,
  manualRoutePointsRef,
  routeUndoStackRef,
  routeRedoStackRef
}: {
  routeAdjustStartSnapshotRef: RouteHistorySnapshotRef;
  manualRoutePointsRef: MutableRefObject<Record<string, Point>>;
  routeUndoStackRef: RouteHistoryRef;
  routeRedoStackRef: RouteHistoryRef;
}): void {
  const startSnapshot = routeAdjustStartSnapshotRef.current;
  if (startSnapshot && !manualRoutePointsEqual(startSnapshot, manualRoutePointsRef.current)) {
    routeUndoStackRef.current = pushRouteHistorySnapshot(routeUndoStackRef.current, startSnapshot);
    routeRedoStackRef.current = [];
  }

  routeAdjustStartSnapshotRef.current = null;
}
