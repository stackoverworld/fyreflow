import fs from "node:fs";

import { normalizeSemverLikeVersion } from "./versioning.js";

export interface DesktopCompatibilityPolicy {
  minimumDesktopVersion: string;
  downloadUrl: string;
}

interface DesktopCompatibilityPolicyPayload {
  minimumDesktopVersion?: unknown;
  downloadUrl?: unknown;
}

function normalizeOptionalUrl(raw: unknown): string {
  if (typeof raw !== "string") {
    return "";
  }

  const trimmed = raw.trim();
  if (trimmed.length === 0) {
    return "";
  }

  try {
    return new URL(trimmed).toString().replace(/\/+$/, "");
  } catch {
    return "";
  }
}

export function loadDesktopCompatibilityPolicy(pathname: string): DesktopCompatibilityPolicy {
  const fallback: DesktopCompatibilityPolicy = {
    minimumDesktopVersion: "",
    downloadUrl: ""
  };

  if (typeof pathname !== "string" || pathname.trim().length === 0) {
    return fallback;
  }

  try {
    if (!fs.existsSync(pathname)) {
      return fallback;
    }

    const raw = fs.readFileSync(pathname, "utf8");
    const payload = JSON.parse(raw) as DesktopCompatibilityPolicyPayload;

    return {
      minimumDesktopVersion: normalizeSemverLikeVersion(
        typeof payload.minimumDesktopVersion === "string" ? payload.minimumDesktopVersion : undefined
      ),
      downloadUrl: normalizeOptionalUrl(payload.downloadUrl)
    };
  } catch {
    return fallback;
  }
}
