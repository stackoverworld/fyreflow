import { describe, expect, it } from "vitest";
import { panelRoutes, getPanelTitle } from "../../src/app/shell/routes/config.tsx";
import { canActivatePanel } from "../../src/app/shell/routes/guards.ts";

describe("files panel routing", () => {
  it("registers files panel route and title", () => {
    const filesRoute = panelRoutes.find((route) => route.key === "files");
    expect(filesRoute).toBeDefined();
    expect(filesRoute?.path).toBe("/files");
    expect(getPanelTitle("files")).toBe("Files");
  });

  it("allows activating files panel by guard", () => {
    expect(canActivatePanel("files", { debugEnabled: false })).toBe(true);
  });
});
