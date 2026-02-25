import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { autoLayoutPipelineDraftSmart, computeEdgeRoutesSmart } from "../../src/lib/flowLayout.ts";
import { buildRenderedLinks } from "../../src/components/dashboard/pipeline-canvas/PipelineCanvas.handlers.ts";
import { createDraftStep } from "../../src/lib/pipelineDraft.ts";
import type { PipelinePayload } from "../../src/lib/types";

function routeKey(route: Array<{ x: number; y: number }>): string {
  return route.map((point) => `${point.x},${point.y}`).join("|");
}

function createFallbackPipeline(): PipelinePayload {
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
    name: "Smart Route Debug Fixture",
    description: "Fallback pipeline used when local-db is unavailable in CI.",
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

function loadPipelineForRouteDebug(): PipelinePayload {
  const localDbPath = path.resolve(process.cwd(), "data/local-db.json");
  if (!fs.existsSync(localDbPath)) {
    return createFallbackPipeline();
  }

  const dbRaw = fs.readFileSync(localDbPath, "utf8");
  const db = JSON.parse(dbRaw) as { pipelines?: unknown };
  const pipelines = Array.isArray(db.pipelines) ? db.pipelines : [];
  const candidate =
    pipelines.find((entry) => {
      if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
        return false;
      }
      const value = entry as { name?: unknown };
      return typeof value.name === "string" && value.name.includes("Figma to HTML to PDF");
    }) ?? pipelines[0];

  if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) {
    return createFallbackPipeline();
  }

  const value = candidate as Partial<PipelinePayload>;
  if (typeof value.name !== "string" || !Array.isArray(value.steps) || !Array.isArray(value.links)) {
    return createFallbackPipeline();
  }

  return {
    name: value.name,
    description: typeof value.description === "string" ? value.description : "",
    steps: value.steps as PipelinePayload["steps"],
    links: value.links as PipelinePayload["links"],
    qualityGates: Array.isArray(value.qualityGates) ? value.qualityGates : []
  };
}

describe("debug smart route analysis", () => {
  it("prints route comparison for real pipeline", async () => {
    const pipeline = loadPipelineForRouteDebug();
    expect(pipeline).toBeTruthy();

    const laidOut = await autoLayoutPipelineDraftSmart({
      name: pipeline.name,
      description: pipeline.description ?? "",
      steps: pipeline.steps,
      links: pipeline.links,
      qualityGates: pipeline.qualityGates ?? []
    });

    const nodes = laidOut.steps.map((step: any) => ({
      id: step.id,
      name: step.name,
      role: step.role,
      providerId: step.providerId,
      model: step.model,
      position: step.position,
      enableDelegation: step.enableDelegation,
      delegationCount: step.delegationCount
    }));

    const links = laidOut.links.map((link: any, index: number) => ({
      id: link.id ?? `link-${index}-${link.sourceStepId}-${link.targetStepId}-${link.condition ?? "always"}`,
      sourceStepId: link.sourceStepId,
      targetStepId: link.targetStepId,
      condition: link.condition
    }));

    const nodeById = new Map(nodes.map((node: any) => [node.id, node]));

    const smartRouteByLinkId = await computeEdgeRoutesSmart(
      nodes.map((node: any) => ({ id: node.id, position: node.position, role: node.role })),
      links.map((link: any) => ({ id: link.id, sourceStepId: link.sourceStepId, targetStepId: link.targetStepId, condition: link.condition }))
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

    const fallbackById = new Map(renderedFallback.map((edge: any) => [edge.id, edge]));
    const smartById = new Map(renderedSmart.map((edge: any) => [edge.id, edge]));

    let changed = 0;
    for (const link of links) {
      const fallback = fallbackById.get(link.id);
      const smart = smartById.get(link.id);
      if (!fallback || !smart) {
        continue;
      }
      const same = routeKey(fallback.route) === routeKey(smart.route);
      if (!same) {
        changed += 1;
      }
      const shortSegments = smart.route.slice(1).filter((point: any, idx: number) => {
        const prev = smart.route[idx];
        return Math.abs(point.x - prev.x) + Math.abs(point.y - prev.y) <= 14;
      }).length;

      console.log(JSON.stringify({
        linkId: link.id,
        source: nodeById.get(link.sourceStepId)?.name,
        target: nodeById.get(link.targetStepId)?.name,
        changedBySmart: !same,
        segmentCount: smart.route.length - 1,
        shortSegments
      }));
    }

    console.log(`links=${links.length} fallback=${renderedFallback.length} smart=${renderedSmart.length} changed=${changed}`);
    expect(renderedSmart).toHaveLength(renderedFallback.length);
  });
});
