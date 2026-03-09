import { describe, expect, it, vi } from "vitest";

import { registerProviderRoutes } from "../../server/http/routes/pipelines/registerProviderRoutes.js";
import type { ProviderOAuthStatus } from "../../server/oauth.js";
import { createRouteHarness, invokeRoute } from "../helpers/routeHarness.js";
import { createTempStore } from "../helpers/tempStore.js";

const VALID_SETUP_TOKEN =
  "sk-ant-oat01-rotated-test-fixture-do-not-use-2026-03-02-ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789abcdefghijk";

function buildStatus(providerId: "openai" | "claude"): ProviderOAuthStatus {
  return {
    providerId,
    loginSource: providerId === "openai" ? "codex-cli" : "claude-cli",
    cliCommand: providerId === "openai" ? "codex" : "claude",
    cliAvailable: true,
    loggedIn: false,
    tokenAvailable: false,
    canUseApi: false,
    canUseCli: false,
    checkedAt: "2026-02-26T03:00:00.000Z",
    message: "Not logged in."
  };
}

describe("Provider OAuth Routes", () => {
  it("submits browser authorization code to backend OAuth session", async () => {
    const { app, route } = createRouteHarness();
    const { store, cleanup } = await createTempStore();

    const submitProviderOAuthCode = vi.fn(async () => ({
      providerId: "claude" as const,
      accepted: true,
      message: "Authorization code submitted."
    }));
    const getProviderOAuthStatus = vi.fn(async () => buildStatus("claude"));

    try {
      registerProviderRoutes(app as never, {
        store,
        getProviderOAuthStatus,
        probeOpenAiApiCredential: vi.fn(),
        submitProviderOAuthCode,
        startProviderOAuthLogin: vi.fn(),
        syncProviderOAuthToken: vi.fn()
      } as never);

      const handler = route("POST", "/api/providers/:providerId/oauth/submit-code");
      const response = await invokeRoute(handler, {
        method: "POST",
        params: { providerId: "claude" },
        body: { code: "abc-123" }
      });

      expect(response.statusCode).toBe(202);
      expect(response.body).toEqual({
        result: {
          providerId: "claude",
          accepted: true,
          message: "Authorization code submitted."
        },
        status: buildStatus("claude")
      });
      expect(submitProviderOAuthCode).toHaveBeenCalledWith("claude", "abc-123");
      expect(getProviderOAuthStatus).toHaveBeenCalledWith("claude");
    } finally {
      await cleanup();
    }
  });

  it("rejects empty authorization code payload", async () => {
    const { app, route } = createRouteHarness();
    const { store, cleanup } = await createTempStore();
    const submitProviderOAuthCode = vi.fn();

    try {
      registerProviderRoutes(app as never, {
        store,
        getProviderOAuthStatus: vi.fn(async () => buildStatus("claude")),
        probeOpenAiApiCredential: vi.fn(),
        submitProviderOAuthCode,
        startProviderOAuthLogin: vi.fn(),
        syncProviderOAuthToken: vi.fn()
      } as never);

      const handler = route("POST", "/api/providers/:providerId/oauth/submit-code");
      const response = await invokeRoute(handler, {
        method: "POST",
        params: { providerId: "claude" },
        body: { code: "" }
      });

      expect(response.statusCode).toBe(400);
      expect(response.body).toEqual(
        expect.objectContaining({
          error: "Validation failed"
        })
      );
      expect(submitProviderOAuthCode).not.toHaveBeenCalled();
    } finally {
      await cleanup();
    }
  });

  it("marks Claude OAuth as API-ready when setup-token is stored in dashboard", async () => {
    const { app, route } = createRouteHarness();
    const { store, cleanup } = await createTempStore();

    try {
      store.upsertProvider("claude", {
        authMode: "oauth",
        oauthToken: VALID_SETUP_TOKEN
      });

      registerProviderRoutes(app as never, {
        store,
        getProviderOAuthStatus: vi.fn(async () => ({
          ...buildStatus("claude"),
          runtimeProbe: {
            status: "fail",
            message: "Claude CLI is not logged in.",
            checkedAt: "2026-02-26T03:00:01.000Z"
          }
        })),
        probeOpenAiApiCredential: vi.fn(),
        submitProviderOAuthCode: vi.fn(),
        startProviderOAuthLogin: vi.fn(),
        syncProviderOAuthToken: vi.fn()
      } as never);

      const handler = route("GET", "/api/providers/:providerId/oauth/status");
      const response = await invokeRoute(handler, {
        method: "GET",
        params: { providerId: "claude" }
      });

      expect(response.statusCode).toBe(200);
      expect(response.body.status).toEqual(
        expect.objectContaining({
          providerId: "claude",
          tokenAvailable: true,
          canUseApi: true,
          message: "Setup token is stored in dashboard. Save changes and run once to validate token-based API auth."
        })
      );
      expect(response.body.status.runtimeProbe).toEqual(
        expect.objectContaining({
          status: "pass",
          message: "Setup token is stored in dashboard. API path will be validated on first request."
        })
      );
    } finally {
      await cleanup();
    }
  });

  it("surfaces undecryptable stored Claude setup-token as disconnected", async () => {
    const { app, route } = createRouteHarness();
    const { store, cleanup } = await createTempStore();

    try {
      store.upsertProvider("claude", {
        authMode: "oauth",
        oauthToken: "enc:v1:broken.iv.payload"
      });

      registerProviderRoutes(app as never, {
        store,
        getProviderOAuthStatus: vi.fn(async () => buildStatus("claude")),
        probeOpenAiApiCredential: vi.fn(),
        submitProviderOAuthCode: vi.fn(),
        startProviderOAuthLogin: vi.fn(),
        syncProviderOAuthToken: vi.fn()
      } as never);

      const handler = route("GET", "/api/providers/:providerId/oauth/status");
      const response = await invokeRoute(handler, {
        method: "GET",
        params: { providerId: "claude" }
      });

      expect(response.statusCode).toBe(200);
      expect(response.body.status).toEqual(
        expect.objectContaining({
          providerId: "claude",
          tokenAvailable: false,
          canUseApi: false,
          message:
            "Stored setup token cannot be decrypted. Keep DASHBOARD_SECRETS_KEY stable and persist backend data volume, then reconnect."
        })
      );
    } finally {
      await cleanup();
    }
  });

  it("does not mark non-setup Claude OAuth value as API-ready", async () => {
    const { app, route } = createRouteHarness();
    const { store, cleanup } = await createTempStore();

    try {
      store.upsertProvider("claude", {
        authMode: "oauth",
        oauthToken: "XADbhD5WjGH0ORuYcWlealQ#QouSHToVDbDZTQDEMnhGk88"
      });

      registerProviderRoutes(app as never, {
        store,
        getProviderOAuthStatus: vi.fn(async () => buildStatus("claude")),
        probeOpenAiApiCredential: vi.fn(),
        submitProviderOAuthCode: vi.fn(),
        startProviderOAuthLogin: vi.fn(),
        syncProviderOAuthToken: vi.fn()
      } as never);

      const handler = route("GET", "/api/providers/:providerId/oauth/status");
      const response = await invokeRoute(handler, {
        method: "GET",
        params: { providerId: "claude" }
      });

      expect(response.statusCode).toBe(200);
      expect(response.body.status).toEqual(
        expect.objectContaining({
          providerId: "claude",
          tokenAvailable: false,
          canUseApi: false,
          message:
            "Stored OAuth value is not a Claude setup-token. Browser Authentication Code cannot be saved here. Paste setup-token (sk-ant-oat01-...) and save."
        })
      );
    } finally {
      await cleanup();
    }
  });

  it("keeps connected status when CLI auth is active but stored value is not setup-token", async () => {
    const { app, route } = createRouteHarness();
    const { store, cleanup } = await createTempStore();

    try {
      store.upsertProvider("claude", {
        authMode: "oauth",
        oauthToken: "XADbhD5WjGH0ORuYcWlealQ#QouSHToVDbDZTQDEMnhGk88"
      });

      registerProviderRoutes(app as never, {
        store,
        getProviderOAuthStatus: vi.fn(async () => ({
          ...buildStatus("claude"),
          loggedIn: true,
          canUseCli: true
        })),
        probeOpenAiApiCredential: vi.fn(),
        submitProviderOAuthCode: vi.fn(),
        startProviderOAuthLogin: vi.fn(),
        syncProviderOAuthToken: vi.fn()
      } as never);

      const handler = route("GET", "/api/providers/:providerId/oauth/status");
      const response = await invokeRoute(handler, {
        method: "GET",
        params: { providerId: "claude" }
      });

      expect(response.statusCode).toBe(200);
      expect(response.body.status).toEqual(
        expect.objectContaining({
          providerId: "claude",
          loggedIn: true,
          canUseCli: true,
          canUseApi: false,
          message:
            "Stored OAuth value is not a Claude setup-token. CLI auth is connected; API token fallback is unavailable. Paste setup-token (sk-ant-oat01-...) and save."
        })
      );
    } finally {
      await cleanup();
    }
  });

  it("rejects saving Claude OAuth token when value is browser Authentication Code", async () => {
    const { app, route } = createRouteHarness();
    const { store, cleanup } = await createTempStore();

    try {
      registerProviderRoutes(app as never, {
        store,
        getProviderOAuthStatus: vi.fn(async () => buildStatus("claude")),
        probeOpenAiApiCredential: vi.fn(),
        submitProviderOAuthCode: vi.fn(),
        startProviderOAuthLogin: vi.fn(),
        syncProviderOAuthToken: vi.fn()
      } as never);

      const handler = route("PUT", "/api/providers/:providerId");
      const response = await invokeRoute(handler, {
        method: "PUT",
        params: { providerId: "claude" },
        body: {
          authMode: "oauth",
          oauthToken: "XADbhD5WjGH0ORuYcWlealQ#QouSHToVDbDZTQDEMnhGk88"
        }
      });

      expect(response.statusCode).toBe(400);
      expect(response.body).toEqual(
        expect.objectContaining({
          error:
            "Anthropic OAuth token must be Claude setup-token (sk-ant-oat01-...). Browser Authentication Code cannot be saved here."
        })
      );
    } finally {
      await cleanup();
    }
  });

  it("marks stored OpenAI OAuth token as disconnected when runtime validation fails", async () => {
    const { app, route } = createRouteHarness();
    const { store, cleanup } = await createTempStore();

    try {
      store.upsertProvider("openai", {
        authMode: "oauth",
        oauthToken: "stored-openai-token"
      });

      registerProviderRoutes(app as never, {
        store,
        getProviderOAuthStatus: vi.fn(async () => ({
          ...buildStatus("openai"),
          loggedIn: true,
          tokenAvailable: true,
          canUseApi: true,
          canUseCli: true,
          message: "Logged in via ChatGPT. Cached access token is available for import."
        })),
        probeOpenAiApiCredential: vi.fn(async () => ({
          status: "fail" as const,
          message: "OpenAI API token expired. Refresh OpenAI OAuth or save a fresh API key.",
          checkedAt: "2026-03-06T00:00:00.000Z"
        })),
        submitProviderOAuthCode: vi.fn(),
        startProviderOAuthLogin: vi.fn(),
        syncProviderOAuthToken: vi.fn()
      } as never);

      const handler = route("GET", "/api/providers/:providerId/oauth/status");
      const response = await invokeRoute(handler, {
        method: "GET",
        params: { providerId: "openai" },
        query: { deep: "1" }
      });

      expect(response.statusCode).toBe(200);
      expect(response.body.status).toEqual(
        expect.objectContaining({
          providerId: "openai",
          tokenAvailable: false,
          canUseApi: false,
          message:
            "Stored OpenAI OAuth token failed runtime validation. OpenAI API token expired. Refresh OpenAI OAuth or save a fresh API key."
        })
      );
      expect(response.body.status.runtimeProbe).toEqual(
        expect.objectContaining({
          status: "fail",
          message: "OpenAI API token expired. Refresh OpenAI OAuth or save a fresh API key."
        })
      );
    } finally {
      await cleanup();
    }
  });

  it("marks stored OpenAI OAuth token as API-ready after runtime validation passes", async () => {
    const { app, route } = createRouteHarness();
    const { store, cleanup } = await createTempStore();

    try {
      store.upsertProvider("openai", {
        authMode: "oauth",
        oauthToken: "stored-openai-token"
      });

      registerProviderRoutes(app as never, {
        store,
        getProviderOAuthStatus: vi.fn(async () => ({
          ...buildStatus("openai"),
          loggedIn: true,
          tokenAvailable: false,
          canUseApi: false,
          canUseCli: true,
          message: "Logged in via ChatGPT. No cached access token found yet."
        })),
        probeOpenAiApiCredential: vi.fn(async () => ({
          status: "pass" as const,
          message: "OpenAI API credential verified.",
          checkedAt: "2026-03-06T00:00:00.000Z",
          latencyMs: 118
        })),
        submitProviderOAuthCode: vi.fn(),
        startProviderOAuthLogin: vi.fn(),
        syncProviderOAuthToken: vi.fn()
      } as never);

      const handler = route("GET", "/api/providers/:providerId/oauth/status");
      const response = await invokeRoute(handler, {
        method: "GET",
        params: { providerId: "openai" },
        query: { deep: "1" }
      });

      expect(response.statusCode).toBe(200);
      expect(response.body.status).toEqual(
        expect.objectContaining({
          providerId: "openai",
          tokenAvailable: true,
          canUseApi: true,
          message: "Stored OpenAI OAuth token is valid and ready for API use."
        })
      );
      expect(response.body.status.runtimeProbe).toEqual(
        expect.objectContaining({
          status: "pass",
          message: "OpenAI API credential verified."
        })
      );
    } finally {
      await cleanup();
    }
  });
});
