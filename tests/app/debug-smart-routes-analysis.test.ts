import { describe, expect, it } from "vitest";
import fs from "node:fs";
import { autoLayoutPipelineDraftSmart, computeEdgeRoutesSmart } from "../../src/lib/flowLayout.ts";
import { buildRenderedLinks } from "../../src/components/dashboard/pipeline-canvas/PipelineCanvas.handlers.ts";

function routeKey(route: Array<{ x: number; y: number }>): string {
  return route.map((point) => `${point.x},${point.y}`).join("|");
}

describe("debug smart route analysis", () => {
  it("prints route comparison for real pipeline", async () => {
    const db = JSON.parse(fs.readFileSync("data/local-db.json", "utf8"));
    const pipelines = db.pipelines ?? [];
    const pipeline =
      pipelines.find((entry: { name?: string }) => (entry.name ?? "").includes("Figma to HTML to PDF")) ??
      pipelines[0];

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
