import { describe, expect, it } from "vitest";
import { autoLayoutPipelineDraftSmart, computeEdgeRoutesSmart } from "../../src/lib/flowLayout.ts";
import { buildRenderedLinks } from "../../src/components/dashboard/pipeline-canvas/PipelineCanvas.handlers.ts";
import { createDraftStep } from "../../src/lib/pipelineDraft.ts";
import type { PipelinePayload } from "../../src/lib/types";

function createRouteFixturePipeline(): PipelinePayload {
  const orchestrator = {
    ...createDraftStep(0),
    id: "step-orchestrator",
    name: "1. Orchestrator",
    role: "orchestrator" as const,
    enableDelegation: true,
    delegationCount: 3
  };
  const planner = {
    ...createDraftStep(1),
    id: "step-planner",
    name: "2. Planner",
    role: "planner" as const
  };
  const executor = {
    ...createDraftStep(2),
    id: "step-executor",
    name: "3. Executor",
    role: "executor" as const
  };
  const reviewer = {
    ...createDraftStep(3),
    id: "step-reviewer",
    name: "4. Reviewer",
    role: "review" as const
  };

  return {
    name: "Smart Route Fixture",
    description: "Deterministic route fixture for smart routing checks.",
    steps: [orchestrator, planner, executor, reviewer],
    links: [
      {
        id: "link-1",
        sourceStepId: orchestrator.id,
        targetStepId: planner.id,
        condition: "always"
      },
      {
        id: "link-2",
        sourceStepId: planner.id,
        targetStepId: executor.id,
        condition: "on_pass"
      },
      {
        id: "link-3",
        sourceStepId: planner.id,
        targetStepId: reviewer.id,
        condition: "on_fail"
      },
      {
        id: "link-4",
        sourceStepId: executor.id,
        targetStepId: reviewer.id,
        condition: "always"
      }
    ],
    qualityGates: []
  };
}

function segmentLength(a: { x: number; y: number }, b: { x: number; y: number }): number {
  return Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
}

function hasTinyEndpointHook(route: Array<{ x: number; y: number }>): boolean {
  if (route.length >= 3) {
    const first = segmentLength(route[0], route[1]);
    const second = segmentLength(route[1], route[2]);
    if (first <= 26 && second <= 26) {
      return true;
    }
  }
  if (route.length >= 4) {
    const n = route.length;
    const last = segmentLength(route[n - 2], route[n - 1]);
    const beforeLast = segmentLength(route[n - 3], route[n - 2]);
    if (last <= 26 && beforeLast <= 26) {
      return true;
    }
  }
  return false;
}

describe("smart route analysis", () => {
  it("keeps link parity and avoids tiny endpoint hooks on deterministic fixture", async () => {
    const pipeline = createRouteFixturePipeline();
    const laidOut = await autoLayoutPipelineDraftSmart({
      name: pipeline.name,
      description: pipeline.description ?? "",
      steps: pipeline.steps,
      links: pipeline.links,
      qualityGates: pipeline.qualityGates ?? []
    });

    const nodes = laidOut.steps.map((step) => ({
      id: step.id,
      name: step.name,
      role: step.role,
      providerId: step.providerId,
      model: step.model,
      position: step.position,
      enableDelegation: step.enableDelegation,
      delegationCount: step.delegationCount
    }));
    const links = laidOut.links.map((link, index) => ({
      id: link.id ?? `link-${index}-${link.sourceStepId}-${link.targetStepId}-${link.condition ?? "always"}`,
      sourceStepId: link.sourceStepId,
      targetStepId: link.targetStepId,
      condition: link.condition
    }));
    const nodeById = new Map(nodes.map((node) => [node.id, node]));

    const smartRouteByLinkId = await computeEdgeRoutesSmart(
      nodes.map((node) => ({ id: node.id, position: node.position, role: node.role })),
      links.map((link) => ({
        id: link.id,
        sourceStepId: link.sourceStepId,
        targetStepId: link.targetStepId,
        condition: link.condition
      }))
    );

    const renderedFallback = buildRenderedLinks({
      links,
      nodes,
      nodeById,
      previousAxisByLinkId: new Map(),
      manualRoutePoints: {},
      canUseSmartRoutes: false,
      smartRouteByLinkId: {},
      orchestratorLaneByLinkId: new Map(),
      reciprocalLaneByLinkId: new Map()
    });
    const renderedSmart = buildRenderedLinks({
      links,
      nodes,
      nodeById,
      previousAxisByLinkId: new Map(),
      manualRoutePoints: {},
      canUseSmartRoutes: true,
      smartRouteByLinkId,
      orchestratorLaneByLinkId: new Map(),
      reciprocalLaneByLinkId: new Map()
    });

    expect(renderedFallback).toHaveLength(links.length);
    expect(renderedSmart).toHaveLength(links.length);

    for (const link of links) {
      const fallbackEdge = renderedFallback.find((edge) => edge.id === link.id);
      const smartEdge = renderedSmart.find((edge) => edge.id === link.id);

      expect(fallbackEdge).toBeDefined();
      expect(smartEdge).toBeDefined();
      if (!fallbackEdge || !smartEdge) {
        throw new Error(`Missing rendered edge for link: ${link.id}`);
      }

      expect(smartEdge.route.length).toBeGreaterThanOrEqual(2);
      expect(hasTinyEndpointHook(smartEdge.route)).toBe(false);
      expect(hasTinyEndpointHook(fallbackEdge.route)).toBe(false);

      for (let index = 1; index < smartEdge.route.length; index += 1) {
        const previous = smartEdge.route[index - 1];
        const current = smartEdge.route[index];
        expect(Number.isFinite(previous.x)).toBe(true);
        expect(Number.isFinite(previous.y)).toBe(true);
        expect(Number.isFinite(current.x)).toBe(true);
        expect(Number.isFinite(current.y)).toBe(true);
        expect(segmentLength(previous, current)).toBeGreaterThan(0);
      }
    }
  });
});
