import { describe, expect, it } from "vitest";

import { registerPairingRoutes } from "../../server/http/routes/pairing.js";
import { PairingService } from "../../server/pairing/service.js";
import { createRouteHarness, invokeRoute } from "../helpers/routeHarness.js";

describe("Pairing Routes", () => {
  it("creates, approves, claims, and fetches pairing sessions", async () => {
    const { app, route } = createRouteHarness();
    const pairingService = new PairingService();

    registerPairingRoutes(app as never, {
      pairingService,
      realtimePath: "/api/ws",
      apiAuthToken: "admin-token",
      runtimeMode: "remote"
    });

    const createHandler = route("POST", "/api/pairing/sessions");
    const createResponse = await invokeRoute(createHandler, {
      method: "POST",
      path: "/api/pairing/sessions",
      body: {
        clientName: "Desktop",
        platform: "macos",
        ttlSeconds: 120
      }
    });

    const createdPayload = createResponse.body as {
      session: {
        id: string;
        code: string;
        status: string;
        clientName: string;
        platform: string;
        realtimePath: string;
      };
    };
    expect(createResponse.statusCode).toBe(201);
    expect(createdPayload.session.id.length).toBeGreaterThan(10);
    expect(createdPayload.session.code).toMatch(/^\d{6}$/);
    expect(createdPayload.session.status).toBe("pending");
    expect(createdPayload.session.clientName).toBe("Desktop");
    expect(createdPayload.session.platform).toBe("macos");
    expect(createdPayload.session.realtimePath).toBe("/api/ws");

    const getHandler = route("GET", "/api/pairing/sessions/:sessionId");
    const getResponse = await invokeRoute(getHandler, {
      method: "GET",
      path: `/api/pairing/sessions/${createdPayload.session.id}`,
      params: { sessionId: createdPayload.session.id }
    });
    expect(getResponse.statusCode).toBe(200);
    expect((getResponse.body as { session: { status: string } }).session.status).toBe("pending");

    const approveHandler = route("POST", "/api/pairing/sessions/:sessionId/approve");
    const approveResponse = await invokeRoute(approveHandler, {
      method: "POST",
      path: `/api/pairing/sessions/${createdPayload.session.id}/approve`,
      params: { sessionId: createdPayload.session.id },
      headers: {
        authorization: "Bearer admin-token"
      },
      body: {
        code: createdPayload.session.code,
        label: "Work Mac"
      }
    });
    expect(approveResponse.statusCode).toBe(200);
    expect((approveResponse.body as { session: { status: string; label: string } }).session.status).toBe("approved");
    expect((approveResponse.body as { session: { status: string; label: string } }).session.label).toBe("Work Mac");

    const claimHandler = route("POST", "/api/pairing/sessions/:sessionId/claim");
    const claimResponse = await invokeRoute(claimHandler, {
      method: "POST",
      path: `/api/pairing/sessions/${createdPayload.session.id}/claim`,
      params: { sessionId: createdPayload.session.id },
      body: {
        code: createdPayload.session.code
      }
    });
    expect(claimResponse.statusCode).toBe(200);
    const claimPayload = claimResponse.body as {
      session: { status: string };
      deviceToken: string;
    };
    expect(claimPayload.session.status).toBe("claimed");
    expect(claimPayload.deviceToken.length).toBeGreaterThan(20);
  });

  it("rejects claim when session is not approved", async () => {
    const { app, route } = createRouteHarness();
    const pairingService = new PairingService();

    registerPairingRoutes(app as never, {
      pairingService,
      realtimePath: "/api/ws",
      apiAuthToken: "admin-token",
      runtimeMode: "remote"
    });

    const created = pairingService.createSession();
    const claimHandler = route("POST", "/api/pairing/sessions/:sessionId/claim");
    const claimResponse = await invokeRoute(claimHandler, {
      method: "POST",
      path: `/api/pairing/sessions/${created.id}/claim`,
      params: { sessionId: created.id },
      body: {
        code: created.code
      }
    });

    expect(claimResponse.statusCode).toBe(409);
    expect(claimResponse.body).toMatchObject({
      code: "pairing_not_approved"
    });
  });

  it("returns not found for unknown session id", async () => {
    const { app, route } = createRouteHarness();
    const pairingService = new PairingService();

    registerPairingRoutes(app as never, {
      pairingService,
      realtimePath: "/api/ws",
      apiAuthToken: "admin-token",
      runtimeMode: "remote"
    });

    const getHandler = route("GET", "/api/pairing/sessions/:sessionId");
    const getResponse = await invokeRoute(getHandler, {
      method: "GET",
      path: "/api/pairing/sessions/missing-session",
      params: { sessionId: "missing-session" }
    });

    expect(getResponse.statusCode).toBe(404);
    expect(getResponse.body).toEqual({
      error: "Pairing session not found",
      code: "pairing_session_not_found"
    });
  });

  it("validates pairing payloads", async () => {
    const { app, route } = createRouteHarness();
    const pairingService = new PairingService();
    registerPairingRoutes(app as never, {
      pairingService,
      realtimePath: "/api/ws",
      apiAuthToken: "admin-token",
      runtimeMode: "remote"
    });

    const createHandler = route("POST", "/api/pairing/sessions");
    const createResponse = await invokeRoute(createHandler, {
      method: "POST",
      path: "/api/pairing/sessions",
      body: {
        ttlSeconds: 5
      }
    });
    expect(createResponse.statusCode).toBe(400);
    expect(createResponse.body).toMatchObject({
      error: "Validation failed"
    });

    const created = pairingService.createSession();
    const approveHandler = route("POST", "/api/pairing/sessions/:sessionId/approve");
    const approveResponse = await invokeRoute(approveHandler, {
      method: "POST",
      path: `/api/pairing/sessions/${created.id}/approve`,
      params: { sessionId: created.id },
      headers: {
        authorization: "Bearer admin-token"
      },
      body: {}
    });
    expect(approveResponse.statusCode).toBe(400);
    expect(approveResponse.body).toMatchObject({
      error: "Validation failed"
    });
  });

  it("requires admin token for approve in remote mode", async () => {
    const { app, route } = createRouteHarness();
    const pairingService = new PairingService();
    registerPairingRoutes(app as never, {
      pairingService,
      realtimePath: "/api/ws",
      apiAuthToken: "admin-token",
      runtimeMode: "remote"
    });

    const created = pairingService.createSession();
    const approveHandler = route("POST", "/api/pairing/sessions/:sessionId/approve");
    const approveResponse = await invokeRoute(approveHandler, {
      method: "POST",
      path: `/api/pairing/sessions/${created.id}/approve`,
      params: { sessionId: created.id },
      body: {
        code: created.code
      }
    });

    expect(approveResponse.statusCode).toBe(401);
    expect(approveResponse.body).toEqual({
      error: "Unauthorized",
      code: "pairing_admin_unauthorized"
    });
  });

  it("blocks remote approve when admin token is not configured", async () => {
    const { app, route } = createRouteHarness();
    const pairingService = new PairingService();
    registerPairingRoutes(app as never, {
      pairingService,
      realtimePath: "/api/ws",
      apiAuthToken: "",
      runtimeMode: "remote"
    });

    const created = pairingService.createSession();
    const approveHandler = route("POST", "/api/pairing/sessions/:sessionId/approve");
    const approveResponse = await invokeRoute(approveHandler, {
      method: "POST",
      path: `/api/pairing/sessions/${created.id}/approve`,
      params: { sessionId: created.id },
      body: {
        code: created.code
      }
    });

    expect(approveResponse.statusCode).toBe(503);
    expect(approveResponse.body).toEqual({
      error: "Pairing admin actions require DASHBOARD_API_TOKEN in remote mode.",
      code: "pairing_admin_token_missing"
    });
  });
});
