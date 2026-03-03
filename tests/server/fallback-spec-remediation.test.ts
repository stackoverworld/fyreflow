import { describe, expect, it } from "vitest";
import { fallbackSpec } from "../../server/flowBuilder/fallbackSpec.js";

describe("fallback design pipeline remediation routes", () => {
  it("includes on_fail remediation routes for extraction and render stages", () => {
    const spec = fallbackSpec("Build design to HTML to PDF flow");

    const hasDesignOnFail = spec.links.some(
      (link) => link.source === "Design Asset Extraction" && link.target === "Design Asset Extraction" && link.condition === "on_fail"
    );
    const hasSourceOnFail = spec.links.some(
      (link) =>
        link.source === "Source Content Extraction" && link.target === "Source Content Extraction" && link.condition === "on_fail"
    );
    const hasHtmlBuilderOnFail = spec.links.some(
      (link) => link.source === "HTML Builder" && link.target === "HTML Builder" && link.condition === "on_fail"
    );
    const hasPdfRendererOnFail = spec.links.some(
      (link) => link.source === "PDF Renderer" && link.target === "PDF Renderer" && link.condition === "on_fail"
    );

    expect(hasDesignOnFail).toBe(true);
    expect(hasSourceOnFail).toBe(true);
    expect(hasHtmlBuilderOnFail).toBe(true);
    expect(hasPdfRendererOnFail).toBe(true);
  });
});

describe("fallback parallel multi-agent template", () => {
  it("produces fan-out links from orchestrator to parallel agents", () => {
    const spec = fallbackSpec("Build a multi-agent research and code pipeline");

    const fanOutTargets = spec.links
      .filter((link) => link.source === "Orchestrator" && link.condition === "always")
      .map((link) => link.target);

    expect(fanOutTargets).toContain("Research Agent");
    expect(fanOutTargets).toContain("Code Agent");
    expect(fanOutTargets).toContain("QA Agent");
    expect(fanOutTargets).toHaveLength(3);
  });

  it("produces fan-in links from parallel agents to reviewer", () => {
    const spec = fallbackSpec("parallel agents team of agents pipeline");

    const fanInSources = spec.links
      .filter((link) => link.target === "Reviewer" && link.condition === "always")
      .map((link) => link.source);

    expect(fanInSources).toContain("Research Agent");
    expect(fanInSources).toContain("Code Agent");
    expect(fanInSources).toContain("QA Agent");
    expect(fanInSources).toHaveLength(3);
  });

  it("enables delegation on orchestrator step", () => {
    const spec = fallbackSpec("multi-agent parallel workflow");

    const orchestrator = spec.steps.find((step) => step.name === "Orchestrator");
    expect(orchestrator).toBeDefined();
    expect(orchestrator!.role).toBe("orchestrator");
    expect(orchestrator!.enableDelegation).toBe(true);
    expect(orchestrator!.delegationCount).toBe(3);
  });

  it("includes on_fail remediation loop from reviewer to orchestrator", () => {
    const spec = fallbackSpec("team of agents code review pipeline");

    const hasRemediationLoop = spec.links.some(
      (link) => link.source === "Reviewer" && link.target === "Orchestrator" && link.condition === "on_fail"
    );

    expect(hasRemediationLoop).toBe(true);
  });

  it("sets increased runtime budget for multi-agent execution", () => {
    const spec = fallbackSpec("multi-agent research pipeline");

    expect(spec.runtime!.maxLoops).toBeGreaterThanOrEqual(3);
    expect(spec.runtime!.maxStepExecutions).toBeGreaterThanOrEqual(24);
  });

  it("uses GateResult JSON contracts for tester and reviewer steps", () => {
    const spec = fallbackSpec("parallel agents team of agents pipeline");
    const qaAgent = spec.steps.find((step) => step.name === "QA Agent");
    const reviewer = spec.steps.find((step) => step.name === "Reviewer");
    const reviewerStatusGate = spec.qualityGates?.find((gate) => gate.target === "Reviewer" && gate.kind === "json_field_exists");

    expect(qaAgent).toBeDefined();
    expect(qaAgent!.role).toBe("tester");
    expect(qaAgent!.outputFormat).toBe("json");
    expect(qaAgent!.requiredOutputFields).toEqual(["workflow_status", "next_action", "reasons"]);

    expect(reviewer).toBeDefined();
    expect(reviewer!.role).toBe("review");
    expect(reviewer!.outputFormat).toBe("json");
    expect(reviewer!.requiredOutputFields).toEqual(["workflow_status", "next_action", "reasons"]);

    expect(reviewerStatusGate).toBeDefined();
    expect(reviewerStatusGate!.jsonPath).toBe("workflow_status");
  });
});
