import { EDGE_SHIMMER_LAYERS, HIGHLIGHT_HALO_STROKE_WIDTH } from "./edgeLayerSelectors";
import type { EdgeRenderData } from "./useEdgeRenderData";

export interface EdgePathGroupProps {
  data: EdgeRenderData;
  opacityMultiplier?: number;
}

const EDGE_OPACITY_TRANSITION = "opacity 240ms cubic-bezier(0.16, 1, 0.3, 1)";
const DASH_CORNER_BOUNDARY_GUARD = 1.25;
const DASH_TERMINAL_MIN_VISIBLE = 3;
const DASH_CORNER_IN_DASH_PENALTY = 18;

interface DashPhaseInfo {
  inDash: boolean;
  distanceToBoundary: number;
  segmentStart: number;
  segmentEnd: number;
}

function parseDashPattern(dasharray: string | null): number[] {
  if (!dasharray) {
    return [];
  }

  const parsed = dasharray
    .split(/[\s,]+/)
    .map((value) => Number(value))
    .filter((value) => Number.isFinite(value) && value > 0);

  if (parsed.length === 0) {
    return parsed;
  }

  // SVG repeats odd-length dash arrays to make an even on/off sequence.
  return parsed.length % 2 === 0 ? parsed : [...parsed, ...parsed];
}

function phaseAtDistance(distance: number, offset: number, cycle: number): number {
  return ((distance + offset) % cycle + cycle) % cycle;
}

function dashPhaseInfo(phase: number, pattern: number[]): DashPhaseInfo {
  let cursor = 0;

  for (let index = 0; index < pattern.length; index += 1) {
    const length = pattern[index];
    const next = cursor + length;
    if (phase < next || index === pattern.length - 1) {
      const distanceToBoundary = Math.min(Math.abs(phase - cursor), Math.abs(next - phase));
      return {
        inDash: index % 2 === 0,
        distanceToBoundary,
        segmentStart: cursor,
        segmentEnd: next
      };
    }
    cursor = next;
  }

  return {
    inDash: true,
    distanceToBoundary: 0,
    segmentStart: 0,
    segmentEnd: pattern[0] ?? 0
  };
}

function cornerDistances(route: Array<{ x: number; y: number }>): number[] {
  if (route.length < 3) {
    return [];
  }

  const result: number[] = [];
  let cumulative = 0;

  for (let index = 1; index < route.length; index += 1) {
    const previous = route[index - 1];
    const point = route[index];
    cumulative += Math.abs(point.x - previous.x) + Math.abs(point.y - previous.y);
    if (index < route.length - 1) {
      result.push(cumulative);
    }
  }

  return result;
}

function scoreDashOffsetCandidate(
  offset: number,
  pathDistance: number,
  cycle: number,
  pattern: number[],
  cornerAt: number[]
): number {
  let score = 0;

  const endpointPhase = phaseAtDistance(pathDistance, offset, cycle);
  const endpointInfo = dashPhaseInfo(endpointPhase, pattern);
  if (!endpointInfo.inDash) {
    score += 1_000_000;
  } else {
    const terminalVisible = endpointPhase - endpointInfo.segmentStart;
    if (terminalVisible < DASH_TERMINAL_MIN_VISIBLE) {
      score += (DASH_TERMINAL_MIN_VISIBLE - terminalVisible) * 45_000;
    }
    if (endpointInfo.distanceToBoundary < DASH_CORNER_BOUNDARY_GUARD) {
      score += (DASH_CORNER_BOUNDARY_GUARD - endpointInfo.distanceToBoundary) * 20_000;
    }
  }

  const startPhase = phaseAtDistance(0, offset, cycle);
  const startInfo = dashPhaseInfo(startPhase, pattern);
  if (startInfo.inDash) {
    const startVisible = startInfo.segmentEnd - startPhase;
    if (startVisible < DASH_TERMINAL_MIN_VISIBLE) {
      score += (DASH_TERMINAL_MIN_VISIBLE - startVisible) * 7_000;
    }
  }

  for (const distance of cornerAt) {
    const phase = phaseAtDistance(distance, offset, cycle);
    const info = dashPhaseInfo(phase, pattern);
    if (info.distanceToBoundary < DASH_CORNER_BOUNDARY_GUARD) {
      score += (DASH_CORNER_BOUNDARY_GUARD - info.distanceToBoundary) * 14_000;
    }
    if (info.inDash) {
      score += DASH_CORNER_IN_DASH_PENALTY;
    }
  }

  return score;
}

function dashOffsetForEndpoint(
  pathDistance: number,
  dasharray: string | null,
  route: Array<{ x: number; y: number }>
): number | undefined {
  const pattern = parseDashPattern(dasharray);
  if (pattern.length === 0) {
    return undefined;
  }

  const cycle = pattern.reduce((sum, value) => sum + value, 0);
  if (cycle <= 0 || pattern[0] <= 0) {
    return undefined;
  }
  const cornerAt = cornerDistances(route);

  let bestOffset = 0;
  let bestScore = Number.POSITIVE_INFINITY;

  for (let offset = 0; offset < cycle; offset += 1) {
    const score = scoreDashOffsetCandidate(offset, pathDistance, cycle, pattern, cornerAt);
    if (score < bestScore) {
      bestScore = score;
      bestOffset = offset;
    }
  }

  return bestOffset;
}

export function EdgePathGroup({ data, opacityMultiplier = 1 }: EdgePathGroupProps) {
  const {
    isSelected,
    isAnimated,
    link,
    edgeOpacity,
    selectedHaloOpacity,
    baseStrokeWidth,
    selectedStrokeWidth
  } = data;
  const strokeWidth = isSelected ? selectedStrokeWidth : baseStrokeWidth;
  const effectiveOpacityMultiplier = Math.max(0, Math.min(1, opacityMultiplier));
  const dashOffset = dashOffsetForEndpoint(link.pathDistance, link.dasharray, link.route);
  const lineCap = "round";
  const lineJoin = "round";

  return (
    <g>
      {isSelected ? (
        <path
          d={link.path}
          fill="none"
          stroke={link.visual.stroke}
          strokeWidth={HIGHLIGHT_HALO_STROKE_WIDTH}
          strokeLinecap={lineCap}
          strokeLinejoin={lineJoin}
          vectorEffect="non-scaling-stroke"
          strokeDasharray={link.dasharray ?? undefined}
          strokeDashoffset={dashOffset}
          opacity={selectedHaloOpacity * effectiveOpacityMultiplier}
          style={{ transition: EDGE_OPACITY_TRANSITION }}
        />
      ) : null}
      <path
        d={link.path}
        fill="none"
        stroke={link.visual.stroke}
        strokeWidth={strokeWidth}
        strokeLinecap={lineCap}
        strokeLinejoin={lineJoin}
        vectorEffect="non-scaling-stroke"
        strokeDasharray={link.dasharray ?? undefined}
        strokeDashoffset={dashOffset}
        opacity={edgeOpacity * effectiveOpacityMultiplier}
        markerEnd={`url(#${link.visual.markerId})`}
        style={{ transition: EDGE_OPACITY_TRANSITION }}
      />

      {isAnimated ? (
        <g className="link-shimmer-group" opacity="0">
          {EDGE_SHIMMER_LAYERS.map((shimmerLayer) => (
            <path
              key={shimmerLayer.dasharray}
              className="link-shimmer-path"
              d={link.path}
              fill="none"
              stroke="white"
              strokeWidth={strokeWidth + shimmerLayer.widthOffset}
              strokeLinecap="round"
              strokeLinejoin="round"
              vectorEffect="non-scaling-stroke"
              pathLength={1}
              strokeDasharray={shimmerLayer.dasharray}
              data-dash-len={shimmerLayer.dataDashLen}
              filter={shimmerLayer.filter}
              opacity={shimmerLayer.opacity}
            />
          ))}
        </g>
      ) : null}
    </g>
  );
}
