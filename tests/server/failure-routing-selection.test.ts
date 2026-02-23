import { describe, expect, it } from "vitest";
import { selectRoutedLinksForOutcome } from "../../server/runner/execution.js";
import type { PipelineLink } from "../../server/types/contracts.js";

function createLink(
  id: string,
  condition: PipelineLink["condition"],
  targetStepId = `${id}-target`
): PipelineLink {
  return {
    id,
    sourceStepId: "source-step",
    targetStepId,
    condition
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
});
