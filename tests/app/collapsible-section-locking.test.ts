import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { CollapsibleSection } from "../../src/components/dashboard/pipeline-editor/sections/CollapsibleSection.tsx";

function renderSection(disableContent: boolean): string {
  return renderToStaticMarkup(
    createElement(
      CollapsibleSection,
      {
        icon: null,
        label: "Prompt",
        collapsed: false,
        onToggle: () => {},
        disableContent
      },
      createElement("input", { value: "Draft instructions", readOnly: true })
    )
  );
}

describe("collapsible section locking", () => {
  it("keeps the section toggle outside disabled content when locked", () => {
    const html = renderSection(true);

    const toggleButtonStart = html.indexOf("<button");
    const disabledFieldsetStart = html.indexOf("<fieldset");

    expect(toggleButtonStart).toBeGreaterThanOrEqual(0);
    expect(disabledFieldsetStart).toBeGreaterThanOrEqual(0);
    expect(toggleButtonStart).toBeLessThan(disabledFieldsetStart);
    expect(html).toContain("<fieldset disabled=\"\"");
  });

  it("does not wrap content in a disabled fieldset when unlocked", () => {
    const html = renderSection(false);

    expect(html).not.toContain("<fieldset disabled=\"\"");
  });
});
