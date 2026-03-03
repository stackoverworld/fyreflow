import { expect, test, type Page } from "@playwright/test";

import { mockDashboardApi } from "./support/mockDashboardApi";

const AI_CHAT_STORAGE_PREFIX = "fyreflow:ai-chat:";

function runToolbarPrimaryButton(page: Page) {
  return page.getByRole("button", { name: /Smart Run|Quick Run|Run/ }).first();
}

const REMOTE_CONNECTION_SETTINGS = {
  mode: "remote",
  localApiBaseUrl: "http://localhost:8787",
  remoteApiBaseUrl: "https://remote.example.com",
  apiToken: "remote-token",
  realtimePath: "/api/ws",
  deviceToken: ""
} as const;

function buildAiChatHistory(messageCount: number) {
  const baseTimestamp = Date.parse("2026-03-04T20:00:00.000Z");
  return Array.from({ length: messageCount }, (_, index) => {
    const role = index % 2 === 0 ? "user" : "assistant";
    return {
      id: `seed-msg-${index + 1}`,
      role,
      content: `${role} seeded message ${index + 1}`,
      timestamp: baseTimestamp + index * 1000
    };
  });
}

test.describe("Critical AI Regression Flows", () => {
  test("AI builder can update the active flow draft", async ({ page }) => {
    await mockDashboardApi(page, {
      aiGeneratedFlowName: "AI Regression Flow"
    });

    await page.goto("/");
    await expect(runToolbarPrimaryButton(page)).toBeVisible();

    await page.getByRole("button", { name: "AI builder" }).click();
    await page.getByRole("button", { name: "Agent" }).click();
    await page
      .getByPlaceholder(/Describe changes to apply to the flow|Ask a question about the current flow/)
      .fill(
      "Upgrade this flow for robust AI regression checks."
      );
    await page.getByRole("button", { name: "Send" }).click();

    await expect(page.getByText("Updated the flow with deterministic AI regression coverage.")).toBeVisible();
    await expect(page.getByText("AI updated the current flow from chat.")).toBeVisible();

    await page.getByRole("button", { name: "Flow settings" }).click();
    await expect(page.getByLabel("Flow name")).toHaveValue("AI Regression Flow");
  });

  test("AI builder can re-apply an older flow update snapshot", async ({ page }) => {
    await mockDashboardApi(page, {
      aiGeneratedFlowNames: ["AI Regression Flow v1", "AI Regression Flow v2"]
    });

    await page.goto("/");
    await expect(runToolbarPrimaryButton(page)).toBeVisible();

    await page.getByRole("button", { name: "AI builder" }).click();
    await page.getByRole("button", { name: "Agent" }).click();
    const promptInput = page.getByPlaceholder(/Describe changes to apply to the flow|Ask a question about the current flow/);

    await promptInput.fill("Apply revision one to this flow.");
    await page.getByRole("button", { name: "Send" }).click();
    await expect(page.getByRole("button", { name: "Re-apply" })).toHaveCount(1);

    await promptInput.fill("Apply revision two to this flow.");
    await page.getByRole("button", { name: "Send" }).click();
    await expect(page.getByRole("button", { name: "Re-apply" })).toHaveCount(2);

    await page.getByRole("button", { name: "Flow settings" }).click();
    await expect(page.getByLabel("Flow name")).toHaveValue("AI Regression Flow v2");

    await page.getByRole("button", { name: "AI builder" }).click();
    await page.getByRole("button", { name: "Re-apply" }).first().click();
    await page.getByRole("button", { name: "Flow settings" }).click();
    await expect(page.getByLabel("Flow name")).toHaveValue("AI Regression Flow v1");
  });

  test("AI builder auto-loads older messages at top and Latest returns to exact bottom", async ({ page }) => {
    const seededHistory = buildAiChatHistory(72);
    await page.addInitScript(
      ({ history, storageKey }) => {
        window.localStorage.setItem(storageKey, JSON.stringify(history));
      },
      {
        history: seededHistory,
        storageKey: `${AI_CHAT_STORAGE_PREFIX}pipeline-default`
      }
    );

    await mockDashboardApi(page);
    await page.goto("/");
    await expect(runToolbarPrimaryButton(page)).toBeVisible();

    await page.getByRole("button", { name: "AI builder" }).click();
    const chatScroll = page.getByTestId("ai-builder-chat-scroll");
    await expect(chatScroll).toBeVisible();

    await expect(page.getByText("assistant seeded message 20")).toHaveCount(0);

    await chatScroll.evaluate((element) => {
      element.scrollTop = 0;
      element.dispatchEvent(new Event("scroll"));
    });

    await expect(page.getByText("assistant seeded message 20")).toHaveCount(1);
    const latestButton = page.getByTestId("ai-builder-chat-latest");
    await expect(latestButton).toBeVisible();
    await latestButton.click();

    await expect
      .poll(async () => {
        return chatScroll.evaluate((element) => element.scrollHeight - element.scrollTop - element.clientHeight);
      })
      .toBeLessThanOrEqual(2);
  });

  test("run panel starts a smart run and shows run history", async ({ page }) => {
    await mockDashboardApi(page, {
      defaultStepIsolatedStorage: true,
      defaultStepSharedStorage: true
    });

    await page.goto("/");
    await expect(runToolbarPrimaryButton(page)).toBeVisible();

    await page.locator("button:has(svg.lucide-chevron-down)").first().click();
    await page.getByRole("button", { name: "Configure Run..." }).click();
    await expect(page.getByPlaceholder("Describe the task for this run...")).toBeVisible();

    await page.getByPlaceholder("Describe the task for this run...").fill("Validate AI regression harness");
    await page.getByRole("button", { name: /^Start smart run$/i }).click();

    await expect(page.getByText("Flow run started.")).toBeVisible();
    await expect(page.getByText("Current session")).toBeVisible();
    await expect(page.getByText("run-1", { exact: true })).toBeVisible();
    await expect(page.getByText("Shared storage", { exact: true })).toBeVisible();
    await expect(page.locator('[title="/tmp/fyreflow-e2e/shared/pipeline-default"]')).toBeVisible();
    await expect(page.getByText("Isolated storage", { exact: true })).toBeVisible();
    await expect(page.locator('[title="/tmp/fyreflow-e2e/isolated/pipeline-default"]')).toBeVisible();
    const currentSession = page.locator("section", { hasText: "Current session" }).first();
    await currentSession.locator("summary", { hasText: "Per-step folders (1)" }).click();
    await expect(currentSession.getByText("1. Analysis Bot", { exact: true })).toBeVisible();
    await expect(currentSession.locator('[title="/tmp/fyreflow-e2e/isolated/pipeline-default/step-1"]')).toBeVisible();
    await expect(page.getByText("Run folder", { exact: true })).toBeVisible();
    await expect(page.locator('[title="/tmp/fyreflow-e2e/runs/run-1"]')).toBeVisible();
    await page.getByRole("button", { name: "History" }).click();
    const historySection = page.locator("section", { hasText: "Active" }).first();
    await expect(historySection.getByText("Validate AI regression harness")).toBeVisible();
    await expect(historySection.getByText("queued")).toBeVisible();
  });

  test("run panel hides isolated storage section when no step has isolation enabled", async ({ page }) => {
    await mockDashboardApi(page, {
      defaultStepIsolatedStorage: false,
      defaultStepSharedStorage: true
    });

    await page.goto("/");
    await expect(runToolbarPrimaryButton(page)).toBeVisible();

    await page.locator("button:has(svg.lucide-chevron-down)").first().click();
    await page.getByRole("button", { name: "Configure Run..." }).click();
    await expect(page.getByPlaceholder("Describe the task for this run...")).toBeVisible();

    await page.getByPlaceholder("Describe the task for this run...").fill("Run without isolated storage");
    await page.getByRole("button", { name: /^Start smart run$/i }).click();

    const currentSession = page.locator("section", { hasText: "Current session" }).first();
    await expect(currentSession.getByText("Isolated storage", { exact: true })).toHaveCount(0);
  });

  test("provider auth settings can be saved from Settings modal", async ({ page }) => {
    await mockDashboardApi(page);

    await page.goto("/");
    await expect(page.getByRole("button", { name: "Settings", exact: true })).toBeVisible();

    await page.getByRole("button", { name: "Settings", exact: true }).click();
    await expect(page.getByRole("dialog", { name: "Settings" })).toBeVisible();

    await page.getByRole("button", { name: "Provider Auth" }).click();
    const openAiSection = page.getByTestId("provider-settings-openai");
    await openAiSection.getByLabel("Base URL").fill("https://api.openai.com/v1/mock");
    await openAiSection.getByRole("button", { name: "Save changes" }).click();

    await expect(page.getByText("OpenAI / Codex settings saved.")).toBeVisible();
  });

  test("provider connect opens a pairing link in remote mode", async ({ page, context }) => {
    await page.addInitScript((connectionSettings) => {
      window.localStorage.setItem("fyreflow:connection-settings", JSON.stringify(connectionSettings));
    }, REMOTE_CONNECTION_SETTINGS);

    await mockDashboardApi(page, {
      defaultProviderAuthMode: "oauth"
    });

    await page.goto("/");
    await expect(page.getByRole("button", { name: "Settings", exact: true })).toBeVisible();

    await page.getByRole("button", { name: "Settings", exact: true }).click();
    await expect(page.getByRole("dialog", { name: "Settings" })).toBeVisible();
    await page.getByRole("button", { name: "Provider Auth" }).click();
    await page.getByRole("button", { name: "OpenAI", exact: true }).click();

    const popupPromise = context.waitForEvent("page");
    const openAiSection = page.getByTestId("provider-settings-openai");
    await openAiSection.getByRole("button", { name: /^(Connect|Reconnect)( CLI)?$/i }).click();

    const popup = await popupPromise;
    await popup.waitForLoadState("domcontentloaded");
    await expect(popup).toHaveURL(/chatgpt\.com\/device\?pairing=mock-session/i);
    await popup.close();
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
