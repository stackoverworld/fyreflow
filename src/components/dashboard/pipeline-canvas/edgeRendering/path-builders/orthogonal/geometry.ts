import type { AnchorSide, CanonicalRouteCandidate, FlowNode, OrchestratorLaneMeta, Point, Rect, ReciprocalLaneMeta } from "../../../types";
import { NODE_HEIGHT, nodeSourceAnchorRect, nodeTargetAnchorRect } from "../../../useNodeLayout";
import {
  ANCHOR_SIDES,
  anchorDirection,
  sideTowardPoint,
  sidePairAllowed,
  uniqueNumbers,
  uniquePoints,
  sideFacingCoordinateAnchor,
  snapManualWaypointAxis,
  stabilizeManualLane
} from "../geometry";
import {
  anchorPoint,
  rectCenter,
  sideCenterPoint,
  sideDistributedPoint
} from "../../geometry";
import { ANCHOR_LEAD } from "../../styles";
import {
  CANONICAL_APPROACH_DISTANCE,
  CANONICAL_LANE_TOWARD_SOURCE_RATIO,
  CANONICAL_LANE_TOWARD_TARGET_RATIO,
  FALLBACK_LANE_OFFSET_BASE,
  FALLBACK_LANE_OFFSET_STEP,
  ORCHESTRATOR_BUS_BASE_DISTANCE,
  ORCHESTRATOR_BUS_SIDE_SPREAD,
  RECIPROCAL_APPROACH_LEG
} from "./constants";

interface ManualWaypointCandidateSetPoints {
  sourceSide: AnchorSide;
  targetSide: AnchorSide;
  routes: Point[][];
  stabilizedWaypoint: Point;
}

interface FallbackRouteCandidatePoint {
  sourceSide: AnchorSide;
  targetSide: AnchorSide;
  route: Point[];
}

const FALLBACK_OBSTACLE_LANE_CLEARANCE = 30;
const FALLBACK_OBSTACLE_LANE_LIMIT = 6;

function nearestLaneCandidates(base: number, rawCandidates: number[]): number[] {
  return uniqueNumbers(rawCandidates)
    .sort((left, right) => Math.abs(left - base) - Math.abs(right - base))
    .slice(0, FALLBACK_OBSTACLE_LANE_LIMIT);
}

function canonicalLaneOffset(edgeIndex: number): number {
  const direction = edgeIndex % 2 === 0 ? -1 : 1;
  const magnitude = FALLBACK_LANE_OFFSET_BASE * 2 + (edgeIndex % 5) * FALLBACK_LANE_OFFSET_STEP * 2;
  return direction * magnitude;
}

export function buildOrchestratorBusRoutePoints(
  sourceNode: FlowNode,
  targetNode: FlowNode,
  orchestratorLane: OrchestratorLaneMeta
): Point[] | null {
  const orchestratorNode = sourceNode.id === orchestratorLane.orchestratorId
    ? sourceNode
    : targetNode.id === orchestratorLane.orchestratorId
      ? targetNode
      : null;
  if (!orchestratorNode) {
    return null;
  }

  const otherNode = orchestratorNode.id === sourceNode.id ? targetNode : sourceNode;
  const outgoing = orchestratorNode.id === sourceNode.id;
  const orchestratorRect = outgoing
    ? nodeSourceAnchorRect(orchestratorNode)
    : nodeTargetAnchorRect(orchestratorNode);
  const otherRect = outgoing
    ? nodeTargetAnchorRect(otherNode)
    : nodeSourceAnchorRect(otherNode);
  const side = orchestratorLane.side;
  const spread = (orchestratorLane.index - (orchestratorLane.count - 1) / 2) * ORCHESTRATOR_BUS_SIDE_SPREAD;
  const orchestratorAnchor = sideDistributedPoint(orchestratorRect, side, orchestratorLane.index, orchestratorLane.count);
  const otherCenter = rectCenter(otherRect);

  if (side === "left" || side === "right") {
    const busX = side === "right"
      ? orchestratorRect.right + ORCHESTRATOR_BUS_BASE_DISTANCE + spread
      : orchestratorRect.left - ORCHESTRATOR_BUS_BASE_DISTANCE - spread;
    const otherSide: AnchorSide = busX >= otherCenter.x ? "right" : "left";
    const otherAnchor = sideFacingCoordinateAnchor(otherRect, otherSide);
    return outgoing
      ? [
        orchestratorAnchor,
        { x: busX, y: orchestratorAnchor.y },
        { x: busX, y: otherAnchor.y },
        otherAnchor
      ]
      : [
        otherAnchor,
        { x: busX, y: otherAnchor.y },
        { x: busX, y: orchestratorAnchor.y },
        orchestratorAnchor
      ];
  }

  const busY = side === "bottom"
    ? orchestratorRect.bottom + ORCHESTRATOR_BUS_BASE_DISTANCE + spread
    : orchestratorRect.top - ORCHESTRATOR_BUS_BASE_DISTANCE - spread;
  const otherSide: AnchorSide = busY >= otherCenter.y ? "bottom" : "top";
  const otherAnchor = sideFacingCoordinateAnchor(otherRect, otherSide);
  return outgoing
    ? [
      orchestratorAnchor,
      { x: orchestratorAnchor.x, y: busY },
      { x: otherAnchor.x, y: busY },
      otherAnchor
    ]
    : [
      otherAnchor,
      { x: otherAnchor.x, y: busY },
      { x: orchestratorAnchor.x, y: busY },
      orchestratorAnchor
    ];
}

export function buildReciprocalPairRoutePoints(
  sourceNode: FlowNode,
  targetNode: FlowNode,
  reciprocalLane: ReciprocalLaneMeta
): Point[] {
  const sourceRect = nodeSourceAnchorRect(sourceNode);
  const targetRect = nodeTargetAnchorRect(targetNode);
  const sourceCenter = rectCenter(sourceRect);
  const targetCenter = rectCenter(targetRect);
  const dx = targetCenter.x - sourceCenter.x;
  const dy = targetCenter.y - sourceCenter.y;
  const sourceLaneIndex = reciprocalLane.sourceIndex ?? 0;
  const sourceLaneCount = reciprocalLane.sourceCount ?? 1;
  const targetLaneIndex = reciprocalLane.targetIndex ?? 0;
  const targetLaneCount = reciprocalLane.targetCount ?? 1;
  const laneSign = reciprocalLane.offset >= 0 ? 1 : -1;

  const enforceLaneClearance = (value: number, a: number, b: number): number => {
    const minGap = 24;
    if (laneSign > 0) {
      return Math.round(Math.max(value, Math.max(a, b) + minGap));
    }
    return Math.round(Math.min(value, Math.min(a, b) - minGap));
  };

  if (Math.abs(dx) >= Math.abs(dy)) {
    const sourceSide: AnchorSide = dx >= 0 ? "right" : "left";
    const targetSide: AnchorSide = dx >= 0 ? "left" : "right";
    const start = sideDistributedPoint(sourceRect, sourceSide, sourceLaneIndex, sourceLaneCount);
    const end = sideDistributedPoint(targetRect, targetSide, targetLaneIndex, targetLaneCount);
    const dir = dx >= 0 ? 1 : -1;
    const maxLeg = Math.max(ANCHOR_LEAD + 6, Math.floor(Math.abs(end.x - start.x) / 2) - 6);
    const leg = Math.min(Math.max(CANONICAL_APPROACH_DISTANCE, RECIPROCAL_APPROACH_LEG), maxLeg);
    const laneY = enforceLaneClearance((start.y + end.y) / 2 + reciprocalLane.offset, start.y, end.y);

    return [
      start,
      { x: start.x + dir * leg, y: start.y },
      { x: start.x + dir * leg, y: laneY },
      { x: end.x - dir * leg, y: laneY },
      { x: end.x - dir * leg, y: end.y },
      end
    ];
  }

  const sourceSide: AnchorSide = dy >= 0 ? "bottom" : "top";
  const targetSide: AnchorSide = dy >= 0 ? "top" : "bottom";
  const start = sideDistributedPoint(sourceRect, sourceSide, sourceLaneIndex, sourceLaneCount);
  const end = sideDistributedPoint(targetRect, targetSide, targetLaneIndex, targetLaneCount);
  const dir = dy >= 0 ? 1 : -1;
  const maxLeg = Math.max(ANCHOR_LEAD + 6, Math.floor(Math.abs(end.y - start.y) / 2) - 6);
  const leg = Math.min(Math.max(CANONICAL_APPROACH_DISTANCE, RECIPROCAL_APPROACH_LEG), maxLeg);
  const laneX = enforceLaneClearance((start.x + end.x) / 2 + reciprocalLane.offset, start.x, end.x);

  return [
    start,
    { x: start.x, y: start.y + dir * leg },
    { x: laneX, y: start.y + dir * leg },
    { x: laneX, y: end.y - dir * leg },
    { x: end.x, y: end.y - dir * leg },
    end
  ];
}

export function buildManualWaypointRouteCandidatePoints(
  sourceNode: FlowNode,
  targetNode: FlowNode,
  manualWaypoint: Point
): ManualWaypointCandidateSetPoints {
  const sourceRect = nodeSourceAnchorRect(sourceNode);
  const targetRect = nodeTargetAnchorRect(targetNode);
  const sourceSide = sideTowardPoint(sourceRect, manualWaypoint);
  const targetSide = sideTowardPoint(targetRect, manualWaypoint);
  const start = anchorPoint(sourceRect, sourceSide, manualWaypoint);
  const end = anchorPoint(targetRect, targetSide, manualWaypoint);
  const sourceDir = anchorDirection(sourceSide);
  const targetDir = anchorDirection(targetSide);
  const snappedWaypoint = snapManualWaypointAxis(manualWaypoint, start, end);
  const startLead: Point = {
    x: start.x + sourceDir.x * ANCHOR_LEAD,
    y: start.y + sourceDir.y * ANCHOR_LEAD
  };
  const endLead: Point = {
    x: end.x + targetDir.x * ANCHOR_LEAD,
    y: end.y + targetDir.y * ANCHOR_LEAD
  };
  const stabilizedWaypoint: Point = {
    x: Math.round(stabilizeManualLane(snappedWaypoint.x, startLead.x, endLead.x)),
    y: Math.round(stabilizeManualLane(snappedWaypoint.y, startLead.y, endLead.y))
  };
  const verticalDominant = Math.abs(endLead.y - startLead.y) >= Math.abs(endLead.x - startLead.x);
  const laneXCandidates = uniqueNumbers([
    stabilizedWaypoint.x,
    (startLead.x + endLead.x) / 2,
    startLead.x,
    endLead.x
  ]).map((laneX) => Math.round(stabilizeManualLane(laneX, startLead.x, endLead.x)));
  const laneYCandidates = uniqueNumbers([
    stabilizedWaypoint.y,
    (startLead.y + endLead.y) / 2,
    startLead.y,
    endLead.y
  ]).map((laneY) => Math.round(stabilizeManualLane(laneY, startLead.y, endLead.y)));
  const routes: Point[][] = [];

  for (const laneX of laneXCandidates) {
    routes.push([
      start,
      startLead,
      { x: laneX, y: startLead.y },
      { x: laneX, y: endLead.y },
      endLead,
      end
    ]);
  }

  for (const laneY of laneYCandidates) {
    routes.push([
      start,
      startLead,
      { x: startLead.x, y: laneY },
      { x: endLead.x, y: laneY },
      endLead,
      end
    ]);
  }

  if (verticalDominant) {
    routes.push([
      start,
      startLead,
      { x: stabilizedWaypoint.x, y: startLead.y },
      { x: stabilizedWaypoint.x, y: endLead.y },
      endLead,
      end
    ]);
  } else {
    routes.push([
      start,
      startLead,
      { x: startLead.x, y: stabilizedWaypoint.y },
      { x: endLead.x, y: stabilizedWaypoint.y },
      endLead,
      end
    ]);
  }

  routes.push([start, startLead, endLead, end]);

  return {
    sourceSide,
    targetSide,
    routes,
    stabilizedWaypoint
  };
}

export function buildFallbackRouteCandidatePoints(
  sourceRect: Rect,
  targetRect: Rect,
  sourceCenter: Point,
  targetCenter: Point,
  edgeIndex: number,
  obstacles: Rect[]
): FallbackRouteCandidatePoint[] {
  const candidates: FallbackRouteCandidatePoint[] = [];
  const globalBypassLaneXs =
    obstacles.length > 0
      ? [
        Math.min(...obstacles.map((obstacle) => obstacle.left)) - FALLBACK_OBSTACLE_LANE_CLEARANCE * 2,
        Math.max(...obstacles.map((obstacle) => obstacle.right)) + FALLBACK_OBSTACLE_LANE_CLEARANCE * 2
      ]
      : [];
  const globalBypassLaneYs =
    obstacles.length > 0
      ? [
        Math.min(...obstacles.map((obstacle) => obstacle.top)) - FALLBACK_OBSTACLE_LANE_CLEARANCE * 2,
        Math.max(...obstacles.map((obstacle) => obstacle.bottom)) + FALLBACK_OBSTACLE_LANE_CLEARANCE * 2
      ]
      : [];
  const obstacleLaneXs = obstacles.flatMap((obstacle) => [
    obstacle.left - FALLBACK_OBSTACLE_LANE_CLEARANCE,
    obstacle.right + FALLBACK_OBSTACLE_LANE_CLEARANCE
  ]);
  const obstacleLaneYs = obstacles.flatMap((obstacle) => [
    obstacle.top - FALLBACK_OBSTACLE_LANE_CLEARANCE,
    obstacle.bottom + FALLBACK_OBSTACLE_LANE_CLEARANCE
  ]);

  for (const sourceSide of ANCHOR_SIDES) {
    for (const targetSide of ANCHOR_SIDES) {
      if (!sidePairAllowed(sourceRect, targetRect, sourceSide, targetSide)) {
        continue;
      }

      const sourceDirection = anchorDirection(sourceSide);
      const targetDirection = anchorDirection(targetSide);
      const sourceCenterAnchor = sideCenterPoint(sourceRect, sourceSide);
      const targetCenterAnchor = sideCenterPoint(targetRect, targetSide);
      const sourceAdaptiveAnchor = anchorPoint(sourceRect, sourceSide, targetCenter);
      const targetAdaptiveAnchor = anchorPoint(targetRect, targetSide, sourceCenter);
      const sourceAnchors = uniquePoints([sourceCenterAnchor, sourceAdaptiveAnchor]);
      const targetAnchors = uniquePoints([targetCenterAnchor, targetAdaptiveAnchor]);
      const laneOffset = (edgeIndex % 2 === 0 ? -1 : 1) * (FALLBACK_LANE_OFFSET_BASE + (edgeIndex % 3) * FALLBACK_LANE_OFFSET_STEP);

      for (const start of sourceAnchors) {
        for (const end of targetAnchors) {
          const startLead: Point = {
            x: start.x + sourceDirection.x * ANCHOR_LEAD,
            y: start.y + sourceDirection.y * ANCHOR_LEAD
          };
          const endLead: Point = {
            x: end.x + targetDirection.x * ANCHOR_LEAD,
            y: end.y + targetDirection.y * ANCHOR_LEAD
          };
          const midX = (startLead.x + endLead.x) / 2 + laneOffset;
          const midY = (startLead.y + endLead.y) / 2 + laneOffset;
          const laneXCandidates = uniqueNumbers([
            midX,
            ...globalBypassLaneXs,
            ...nearestLaneCandidates(midX, obstacleLaneXs)
          ]);
          const laneYCandidates = uniqueNumbers([
            midY,
            ...globalBypassLaneYs,
            ...nearestLaneCandidates(midY, obstacleLaneYs)
          ]);

          const candidateRoutes: Point[][] = [
            [start, startLead, { x: endLead.x, y: startLead.y }, endLead, end],
            [start, startLead, { x: startLead.x, y: endLead.y }, endLead, end]
          ];

          for (const laneX of laneXCandidates) {
            candidateRoutes.push([
              start,
              startLead,
              { x: laneX, y: startLead.y },
              { x: laneX, y: endLead.y },
              endLead,
              end
            ]);
          }

          for (const laneY of laneYCandidates) {
            candidateRoutes.push([
              start,
              startLead,
              { x: startLead.x, y: laneY },
              { x: endLead.x, y: laneY },
              endLead,
              end
            ]);
          }

          for (const candidateRoute of candidateRoutes) {
            candidates.push({
              sourceSide,
              targetSide,
              route: candidateRoute
            });
          }
        }
      }
    }
  }

  return candidates;
}

export function buildDefaultFallbackRoutePoints(sourceRect: Rect, targetRect: Rect): Point[] {
  return [
    sideCenterPoint(sourceRect, "right"),
    {
      x: sourceRect.right + NODE_HEIGHT,
      y: sourceRect.top + NODE_HEIGHT / 2
    },
    {
      x: targetRect.left - NODE_HEIGHT,
      y: targetRect.top + NODE_HEIGHT / 2
    },
    sideCenterPoint(targetRect, "left")
  ];
}

export function buildCanonicalRouteCandidatePoints(
  sourceRect: Rect,
  targetRect: Rect,
  edgeIndex: number
): CanonicalRouteCandidate[] {
  return [
    ...buildHorizontalCanonicalRouteCandidates(sourceRect, targetRect, edgeIndex),
    ...buildVerticalCanonicalRouteCandidates(sourceRect, targetRect, edgeIndex)
  ];
}

function buildHorizontalCanonicalRouteCandidates(
  sourceRect: Rect,
  targetRect: Rect,
  edgeIndex: number
): CanonicalRouteCandidate[] {
  const sourceCenter = rectCenter(sourceRect);
  const targetCenter = rectCenter(targetRect);
  const dx = targetCenter.x - sourceCenter.x;
  const sourceSide: AnchorSide = dx >= 0 ? "right" : "left";
  const targetSide: AnchorSide = dx >= 0 ? "left" : "right";
  const start = sideCenterPoint(sourceRect, sourceSide);
  const end = sideCenterPoint(targetRect, targetSide);
  const candidates: CanonicalRouteCandidate[] = [];

  const direct = [
    start,
    end
  ];
  if (start.y === end.y) {
    candidates.push({
      axis: "horizontal",
      route: direct,
      sourceSide,
      targetSide
    });
  }

  const minLane = Math.min(start.x, end.x) + CANONICAL_APPROACH_DISTANCE;
  const maxLane = Math.max(start.x, end.x) - CANONICAL_APPROACH_DISTANCE;
  const laneRangeValid = minLane <= maxLane;
  const centerLane = (start.x + end.x) / 2;
  const towardSourceLane = start.x + (end.x - start.x) * CANONICAL_LANE_TOWARD_SOURCE_RATIO;
  const towardTargetLane = start.x + (end.x - start.x) * CANONICAL_LANE_TOWARD_TARGET_RATIO;
  const laneOffset = canonicalLaneOffset(edgeIndex);
  const laneCandidates = laneRangeValid
    ? uniqueNumbers([
      Math.min(maxLane, Math.max(minLane, centerLane)),
      Math.min(maxLane, Math.max(minLane, towardSourceLane)),
      Math.min(maxLane, Math.max(minLane, towardTargetLane)),
      Math.min(maxLane, Math.max(minLane, centerLane + laneOffset)),
      Math.min(maxLane, Math.max(minLane, centerLane - laneOffset))
    ])
    : uniqueNumbers([
      centerLane,
      centerLane + laneOffset,
      centerLane - laneOffset
    ]);

  for (const laneX of laneCandidates) {
    candidates.push({
      axis: "horizontal",
      route: [
        start,
        { x: laneX, y: start.y },
        { x: laneX, y: end.y },
        end
      ],
      sourceSide,
      targetSide
    });
  }

  return candidates;
}

function buildVerticalCanonicalRouteCandidates(
  sourceRect: Rect,
  targetRect: Rect,
  edgeIndex: number
): CanonicalRouteCandidate[] {
  const sourceCenter = rectCenter(sourceRect);
  const targetCenter = rectCenter(targetRect);
  const dy = targetCenter.y - sourceCenter.y;
  const sourceSide: AnchorSide = dy >= 0 ? "bottom" : "top";
  const targetSide: AnchorSide = dy >= 0 ? "top" : "bottom";
  const start = sideCenterPoint(sourceRect, sourceSide);
  const end = sideCenterPoint(targetRect, targetSide);
  const candidates: CanonicalRouteCandidate[] = [];

  const direct = [
    start,
    end
  ];
  if (start.x === end.x) {
    candidates.push({
      axis: "vertical",
      route: direct,
      sourceSide,
      targetSide
    });
  }

  const minLane = Math.min(start.y, end.y) + CANONICAL_APPROACH_DISTANCE;
  const maxLane = Math.max(start.y, end.y) - CANONICAL_APPROACH_DISTANCE;
  const laneRangeValid = minLane <= maxLane;
  const centerLane = (start.y + end.y) / 2;
  const towardSourceLane = start.y + (end.y - start.y) * CANONICAL_LANE_TOWARD_SOURCE_RATIO;
  const towardTargetLane = start.y + (end.y - start.y) * CANONICAL_LANE_TOWARD_TARGET_RATIO;
  const laneOffset = canonicalLaneOffset(edgeIndex);
  const laneCandidates = laneRangeValid
    ? uniqueNumbers([
      Math.min(maxLane, Math.max(minLane, centerLane)),
      Math.min(maxLane, Math.max(minLane, towardSourceLane)),
      Math.min(maxLane, Math.max(minLane, towardTargetLane)),
      Math.min(maxLane, Math.max(minLane, centerLane + laneOffset)),
      Math.min(maxLane, Math.max(minLane, centerLane - laneOffset))
    ])
    : uniqueNumbers([
      centerLane,
      centerLane + laneOffset,
      centerLane - laneOffset
    ]);

  for (const laneY of laneCandidates) {
    candidates.push({
      axis: "vertical",
      route: [
        start,
        { x: start.x, y: laneY },
        { x: end.x, y: laneY },
        end
      ],
      sourceSide,
      targetSide
    });
  }

  return candidates;
}
