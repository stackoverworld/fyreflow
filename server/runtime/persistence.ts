import fs from "node:fs";
import path from "node:path";
import { resolveDataRootPath } from "./dataPaths.js";
import type { RuntimeMode } from "./config.js";

const MOUNT_INFO_PATH = "/proc/self/mountinfo";
const CONTAINER_MARKERS = ["/.dockerenv", "/run/.containerenv"];

function decodeMountInfoPath(raw: string): string {
  return raw.replace(/\\([0-7]{3})/g, (_match, octal) => {
    const parsed = Number.parseInt(octal, 8);
    if (!Number.isFinite(parsed)) {
      return "";
    }
    return String.fromCharCode(parsed);
  });
}

function hasPathPrefix(targetPath: string, prefixPath: string): boolean {
  if (targetPath === prefixPath) {
    return true;
  }
  if (prefixPath === path.sep) {
    return true;
  }
  return targetPath.startsWith(`${prefixPath}${path.sep}`);
}

export function parseMountPointsFromMountInfo(raw: string): string[] {
  const lines = raw.split(/\r?\n/).map((line) => line.trim()).filter((line) => line.length > 0);
  const mountPoints = new Set<string>();

  for (const line of lines) {
    const separatorIndex = line.indexOf(" - ");
    if (separatorIndex < 0) {
      continue;
    }

    const left = line.slice(0, separatorIndex).trim();
    const fields = left.split(" ");
    if (fields.length < 5) {
      continue;
    }

    const mountPoint = decodeMountInfoPath(fields[4]);
    if (mountPoint.length === 0) {
      continue;
    }
    mountPoints.add(path.resolve(mountPoint));
  }

  return [...mountPoints];
}

export function hasDedicatedMountForPath(targetPath: string, mountPoints: string[]): boolean | null {
  if (!Array.isArray(mountPoints) || mountPoints.length === 0) {
    return null;
  }

  const normalizedTarget = path.resolve(targetPath);
  let nearestMount: string | null = null;

  for (const mountPoint of mountPoints) {
    const normalizedMount = path.resolve(mountPoint);
    if (!hasPathPrefix(normalizedTarget, normalizedMount)) {
      continue;
    }

    if (!nearestMount || normalizedMount.length > nearestMount.length) {
      nearestMount = normalizedMount;
    }
  }

  if (!nearestMount) {
    return null;
  }

  return nearestMount !== path.sep;
}

function detectContainerRuntime(
  env: NodeJS.ProcessEnv,
  existsSync: (filePath: string) => boolean = fs.existsSync
): boolean {
  if ((env.CONTAINER ?? "").trim().length > 0) {
    return true;
  }

  if ((env.KUBERNETES_SERVICE_HOST ?? "").trim().length > 0) {
    return true;
  }

  for (const markerPath of CONTAINER_MARKERS) {
    try {
      if (existsSync(markerPath)) {
        return true;
      }
    } catch {
      // Ignore marker probe errors.
    }
  }

  return false;
}

function readMountInfoRaw(readFileSync: typeof fs.readFileSync = fs.readFileSync): string | null {
  try {
    return readFileSync(MOUNT_INFO_PATH, "utf8");
  } catch {
    return null;
  }
}

export interface PersistenceStatus {
  status: "pass" | "warn";
  dataDir: string;
  secretsKeyConfigured: boolean;
  runningInContainer: boolean;
  dedicatedVolumeMounted: boolean | null;
  issues: string[];
}

export interface EvaluatePersistenceStatusInput {
  mode: RuntimeMode;
  env?: NodeJS.ProcessEnv;
  cwd?: string;
  runningInContainer?: boolean;
  mountInfoRaw?: string | null;
}

export function evaluatePersistenceStatus(input: EvaluatePersistenceStatusInput): PersistenceStatus {
  const env = input.env ?? process.env;
  const dataDir = resolveDataRootPath(env, input.cwd);
  const secretsKeyConfigured = (env.DASHBOARD_SECRETS_KEY ?? "").trim().length > 0;
  const runningInContainer = input.runningInContainer ?? detectContainerRuntime(env);

  const mountInfoRaw =
    typeof input.mountInfoRaw === "string" || input.mountInfoRaw === null ? input.mountInfoRaw : readMountInfoRaw();
  let dedicatedVolumeMounted: boolean | null = null;
  if (runningInContainer && typeof mountInfoRaw === "string" && mountInfoRaw.trim().length > 0) {
    dedicatedVolumeMounted = hasDedicatedMountForPath(dataDir, parseMountPointsFromMountInfo(mountInfoRaw));
  }

  const issues: string[] = [];
  if (input.mode === "remote" && !secretsKeyConfigured) {
    issues.push("DASHBOARD_SECRETS_KEY is not configured. Stored provider credentials may break after restart.");
  }

  if (input.mode === "remote" && runningInContainer && dedicatedVolumeMounted === false) {
    issues.push(
      `Data directory ${dataDir} is not backed by a dedicated mount. State/files can be lost after container restart or update.`
    );
  }

  return {
    status: issues.length > 0 ? "warn" : "pass",
    dataDir,
    secretsKeyConfigured,
    runningInContainer,
    dedicatedVolumeMounted,
    issues
  };
}
