import { beforeEach, describe, expect, it, vi } from "vitest";

const elkLayoutMock = vi.hoisted(() => vi.fn());
const getElkInstanceMock = vi.hoisted(() =>
  vi.fn(async () => ({
    layout: elkLayoutMock
  }))
);

vi.mock("../../src/lib/flow-layout/graphMutations.ts", async () => {
  const actual = await vi.importActual<typeof import("../../src/lib/flow-layout/graphMutations.ts")>(
    "../../src/lib/flow-layout/graphMutations.ts"
  );

  return {
    ...actual,
    getElkInstance: getElkInstanceMock
  };
});

import { computeAutoLayoutPositions } from "../../src/lib/flow-layout/layout.ts";
import { buildElkGraph, computeAutoLayoutPositionsSmart } from "../../src/lib/flow-layout/graph.ts";
import { DEFAULT_NODE_HEIGHT, DEFAULT_NODE_WIDTH, DEFAULT_ROW_GAP } from "../../src/lib/flow-layout/constants.ts";
import { layoutNodeVisualHeight } from "../../src/lib/flow-layout/nodeDimensions.ts";
import type { AgentRole, PipelinePayload } from "../../src/lib/types.ts";

function createStep(id: string, role: AgentRole, index: number): PipelinePayload["steps"][number] {
  return {
    id,
    name: id,
    role,
    prompt: "",
    providerId: "claude",
    model: "claude-sonnet-4-6",
    reasoningEffort: "medium",
    fastMode: false,
    use1MContext: false,
    contextWindowTokens: 128000,
    position: {
      x: index * 300,
      y: 100
    },
    contextTemplate: "",
    enableDelegation: false,
    delegationCount: 0,
    enableIsolatedStorage: false,
    enableSharedStorage: true,
    enabledMcpServerIds: [],
    outputFormat: "markdown",
    requiredOutputFields: [],
    requiredOutputFiles: [],
    scenarios: [],
    skipIfArtifacts: [],
    policyProfileIds: [],
    cacheBypassInputKeys: [],
    cacheBypassOrchestratorPromptPatterns: []
  };
}

function createChain(): { steps: PipelinePayload["steps"]; links: PipelinePayload["links"] } {
  const steps: PipelinePayload["steps"] = [
    createStep("root", "orchestrator", 0),
    createStep("a", "analysis", 1),
    createStep("b", "analysis", 2),
    createStep("c", "executor", 3),
    createStep("d", "review", 4),
    createStep("e", "executor", 5)
  ];

  const links: PipelinePayload["links"] = [
    { sourceStepId: "root", targetStepId: "a", condition: "always" },
    { sourceStepId: "a", targetStepId: "b", condition: "always" },
    { sourceStepId: "b", targetStepId: "c", condition: "always" },
    { sourceStepId: "c", targetStepId: "d", condition: "always" },
    { sourceStepId: "d", targetStepId: "e", condition: "always" }
  ];

  return { steps, links };
}

describe("flow auto-layout compactness", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    elkLayoutMock.mockReset();
  });

  it("compresses linear chains into fewer columns while preserving left-to-right flow", () => {
    const { steps, links } = createChain();
    const positions = computeAutoLayoutPositions(steps, links);

    const uniqueX = new Set(Object.values(positions).map((entry) => entry.x));
    const sortedX = [...uniqueX].sort((left, right) => left - right);
    expect(uniqueX.size).toBeLessThanOrEqual(3);
    expect(sortedX[1] - sortedX[0]).toBeGreaterThanOrEqual(DEFAULT_NODE_WIDTH + 50);
    expect(positions.root?.x).toBeLessThan(positions.a?.x ?? Number.NEGATIVE_INFINITY);
    expect(positions.b?.x).toBe(positions.a?.x);
    expect(positions.c?.x).toBe(positions.a?.x);

    for (const link of links) {
      const sourceX = positions[link.sourceStepId]?.x;
      const targetX = positions[link.targetStepId]?.x;
      expect(sourceX).toBeDefined();
      expect(targetX).toBeDefined();
      expect((targetX ?? 0) - (sourceX ?? 0)).toBeGreaterThanOrEqual(0);
    }
  });

  it("keeps branching and merge columns distinct for readability", () => {
    const steps: PipelinePayload["steps"] = [
      createStep("root", "orchestrator", 0),
      createStep("gateway", "analysis", 1),
      createStep("left", "executor", 2),
      createStep("right", "review", 3),
      createStep("join", "executor", 4)
    ];

    const links: PipelinePayload["links"] = [
      { sourceStepId: "root", targetStepId: "gateway", condition: "always" },
      { sourceStepId: "gateway", targetStepId: "left", condition: "always" },
      { sourceStepId: "gateway", targetStepId: "right", condition: "always" },
      { sourceStepId: "left", targetStepId: "join", condition: "always" },
      { sourceStepId: "right", targetStepId: "join", condition: "always" }
    ];

    const positions = computeAutoLayoutPositions(steps, links);

    expect(positions.gateway?.x).toBeGreaterThan(positions.root?.x ?? Number.POSITIVE_INFINITY);
    expect(positions.left?.x).toBe(positions.right?.x);
    expect(positions.left?.x).toBeGreaterThan(positions.gateway?.x ?? Number.POSITIVE_INFINITY);
    expect(positions.join?.x).toBeGreaterThan(positions.left?.x ?? Number.POSITIVE_INFINITY);
  });

  it("adds extra vertical spacing for delegated nodes in the same layer", () => {
    const root = createStep("root", "orchestrator", 0);
    const delegated = {
      ...createStep("delegated", "executor", 1),
      enableDelegation: true,
      delegationCount: 3
    };
    const plain = createStep("plain", "review", 2);
    const steps: PipelinePayload["steps"] = [root, delegated, plain];
    const links: PipelinePayload["links"] = [
      { sourceStepId: root.id, targetStepId: delegated.id, condition: "always" },
      { sourceStepId: root.id, targetStepId: plain.id, condition: "always" }
    ];

    const positions = computeAutoLayoutPositions(steps, links);
    expect(positions.delegated?.x).toBe(positions.plain?.x);

    const sameLayerIds = [delegated.id, plain.id].sort(
      (left, right) => (positions[left]?.y ?? 0) - (positions[right]?.y ?? 0)
    );
    const upperId = sameLayerIds[0];
    const lowerId = sameLayerIds[1];
    const stepById = new Map(steps.map((step) => [step.id, step]));
    const upperStep = stepById.get(upperId);
    const upperY = positions[upperId]?.y ?? 0;
    const lowerY = positions[lowerId]?.y ?? 0;

    const configuredRowGap = Math.max(170, DEFAULT_ROW_GAP);
    const interNodeGap = Math.max(24, configuredRowGap - DEFAULT_NODE_HEIGHT);
    const expectedDelta = layoutNodeVisualHeight(upperStep ?? {}) + interNodeGap;
    expect(lowerY - upperY).toBeGreaterThanOrEqual(expectedDelta);
  });

  it("increases row spacing for dense hub nodes to avoid cramped auto-layout columns", () => {
    const root = createStep("root", "orchestrator", 0);
    const nodes = [root];
    for (let index = 0; index < 5; index += 1) {
      nodes.push(createStep(`target-${index}`, "executor", index + 1));
    }

    const steps = nodes;
    const links: PipelinePayload["links"] = nodes
      .slice(1)
      .map((step) => ({ sourceStepId: root.id, targetStepId: step.id, condition: "always" }));

    const positions = computeAutoLayoutPositions(steps, links);
    const targetYs = steps
      .slice(1)
      .map((step) => positions[step.id]?.y ?? 0)
      .sort((left, right) => left - right);

    let minGap = Number.POSITIVE_INFINITY;
    for (let index = 1; index < targetYs.length; index += 1) {
      minGap = Math.min(minGap, targetYs[index] - targetYs[index - 1]);
    }

    expect(minGap).toBeGreaterThan(DEFAULT_ROW_GAP);
  });

  it("falls back to compact layout when ELK result is excessively wide", async () => {
    const { steps, links } = createChain();
    const fallback = computeAutoLayoutPositions(steps, links);

    elkLayoutMock.mockResolvedValue({
      id: "flow-root",
      children: steps.map((step, index) => ({
        id: step.id,
        x: index * 760,
        y: 120,
        width: 240,
        height: 116
      }))
    });

    const smartPositions = await computeAutoLayoutPositionsSmart(steps, links);

    expect(getElkInstanceMock).toHaveBeenCalledTimes(1);
    expect(smartPositions).toEqual(fallback);
  });

  it("keeps ELK positions when they are already compact", async () => {
    const { steps, links } = createChain();
    const fallback = computeAutoLayoutPositions(steps, links);

    elkLayoutMock.mockResolvedValue({
      id: "flow-root",
      children: [
        { id: "root", x: 0, y: 180, width: 240, height: 116 },
        { id: "a", x: 250, y: 80, width: 240, height: 116 },
        { id: "b", x: 500, y: 80, width: 240, height: 116 },
        { id: "c", x: 500, y: 280, width: 240, height: 116 },
        { id: "d", x: 750, y: 180, width: 240, height: 116 },
        { id: "e", x: 990, y: 180, width: 240, height: 116 }
      ]
    });

    const smartPositions = await computeAutoLayoutPositionsSmart(steps, links);

    expect(getElkInstanceMock).toHaveBeenCalledTimes(1);
    expect(smartPositions).not.toEqual(fallback);
    expect(smartPositions.root?.x).toBe(120);
    expect(smartPositions.a?.x).toBe(370);
    expect(smartPositions.e?.x).toBe(1110);
  });

  it("builds ELK graph with delegation-aware node heights", () => {
    const root = createStep("root", "orchestrator", 0);
    const delegated = {
      ...createStep("delegated", "executor", 1),
      enableDelegation: true,
      delegationCount: 2
    };
    const plain = createStep("plain", "review", 2);
    const steps: PipelinePayload["steps"] = [root, delegated, plain];
    const links: PipelinePayload["links"] = [
      { sourceStepId: root.id, targetStepId: delegated.id, condition: "always" },
      { sourceStepId: delegated.id, targetStepId: plain.id, condition: "always" }
    ];

    const graph = buildElkGraph(steps, links, {});
    const childById = new Map((graph.children ?? []).map((child) => [child.id, child]));
    expect(childById.get("delegated")?.height).toBe(layoutNodeVisualHeight(delegated));
    expect(childById.get("plain")?.height).toBe(DEFAULT_NODE_HEIGHT);

    const rowGap = Number(graph.layoutOptions?.["elk.spacing.nodeNode"] ?? "0");
    expect(rowGap).toBeGreaterThanOrEqual(layoutNodeVisualHeight(delegated) + 52);
  });

  it("builds ELK graph with adaptive row spacing for dense hubs", () => {
    const root = createStep("root", "orchestrator", 0);
    const steps: PipelinePayload["steps"] = [root];
    for (let index = 0; index < 5; index += 1) {
      steps.push(createStep(`target-${index}`, "executor", index + 1));
    }
    const links: PipelinePayload["links"] = steps
      .slice(1)
      .map((step) => ({ sourceStepId: root.id, targetStepId: step.id, condition: "always" }));

    const graph = buildElkGraph(steps, links, {});
    const rowGap = Number(graph.layoutOptions?.["elk.spacing.nodeNode"] ?? "0");

    expect(rowGap).toBeGreaterThanOrEqual(190);
  });
});
