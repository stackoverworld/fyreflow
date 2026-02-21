import type { OverlayLayerProps } from "../render/layers/types";
import { OverlayLayer } from "../render/layers/OverlayLayer";

type PipelineCanvasOverlaysProps = OverlayLayerProps;

export function PipelineCanvasOverlays(props: PipelineCanvasOverlaysProps) {
  return <OverlayLayer {...props} />;
}
