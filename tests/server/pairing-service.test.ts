import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { describe, expect, it, vi } from "vitest";

import { PairingError, PairingService } from "../../server/pairing/service.js";

describe("PairingService", () => {
  it("creates, approves, and claims a pairing session", () => {
    const service = new PairingService();
    const created = service.createSession({
      clientName: "Desktop App",
      platform: "macos"
    });

    expect(created.status).toBe("pending");
    expect(created.code).toMatch(/^\d{6}$/);

    const approved = service.approveSession(created.id, created.code, "Moise MacBook");
    expect(approved.status).toBe("approved");
    expect(approved.label).toBe("Moise MacBook");
    expect(approved.approvedAt).toBeDefined();

    const claimed = service.claimSession(created.id, created.code);
    expect(claimed.session.status).toBe("claimed");
    expect(claimed.session.claimedAt).toBeDefined();
    expect(claimed.deviceToken.length).toBeGreaterThan(20);
    expect(service.isDeviceTokenValid(claimed.deviceToken)).toBe(true);
    expect(service.isDeviceTokenValid("invalid-token")).toBe(false);
  });

  it("rejects wrong codes and locks after too many attempts", () => {
    const service = new PairingService();
    const created = service.createSession();

    for (let attempt = 1; attempt <= 8; attempt += 1) {
      let error: unknown;
      try {
        service.approveSession(created.id, "000000");
      } catch (caught) {
        error = caught;
      }
      expect(error).toBeInstanceOf(PairingError);
      expect((error as PairingError).code).toBe("pairing_code_mismatch");
    }

    let lockedError: unknown;
    try {
      service.approveSession(created.id, "000000");
    } catch (caught) {
      lockedError = caught;
    }
    expect(lockedError).toBeInstanceOf(PairingError);
    expect((lockedError as PairingError).code).toBe("pairing_code_locked");
  });

  it("marks sessions as expired after ttl", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-02-24T00:00:00.000Z"));
    try {
      const service = new PairingService();
      const created = service.createSession({
        ttlSeconds: 60
      });
      vi.advanceTimersByTime(61_000);

      const summary = service.getSession(created.id);
      expect(summary?.status).toBe("expired");
      expect(() => service.approveSession(created.id, created.code)).toThrowError(PairingError);
    } finally {
      vi.useRealTimers();
    }
  });

  it("restores claimed sessions from persisted state", async () => {
    const tempDir = await mkdtemp(path.join(tmpdir(), "fyreflow-pairing-tests-"));
    const statePath = path.join(tempDir, "pairing-state.json");

    try {
      const firstService = new PairingService({ statePath });
      const created = firstService.createSession({
        clientName: "Desktop",
        platform: "macos"
      });
      firstService.approveSession(created.id, created.code, "Office Mac");
      const claimed = firstService.claimSession(created.id, created.code);

      const secondService = new PairingService({ statePath });
      expect(secondService.isDeviceTokenValid(claimed.deviceToken)).toBe(true);

      const restored = secondService.getSession(created.id);
      expect(restored?.status).toBe("claimed");
      expect(restored?.claimedAt).toBeDefined();
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });
});
