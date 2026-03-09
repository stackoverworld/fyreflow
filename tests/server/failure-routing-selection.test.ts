import { describe, expect, it } from "vitest";
import { selectRoutedLinksForOutcome } from "../../server/runner/execution.js";
import type { PipelineLink } from "../../server/types/contracts.js";

function createLink(
  id: string,
  condition: PipelineLink["condition"],
  targetStepId = `${id}-target`,
  conditionExpression?: string
): PipelineLink {
  return {
    id,
    sourceStepId: "source-step",
    targetStepId,
    condition,
    ...(conditionExpression ? { conditionExpression } : {})
  };
}

describe("failure routing selection", () => {
  it("uses only on_fail routes on blocking failures", () => {
    const links: PipelineLink[] = [createLink("always", "always"), createLink("on-fail", "on_fail")];
    const routed = selectRoutedLinksForOutcome(links, "fail", true);
    expect(routed.map((link) => link.id)).toEqual(["on-fail"]);
  });

  it("returns no route for blocking failures without on_fail links", () => {
    const links: PipelineLink[] = [createLink("always", "always")];
    const routed = selectRoutedLinksForOutcome(links, "fail", true);
    expect(routed).toHaveLength(0);
  });

  it("keeps standard routing for non-blocking failures", () => {
    const links: PipelineLink[] = [createLink("always", "always"), createLink("on-fail", "on_fail")];
    const routed = selectRoutedLinksForOutcome(links, "fail", false);
    expect(routed.map((link) => link.id)).toEqual(["always", "on-fail"]);
  });

  it("keeps standard routing for non-failure outcomes", () => {
    const links: PipelineLink[] = [createLink("always", "always"), createLink("on-pass", "on_pass")];
    const routed = selectRoutedLinksForOutcome(links, "pass", true);
    expect(routed.map((link) => link.id)).toEqual(["always", "on-pass"]);
  });

  it("supports semantic routing against JSON payload fields", () => {
    const links: PipelineLink[] = [
      createLink("changed", "always", "changed-target", "$.has_changes == true"),
      createLink("review", "always", "review-target", "$.confidence < 0.8"),
      createLink("fallback", "always")
    ];

    const routed = selectRoutedLinksForOutcome(links, "pass", false, {
      has_changes: true,
      confidence: 0.72
    });

    expect(routed.map((link) => link.id)).toEqual(["changed", "review", "fallback"]);
  });

  it("does not route semantic branches when the payload condition fails", () => {
    const links: PipelineLink[] = [createLink("stop", "always", "stop-target", "$.has_changes == true")];

    const routed = selectRoutedLinksForOutcome(links, "pass", false, {
      has_changes: false
    });

    expect(routed).toHaveLength(0);
  });
});
