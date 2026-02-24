import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { NodesLayer } from "../../src/components/dashboard/pipeline-canvas/render/layers/NodesLayer.tsx";
import type { NodesLayerProps } from "../../src/components/dashboard/pipeline-canvas/render/layers/types.ts";
import type { FlowNode } from "../../src/components/dashboard/pipeline-canvas/types.ts";

const SELECTION_TONE = "border-ember-500 ring-ember-500/40";

const ORCHESTRATOR_NODE: FlowNode = {
  id: "node-orchestrator",
  name: "Orchestrator",
  role: "orchestrator",
  providerId: "claude",
  model: "claude-sonnet-4-6",
  position: { x: 180, y: 220 },
  enableDelegation: true,
  delegationCount: 3
};

const BASE_PROPS: Omit<NodesLayerProps, "nodes" | "nodeById" | "selectedNodeId" | "selectedNodeIds"> = {
  viewport: { x: 0, y: 0, scale: 1 },
  readOnly: false,
  onSelectionChange: () => {},
  onConnectNodes: () => {},
  connectingState: null,
  setConnectingState: () => {},
  setDragState: () => {},
  toWorldPoint: () => ({ x: 0, y: 0 }),
  nodeDragDidMoveRef: { current: false },
  animatedNodeSet: new Set(),
  glowReadySet: new Set()
};

function renderNodesLayer(selectedNodeId: string | null, selectedNodeIds: string[]): string {
  const nodes = [ORCHESTRATOR_NODE];
  const props: Omit<NodesLayerProps, "nodes" | "nodeById" | "selectedNodeId" | "selectedNodeIds"> = {
    ...BASE_PROPS
  };
  return renderToStaticMarkup(
    createElement(NodesLayer, {
      ...props,
      nodes,
      nodeById: new Map(nodes.map((node) => [node.id, node])),
      selectedNodeId,
      selectedNodeIds
    })
  );
}

describe("pipeline canvas delegation selection", () => {
  it("highlights delegation sub-card when the node is selected", () => {
    const html = renderNodesLayer(ORCHESTRATOR_NODE.id, [ORCHESTRATOR_NODE.id]);
    const selectedToneOccurrences = html.split(SELECTION_TONE).length - 1;

    expect(html).toContain("Subagents: 3");
    expect(selectedToneOccurrences).toBe(2);
  });

  it("keeps delegation sub-card border neutral when the node is not selected", () => {
    const html = renderNodesLayer(null, []);
    const subagentTextIndex = html.indexOf("Subagents: 3");
    const subagentCardContext = html.slice(Math.max(0, subagentTextIndex - 300), subagentTextIndex);

    expect(html).not.toContain(SELECTION_TONE);
    expect(subagentTextIndex).toBeGreaterThanOrEqual(0);
    expect(subagentCardContext).toContain("border-[var(--card-border)]");
  });

  it("applies running tint class to both main and delegation cards when node is animated", () => {
    const nodes = [ORCHESTRATOR_NODE];
    const html = renderToStaticMarkup(
      createElement(NodesLayer, {
        ...BASE_PROPS,
        nodes,
        nodeById: new Map(nodes.map((node) => [node.id, node])),
        selectedNodeId: ORCHESTRATOR_NODE.id,
        selectedNodeIds: [ORCHESTRATOR_NODE.id],
        animatedNodeSet: new Set([ORCHESTRATOR_NODE.id])
      })
    );

    const runningTintOccurrences = html.split("node-running-tint").length - 1;
    expect(runningTintOccurrences).toBe(2);
  });
});
