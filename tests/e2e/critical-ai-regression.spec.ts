import { expect, test } from "@playwright/test";

import { mockDashboardApi } from "./support/mockDashboardApi";

test.describe("Critical AI Regression Flows", () => {
  test("AI builder can update the active flow draft", async ({ page }) => {
    await mockDashboardApi(page, {
      aiGeneratedFlowName: "AI Regression Flow"
    });

    await page.goto("/");
    await expect(page.getByRole("button", { name: "Run" })).toBeVisible();

    await page.getByRole("button", { name: "AI builder" }).click();
    await page.getByPlaceholder("Ask about the current flow or request updates/rebuild...").fill(
      "Upgrade this flow for robust AI regression checks."
    );
    await page.getByRole("button", { name: "Send" }).click();

    await expect(page.getByText("Updated the flow with deterministic AI regression coverage.")).toBeVisible();
    await expect(page.getByText("AI updated the current flow from chat.")).toBeVisible();

    await page.getByRole("button", { name: "Flow settings" }).click();
    await expect(page.getByLabel("Flow name")).toHaveValue("AI Regression Flow");
  });

  test("run panel starts a smart run and shows run history", async ({ page }) => {
    await mockDashboardApi(page);

    await page.goto("/");
    await expect(page.getByRole("button", { name: "Run" })).toBeVisible();

    await page.getByRole("button", { name: "Run" }).click();
    await expect(page.getByText("Recent runs")).toBeVisible();

    await page.getByPlaceholder("Describe the task for this run...").fill("Validate AI regression harness");
    await page.getByRole("button", { name: "Start smart run" }).click();

    await expect(page.getByText("Flow run started.")).toBeVisible();
    const historySection = page.locator("section", { hasText: "Recent runs" });
    await expect(historySection.getByText("Validate AI regression harness")).toBeVisible();
    await expect(historySection.getByText("queued")).toBeVisible();
  });

  test("provider auth settings can be saved from Settings modal", async ({ page }) => {
    await mockDashboardApi(page);

    await page.goto("/");
    await expect(page.getByRole("button", { name: "Settings", exact: true })).toBeVisible();

    await page.getByRole("button", { name: "Settings", exact: true }).click();
    await expect(page.getByRole("dialog", { name: "Settings" })).toBeVisible();

    await page.getByRole("button", { name: "Provider Auth" }).click();
    const openAiSection = page.locator("section", { hasText: "OpenAI / Codex" }).first();
    await openAiSection.getByLabel("Base URL").fill("https://api.openai.com/v1/mock");
    await openAiSection.getByRole("button", { name: "Save" }).click();

    await expect(page.getByText("OpenAI / Codex settings saved.")).toBeVisible();
  });

  test("new flow can be created and deleted through the left panel", async ({ page }) => {
    await mockDashboardApi(page);

    await page.goto("/");
    await expect(page.getByRole("button", { name: "Flows" })).toBeVisible();

    await page.getByRole("button", { name: "Flows" }).click();
    await page.getByRole("button", { name: "New flow" }).click();

    await expect(page.getByText("Drafting a new flow.")).toBeVisible();
    await expect(page.getByText("Flow settings")).toBeVisible();
    await page.getByLabel("Flow name").fill("Regression Flow Alpha");

    await page.getByRole("button", { name: "Flows" }).click();
    const createdFlowRow = page.getByRole("button", { name: /Regression Flow Alpha/ }).first();
    await expect(createdFlowRow).toBeVisible({ timeout: 10000 });

    await createdFlowRow.hover();
    await page.getByRole("button", { name: "Delete Regression Flow Alpha", exact: true }).click();
    await expect(page.getByText("Flow deleted.")).toBeVisible();
    await expect(createdFlowRow).toBeHidden();
  });
});
