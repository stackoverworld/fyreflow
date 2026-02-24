import { describe, expect, it } from "vitest";

import {
  buildEnglishSummaryFromOutput,
  extractEnglishSummaryFromRecord,
  extractStatusSummaryFromText,
  isEnglishSummaryCandidate
} from "../../server/providers/clientFactory/modelSummary.js";

describe("model summary utils", () => {
  it("accepts English summary candidates and rejects non-English scripts", () => {
    expect(isEnglishSummaryCandidate("Updated artifacts and validated output successfully.")).toBe(true);
    expect(isEnglishSummaryCandidate("Слайды обновлены успешно.")).toBe(false);
  });

  it("extracts English status fallback when direct summary is non-English", () => {
    const summary = extractEnglishSummaryFromRecord({
      summary: "Результат сформирован.",
      workflow_status: "PASS",
      next_action: "continue"
    });

    expect(summary).toBe("workflow=PASS | next=continue");
  });

  it("builds English fallback summary from arbitrary non-English output", () => {
    const summary = buildEnglishSummaryFromOutput("Задача выполнена.");
    expect(summary).toBe("Step completed. Output generated.");
  });

  it("extracts status summary from text markers", () => {
    const summary = extractStatusSummaryFromText("WORKFLOW_STATUS: PASS\nNEXT_ACTION: continue");
    expect(summary).toBe("workflow=PASS | next=continue");
  });
});
