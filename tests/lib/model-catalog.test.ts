import { describe, expect, it } from "vitest";

import {
  MODEL_CATALOG,
  getDefaultModelForProvider,
  getSelectableModelsForProvider
} from "../../src/lib/modelCatalog";
import type { ProviderConfig, ProviderOAuthStatus } from "../../src/lib/types";
import { MODEL_CATALOG as SERVER_MODEL_CATALOG, resolveDefaultModel } from "../../server/modelCatalog";

function duplicateIds(values: string[]): string[] {
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  for (const value of values) {
    if (seen.has(value)) {
      duplicates.add(value);
      continue;
    }
    seen.add(value);
  }
  return [...duplicates];
}

function buildProvider(partial: Partial<ProviderConfig> = {}): ProviderConfig {
  return {
    id: "openai",
    label: "OpenAI / Codex",
    authMode: "oauth",
    apiKey: "",
    oauthToken: "",
    baseUrl: "https://api.openai.com/v1",
    defaultModel: "gpt-5.4",
    updatedAt: "2026-03-05T10:00:00.000Z",
    ...partial
  };
}

function buildStatus(partial: Partial<ProviderOAuthStatus> = {}): ProviderOAuthStatus {
  return {
    providerId: "openai",
    loginSource: "codex-cli",
    cliCommand: "codex",
    cliAvailable: true,
    loggedIn: true,
    tokenAvailable: false,
    canUseApi: false,
    canUseCli: true,
    message: "CLI auth is ready",
    checkedAt: "2026-03-05T10:00:00.000Z",
    ...partial
  };
}

describe("model catalogs", () => {
  it("keeps OpenAI reasoning ladders aligned between frontend and server catalogs", () => {
    const expected: Record<string, string[]> = {
      "gpt-5.4": ["low", "medium", "high", "xhigh"],
      "gpt-5.4-pro": ["medium", "high", "xhigh"],
      "gpt-5.3-codex": ["low", "medium", "high", "xhigh"],
      "gpt-5.2-codex": ["low", "medium", "high", "xhigh"],
      "gpt-5.1-codex-max": ["low", "medium", "high", "xhigh"],
      "gpt-5.1-codex": ["low", "medium", "high"],
      "gpt-5.2": ["low", "medium", "high", "xhigh"],
      "gpt-5.1": ["low", "medium", "high"],
      "gpt-5.1-codex-mini": ["medium", "high"]
    };

    for (const [modelId, reasoningEfforts] of Object.entries(expected)) {
      expect(
        MODEL_CATALOG.openai.find((entry) => entry.id === modelId)?.reasoningEfforts,
        `frontend ladder for ${modelId}`
      ).toEqual(reasoningEfforts);
      expect(
        SERVER_MODEL_CATALOG.openai.find((entry) => entry.id === modelId)?.reasoningEfforts,
        `server ladder for ${modelId}`
      ).toEqual(reasoningEfforts);
    }
  });

  it("keeps OpenAI context window metadata aligned for default and optional 1M models", () => {
    const expected: Record<string, { contextWindowTokens: number; supports1MContext: boolean }> = {
      "gpt-5.4": { contextWindowTokens: 1_050_000, supports1MContext: true },
      "gpt-5.4-pro": { contextWindowTokens: 1_050_000, supports1MContext: true },
      "gpt-5.3-codex": { contextWindowTokens: 272_000, supports1MContext: false },
      "gpt-5.2-codex": { contextWindowTokens: 272_000, supports1MContext: false },
      "gpt-5.1-codex-max": { contextWindowTokens: 272_000, supports1MContext: false },
      "gpt-5.1-codex": { contextWindowTokens: 272_000, supports1MContext: false },
      "gpt-5.2": { contextWindowTokens: 272_000, supports1MContext: false },
      "gpt-5.1": { contextWindowTokens: 272_000, supports1MContext: false },
      "gpt-5.1-codex-mini": { contextWindowTokens: 272_000, supports1MContext: false }
    };

    for (const [modelId, metadata] of Object.entries(expected)) {
      expect(
        MODEL_CATALOG.openai.find((entry) => entry.id === modelId),
        `frontend metadata for ${modelId}`
      ).toMatchObject(metadata);
      expect(
        SERVER_MODEL_CATALOG.openai.find((entry) => entry.id === modelId),
        `server metadata for ${modelId}`
      ).toMatchObject(metadata);
    }
  });

  it("removes the superseded first-generation and manual-only OpenAI entries from the catalog", () => {
    const removedModelIds = ["gpt-5", "gpt-5-codex", "gpt-5-codex-mini", "gpt-5.2-spark", "gpt-5.2-codex-sonic"];

    for (const modelId of removedModelIds) {
      expect(MODEL_CATALOG.openai.some((entry) => entry.id === modelId), `frontend catalog contains ${modelId}`).toBe(false);
      expect(SERVER_MODEL_CATALOG.openai.some((entry) => entry.id === modelId), `server catalog contains ${modelId}`).toBe(false);
    }
  });

  it("hides API-only and legacy OpenAI models from CLI-only selectors", () => {
    const ids = getSelectableModelsForProvider("openai", {
      provider: buildProvider({ authMode: "oauth", oauthToken: "" }),
      oauthStatus: buildStatus({ canUseApi: false, canUseCli: true })
    }).map((entry) => entry.id);

    expect(ids).toEqual(["gpt-5.4"]);
  });

  it("shows gpt-5.4-pro when an OpenAI API-capable path exists", () => {
    const ids = getSelectableModelsForProvider("openai", {
      provider: buildProvider({ authMode: "api_key", apiKey: "sk-openai-test" })
    }).map((entry) => entry.id);

    expect(ids).toContain("gpt-5.4-pro");
  });

  it("hides gpt-5.4-pro when API Key mode is selected but no active API credential exists yet", () => {
    const ids = getSelectableModelsForProvider("openai", {
      provider: buildProvider({ authMode: "api_key", apiKey: "", oauthToken: "" }),
      oauthStatus: buildStatus({ canUseApi: true, canUseCli: true })
    }).map((entry) => entry.id);

    expect(ids).not.toContain("gpt-5.4-pro");
    expect(ids).toContain("gpt-5.4");
  });

  it("hides gpt-5.4-pro when only a masked OpenAI OAuth token exists but runtime validation failed", () => {
    const ids = getSelectableModelsForProvider("openai", {
      provider: buildProvider({ authMode: "oauth", oauthToken: "[secure]" }),
      oauthStatus: buildStatus({
        canUseApi: false,
        canUseCli: true,
        runtimeProbe: {
          status: "fail",
          message: "OpenAI API token expired.",
          checkedAt: "2026-03-06T00:00:00.000Z"
        }
      })
    }).map((entry) => entry.id);

    expect(ids).not.toContain("gpt-5.4-pro");
  });

  it("shows gpt-5.4-pro when OAuth runtime validation passed", () => {
    const ids = getSelectableModelsForProvider("openai", {
      provider: buildProvider({ authMode: "oauth", oauthToken: "[secure]" }),
      oauthStatus: buildStatus({
        canUseApi: true,
        canUseCli: true,
        runtimeProbe: {
          status: "pass",
          message: "OpenAI API credential verified.",
          checkedAt: "2026-03-06T00:00:00.000Z"
        }
      })
    }).map((entry) => entry.id);

    expect(ids).toContain("gpt-5.4-pro");
  });

  it("can preserve a current hidden model while provider settings are being corrected", () => {
    const ids = getSelectableModelsForProvider("openai", {
      provider: buildProvider({ authMode: "oauth", oauthToken: "" }),
      oauthStatus: buildStatus({ canUseApi: false, canUseCli: true }),
      currentModelId: "gpt-5.1"
    }).map((entry) => entry.id);

    expect(ids).toContain("gpt-5.1");
    expect(ids).not.toContain("gpt-5.4-pro");
  });

  it("hides older Claude generations from curated selectors", () => {
    const ids = getSelectableModelsForProvider("claude", {
      provider: {
        ...buildProvider({
          id: "claude",
          label: "Anthropic",
          authMode: "api_key",
          baseUrl: "https://api.anthropic.com/v1",
          defaultModel: "claude-sonnet-4-6"
        }),
        apiKey: "sk-ant-test"
      }
    }).map((entry) => entry.id);

    expect(ids).toEqual(["claude-sonnet-4-6", "claude-opus-4-6", "claude-haiku-4-5"]);
  });

  it("keeps Claude fast-mode metadata aligned between catalogs", () => {
    expect(MODEL_CATALOG.claude.find((entry) => entry.id === "claude-sonnet-4-6")?.supportsFastMode).toBe(false);
    expect(SERVER_MODEL_CATALOG.claude.find((entry) => entry.id === "claude-sonnet-4-6")?.supportsFastMode).toBe(false);
    expect(MODEL_CATALOG.claude.find((entry) => entry.id === "claude-opus-4-6")?.supportsFastMode).toBe(true);
    expect(SERVER_MODEL_CATALOG.claude.find((entry) => entry.id === "claude-opus-4-6")?.supportsFastMode).toBe(true);
    expect(MODEL_CATALOG.claude.find((entry) => entry.id === "claude-haiku-4-5")?.supportsFastMode).toBe(false);
    expect(SERVER_MODEL_CATALOG.claude.find((entry) => entry.id === "claude-haiku-4-5")?.supportsFastMode).toBe(false);
  });

  it("keeps frontend provider model ids unique", () => {
    for (const [providerId, entries] of Object.entries(MODEL_CATALOG)) {
      expect(duplicateIds(entries.map((entry) => entry.id)), `duplicate ids for ${providerId}`).toEqual([]);
    }
  });

  it("keeps server provider model ids unique", () => {
    for (const [providerId, entries] of Object.entries(SERVER_MODEL_CATALOG)) {
      expect(
        duplicateIds(entries.map((entry) => entry.id)),
        `duplicate ids for ${providerId}`
      ).toEqual([]);
    }
  });

  it("keeps gpt-5.4 as the OpenAI default model", () => {
    expect(getDefaultModelForProvider("openai")).toBe("gpt-5.4");
    expect(resolveDefaultModel("openai")).toBe("gpt-5.4");
  });
});
