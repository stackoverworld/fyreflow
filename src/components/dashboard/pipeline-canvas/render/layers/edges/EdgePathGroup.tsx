import { EDGE_SHIMMER_LAYERS, HIGHLIGHT_HALO_STROKE_WIDTH } from "./edgeLayerSelectors";
import type { EdgeRenderData } from "./useEdgeRenderData";

export interface EdgePathGroupProps {
  data: EdgeRenderData;
  opacityMultiplier?: number;
}

const EDGE_OPACITY_TRANSITION = "opacity 240ms cubic-bezier(0.16, 1, 0.3, 1)";

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

  return (
    <g>
      {isSelected ? (
        <path
          d={link.path}
          fill="none"
          stroke={link.visual.stroke}
          strokeWidth={HIGHLIGHT_HALO_STROKE_WIDTH}
          strokeLinecap="round"
          strokeLinejoin="round"
          vectorEffect="non-scaling-stroke"
          strokeDasharray={link.dasharray ?? undefined}
          opacity={selectedHaloOpacity * effectiveOpacityMultiplier}
          style={{ transition: EDGE_OPACITY_TRANSITION }}
        />
      ) : null}
      <path
        d={link.path}
        fill="none"
        stroke={link.visual.stroke}
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        strokeLinejoin="round"
        vectorEffect="non-scaling-stroke"
        strokeDasharray={link.dasharray ?? undefined}
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
