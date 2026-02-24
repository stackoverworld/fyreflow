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
