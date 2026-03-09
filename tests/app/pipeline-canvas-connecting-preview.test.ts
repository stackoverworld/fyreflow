import { describe, expect, it } from "vitest";
import { buildConnectingPreviewData } from "../../src/components/dashboard/pipeline-canvas/render/layers/edges/edgeLayerSelectors.ts";
import type { ConnectingState, FlowLink, FlowNode } from "../../src/components/dashboard/pipeline-canvas/types.ts";
import { nodeSourceAnchorRect } from "../../src/components/dashboard/pipeline-canvas/useNodeLayout.ts";

function createNode(id: string, role: FlowNode["role"], x: number, y: number): FlowNode {
  return {
    id,
    name: id,
    role,
    providerId: "claude",
    model: "claude-sonnet-4-6",
    position: { x, y }
  };
}

function movePoint(path: string): { x: number; y: number } | null {
  const match = path.match(/^M\s+(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)/);
  if (!match) {
    return null;
  }

  return {
    x: Number(match[1]),
    y: Number(match[2])
  };
}

describe("connecting preview lane distribution", () => {
  it("spreads orchestrator preview anchors when same-side orchestrator links already exist", () => {
    const orchestrator = createNode("orchestrator", "orchestrator", 40, 220);
    const existingTarget = createNode("existing-target", "executor", 360, 120);
    const previewTarget = createNode("preview-target", "executor", 360, 340);
    const links: FlowLink[] = [
      {
        id: "orchestrator-existing-target",
        sourceStepId: orchestrator.id,
        targetStepId: existingTarget.id,
        condition: "always"
      }
    ];
    const connectingState: ConnectingState = {
      sourceNodeId: orchestrator.id,
      targetNodeId: previewTarget.id,
      pointer: { x: 0, y: 0 }
    };
    const nodeById = new Map<string, FlowNode>([
      [orchestrator.id, orchestrator],
      [existingTarget.id, existingTarget],
      [previewTarget.id, previewTarget]
    ]);

    const preview = buildConnectingPreviewData(
      connectingState,
      [orchestrator, existingTarget, previewTarget],
      links,
      nodeById
    );

    expect(preview).not.toBeNull();
    if (!preview) {
      return;
    }

    const sourceRect = nodeSourceAnchorRect(orchestrator);
    const sourceCenterY = (sourceRect.top + sourceRect.bottom) / 2;
    const previewStart = movePoint(preview.d);

    expect(previewStart).not.toBeNull();
    if (!previewStart) {
      return;
    }

    expect(previewStart.x).toBe(sourceRect.right);
    expect(previewStart.y).not.toBe(sourceCenterY);
  });
});
