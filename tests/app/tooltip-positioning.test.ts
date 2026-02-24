import { describe, expect, it } from "vitest";

import {
  clampTooltipHorizontal,
  clampTooltipLeft,
  computeTooltipArrowLeft,
  computeTooltipPosition
} from "@/components/optics/tooltip-positioning";

describe("tooltip positioning", () => {
  it("centers bottom tooltips on the trigger", () => {
    const coords = computeTooltipPosition(
      { top: 100, left: 300, right: 420, bottom: 132, width: 120, height: 32 },
      { width: 200, height: 40 },
      "bottom"
    );

    expect(coords).toEqual({ top: 140, left: 260 });
  });

  it("keeps the left coordinate when already inside bounds", () => {
    expect(clampTooltipLeft(240, 180, { left: 0, right: 500 })).toBe(240);
  });

  it("clamps to the left gutter when the tooltip overflows left", () => {
    expect(clampTooltipLeft(-20, 180, { left: 0, right: 500 })).toBe(8);
  });

  it("clamps to the right gutter when the tooltip overflows right", () => {
    expect(clampTooltipLeft(380, 180, { left: 0, right: 500 })).toBe(312);
  });

  it("pins to the left gutter when bounds are narrower than the tooltip", () => {
    expect(clampTooltipLeft(20, 180, { left: 10, right: 150 })).toBe(18);
  });

  it("returns clamped coordinates without changing vertical positioning", () => {
    const coords = clampTooltipHorizontal({ top: 24, left: 380 }, 180, { left: 0, right: 500 });

    expect(coords).toEqual({ top: 24, left: 312 });
  });

  it("keeps arrow centered on trigger when tooltip stays centered", () => {
    const arrowLeft = computeTooltipArrowLeft({ left: 300, width: 120 }, 260, 200);

    expect(arrowLeft).toBe(100);
  });

  it("moves arrow toward right when tooltip is clamped to the left edge", () => {
    const arrowLeft = computeTooltipArrowLeft({ left: 12, width: 56 }, 8, 240);

    expect(arrowLeft).toBe(32);
  });

  it("caps arrow near the tooltip edge when trigger is outside tooltip width", () => {
    const arrowLeft = computeTooltipArrowLeft({ left: 460, width: 80 }, 100, 220);

    expect(arrowLeft).toBe(210);
  });
});
