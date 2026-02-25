import { beforeEach, describe, expect, it, vi } from "vitest";

const connectionSettingsMocks = vi.hoisted(() => ({
  getActiveConnectionSettings: vi.fn()
}));

vi.mock("../../src/lib/connectionSettingsStorage.ts", () => ({
  getActiveConnectionSettings: connectionSettingsMocks.getActiveConnectionSettings
}));

import { getClientUpdateRequiredMessage, mapInitialStateLoadErrorMessage } from "../../src/app/state/controller/effects.ts";

describe("loadInitialState error mapping", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns bootstrap guidance for unauthorized remote mode without token", () => {
    connectionSettingsMocks.getActiveConnectionSettings.mockReturnValue({
      mode: "remote",
      apiBaseUrl: "https://fyreflow.example.com",
      apiToken: "",
      realtimePath: "/api/ws",
      deviceToken: ""
    });

    const message = mapInitialStateLoadErrorMessage(new Error("Unauthorized"));
    expect(message).toContain("Remote backend requires authorization");
    expect(message).toContain("Connection auth token");
  });

  it("returns token guidance for unauthorized remote mode with token", () => {
    connectionSettingsMocks.getActiveConnectionSettings.mockReturnValue({
      mode: "remote",
      apiBaseUrl: "https://fyreflow.example.com",
      apiToken: "wrong-token",
      realtimePath: "/api/ws",
      deviceToken: ""
    });

    const message = mapInitialStateLoadErrorMessage(new Error("Unauthorized"));
    expect(message).toContain("rejected current Connection auth token");
  });

  it("passes through non-authorization errors", () => {
    connectionSettingsMocks.getActiveConnectionSettings.mockReturnValue({
      mode: "remote",
      apiBaseUrl: "https://fyreflow.example.com",
      apiToken: "",
      realtimePath: "/api/ws",
      deviceToken: ""
    });

    const message = mapInitialStateLoadErrorMessage(new Error("Network error (GET /api/state): Failed to fetch"));
    expect(message).toBe("Network error (GET /api/state): Failed to fetch");
  });

  it("builds a required-update message from health compatibility payload", () => {
    const message = getClientUpdateRequiredMessage({
      ok: true,
      now: "2026-02-25T12:00:00.000Z",
      client: {
        minimumDesktopVersion: "1.5.0",
        clientVersion: "1.4.0",
        updateRequired: true,
        message: "Backend requires desktop version 1.5.0 or newer.",
        downloadUrl: "https://downloads.example.com/fyreflow"
      }
    });

    expect(message).toContain("Backend requires desktop version 1.5.0 or newer.");
    expect(message).toContain("https://downloads.example.com/fyreflow");
  });

  it("returns null when client version is compatible", () => {
    const message = getClientUpdateRequiredMessage({
      ok: true,
      now: "2026-02-25T12:00:00.000Z",
      client: {
        minimumDesktopVersion: "1.5.0",
        clientVersion: "1.5.1",
        updateRequired: false,
        message: "Client is compatible."
      }
    });

    expect(message).toBeNull();
  });
});
