import { describe, expect, it } from "vitest";
import { buildPotentialOrchestratorDispatchRoutes } from "../../src/components/dashboard/pipeline-canvas/render/layers/edges/potentialDispatchRoutes.ts";
import type { FlowLink, FlowNode } from "../../src/components/dashboard/pipeline-canvas/types.ts";
import type { AgentRole } from "../../src/lib/types.ts";

function createNode(id: string, role: AgentRole, x: number, y: number): FlowNode {
  return {
    id,
    name: id,
    role,
    providerId: "openai",
    model: "gpt-5",
    position: { x, y }
  };
}

describe("buildPotentialOrchestratorDispatchRoutes", () => {
  it("returns no routes when there is no orchestrator node", () => {
    const nodes: FlowNode[] = [
      createNode("analysis", "analysis", 40, 60),
      createNode("executor", "executor", 320, 80)
    ];
    const links: FlowLink[] = [
      { id: "analysis-to-executor", sourceStepId: "analysis", targetStepId: "executor", condition: "always" }
    ];

    expect(buildPotentialOrchestratorDispatchRoutes(nodes, links)).toEqual([]);
  });

  it("builds routes only for nodes without explicit orchestrator links", () => {
    const nodes: FlowNode[] = [
      createNode("orchestrator", "orchestrator", 40, 200),
      createNode("design-assets", "executor", 340, 60),
      createNode("html", "executor", 340, 220),
      createNode("pdf", "executor", 340, 380)
    ];
    const links: FlowLink[] = [
      { id: "o-to-design-assets", sourceStepId: "orchestrator", targetStepId: "design-assets", condition: "always" },
      { id: "design-assets-to-html", sourceStepId: "design-assets", targetStepId: "html", condition: "always" }
    ];

    const routes = buildPotentialOrchestratorDispatchRoutes(nodes, links);
    const routeIds = routes.map((route) => route.id).sort();

    expect(routeIds).toEqual([
      "potential-dispatch:orchestrator:html",
      "potential-dispatch:orchestrator:pdf"
    ]);
    expect(routes.every((route) => route.path.startsWith("M "))).toBe(true);
    expect(routes.every((route) => route.route.length >= 2)).toBe(true);
  });

  it("handles multiple orchestrators independently", () => {
    const nodes: FlowNode[] = [
      createNode("orchestrator-a", "orchestrator", 20, 120),
      createNode("orchestrator-b", "orchestrator", 20, 380),
      createNode("worker-1", "executor", 360, 80),
      createNode("worker-2", "executor", 360, 260),
      createNode("worker-3", "executor", 360, 460)
    ];
    const links: FlowLink[] = [
      { id: "a-to-worker-1", sourceStepId: "orchestrator-a", targetStepId: "worker-1", condition: "always" }
    ];

    const routes = buildPotentialOrchestratorDispatchRoutes(nodes, links);
    const routeTargetsBySource = routes.reduce<Record<string, string[]>>((acc, route) => {
      acc[route.sourceNodeId] = [...(acc[route.sourceNodeId] ?? []), route.targetNodeId].sort();
      return acc;
    }, {});

    expect(routeTargetsBySource["orchestrator-a"]).toEqual(["worker-2", "worker-3"]);
    expect(routeTargetsBySource["orchestrator-b"]).toEqual(["worker-1", "worker-2", "worker-3"]);
  });

  it("can restrict routes to a selected orchestrator", () => {
    const nodes: FlowNode[] = [
      createNode("orchestrator-a", "orchestrator", 20, 120),
      createNode("orchestrator-b", "orchestrator", 20, 380),
      createNode("worker-1", "executor", 360, 80),
      createNode("worker-2", "executor", 360, 260)
    ];
    const links: FlowLink[] = [];

    const routes = buildPotentialOrchestratorDispatchRoutes(nodes, links, {
      orchestratorIds: ["orchestrator-b"]
    });

    const sourceIds = [...new Set(routes.map((route) => route.sourceNodeId))];
    const targetIds = routes.map((route) => route.targetNodeId).sort();

    expect(sourceIds).toEqual(["orchestrator-b"]);
    expect(targetIds).toEqual(["worker-1", "worker-2"]);
  });
});
