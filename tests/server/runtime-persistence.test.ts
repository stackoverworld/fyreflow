import { describe, expect, it } from "vitest";
import {
  evaluatePersistenceStatus,
  hasDedicatedMountForPath,
  parseMountPointsFromMountInfo
} from "../../server/runtime/persistence.js";

const MOUNTINFO_WITH_APP_DATA_VOLUME = [
  "2504 2485 0:193 / / rw,relatime - overlay overlay rw",
  "2529 2504 0:496 / /app/data rw,nosuid,nodev - ext4 /dev/vdb rw,relatime"
].join("\n");

describe("runtime persistence diagnostics", () => {
  it("parses mount points from /proc/self/mountinfo format", () => {
    const mountInfo = [
      "48 27 0:44 / / rw,relatime - overlay overlay rw",
      "49 48 0:50 /with\\040space /var/lib/data rw,relatime - ext4 /dev/vdb rw"
    ].join("\n");
    const mountPoints = parseMountPointsFromMountInfo(mountInfo);
    expect(mountPoints).toContain("/");
    expect(mountPoints).toContain("/var/lib/data");
  });

  it("detects whether target path is on dedicated mount", () => {
    expect(hasDedicatedMountForPath("/app/data", ["/"])).toBe(false);
    expect(hasDedicatedMountForPath("/app/data/local-db.json", ["/", "/app/data"])).toBe(true);
    expect(hasDedicatedMountForPath("/app/data", [])).toBeNull();
  });

  it("warns in remote mode when secrets key is missing and data dir is not mounted", () => {
    const status = evaluatePersistenceStatus({
      mode: "remote",
      env: {
        FYREFLOW_DATA_DIR: "/app/data"
      },
      runningInContainer: true,
      mountInfoRaw: "1 0 0:1 / / rw,relatime - overlay overlay rw"
    });

    expect(status.status).toBe("warn");
    expect(status.dataDir).toBe("/app/data");
    expect(status.secretsKeyConfigured).toBe(false);
    expect(status.dedicatedVolumeMounted).toBe(false);
    expect(status.issues).toHaveLength(2);
  });

  it("passes when remote deployment has stable key and dedicated data mount", () => {
    const status = evaluatePersistenceStatus({
      mode: "remote",
      env: {
        FYREFLOW_DATA_DIR: "/app/data",
        DASHBOARD_SECRETS_KEY: "stable-secrets-key"
      },
      runningInContainer: true,
      mountInfoRaw: MOUNTINFO_WITH_APP_DATA_VOLUME
    });

    expect(status.status).toBe("pass");
    expect(status.secretsKeyConfigured).toBe(true);
    expect(status.dedicatedVolumeMounted).toBe(true);
    expect(status.issues).toEqual([]);
  });
});
