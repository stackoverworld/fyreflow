import { describe, expect, it } from "vitest";

import {
  getActiveApiBaseUrlField,
  getApiTokenSourceHint,
  getRemoteAuthErrorMessage,
  getPairingRealtimeErrorMessage
} from "../../src/components/dashboard/remotePairingSettingsModel";

describe("remote pairing settings model", () => {
  it("returns local endpoint field for local mode", () => {
    const field = getActiveApiBaseUrlField({
      mode: "local",
      localApiBaseUrl: "http://localhost:8787",
      remoteApiBaseUrl: "https://remote.example.com"
    });

    expect(field.label).toBe("Local API base URL");
    expect(field.placeholder).toBe("http://localhost:8787");
    expect(field.value).toBe("http://localhost:8787");
  });

  it("returns remote endpoint field for remote mode", () => {
    const field = getActiveApiBaseUrlField({
      mode: "remote",
      localApiBaseUrl: "http://localhost:8787",
      remoteApiBaseUrl: "https://remote.example.com"
    });

    expect(field.label).toBe("Remote API base URL");
    expect(field.placeholder).toBe("https://your-app.up.railway.app");
    expect(field.value).toBe("https://remote.example.com");
  });

  it("provides token source hint per mode", () => {
    expect(getApiTokenSourceHint("local")).toContain(".env");
    expect(getApiTokenSourceHint("remote")).toContain("Railway");
    expect(getApiTokenSourceHint("remote")).toContain("DASHBOARD_API_TOKEN");
  });

  it("maps unauthorized errors to actionable auth guidance", () => {
    expect(getRemoteAuthErrorMessage("Unauthorized", "connection")).toContain("Connection auth token");
    expect(getRemoteAuthErrorMessage("401 Unauthorized", "pairingAdmin")).toContain("step 1 (Approve)");
    expect(getRemoteAuthErrorMessage("Network error", "connection")).toBe("Network error");
  });

  it("normalizes realtime close errors into actionable text", () => {
    const message = getPairingRealtimeErrorMessage(
      "Pairing realtime stream closed before subscription was established."
    );

    expect(message).toContain("Session created");
    expect(message).toContain("1) Approve Device");
    expect(message).toContain("2) Claim Token");
  });
});
