import fs from "node:fs";
import path from "node:path";

import type { UpdateStateSnapshot } from "./types.js";

const DEFAULT_STATE: UpdateStateSnapshot = {
  version: 1,
  currentTag: "latest"
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeString(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function normalizeState(value: unknown): UpdateStateSnapshot {
  if (!isRecord(value)) {
    return { ...DEFAULT_STATE };
  }

  const currentTag = normalizeString(value.currentTag) ?? DEFAULT_STATE.currentTag;

  return {
    version: 1,
    currentTag,
    previousTag: normalizeString(value.previousTag),
    latestTag: normalizeString(value.latestTag),
    latestPublishedAt: normalizeString(value.latestPublishedAt),
    lastCheckedAt: normalizeString(value.lastCheckedAt),
    lastAppliedAt: normalizeString(value.lastAppliedAt),
    lastError: normalizeString(value.lastError)
  };
}

export class UpdaterStateStore {
  private state: UpdateStateSnapshot;

  constructor(private readonly statePath: string) {
    this.state = this.load();
  }

  private load(): UpdateStateSnapshot {
    try {
      const raw = fs.readFileSync(this.statePath, "utf8");
      return normalizeState(JSON.parse(raw) as unknown);
    } catch {
      return { ...DEFAULT_STATE };
    }
  }

  private persist(): void {
    const dirPath = path.dirname(this.statePath);
    fs.mkdirSync(dirPath, { recursive: true });
    fs.writeFileSync(this.statePath, `${JSON.stringify(this.state, null, 2)}\n`, "utf8");
  }

  read(): UpdateStateSnapshot {
    return structuredClone(this.state);
  }

  write(next: UpdateStateSnapshot): UpdateStateSnapshot {
    this.state = normalizeState(next);
    this.persist();
    return this.read();
  }

  patch(patch: Partial<UpdateStateSnapshot>): UpdateStateSnapshot {
    this.state = normalizeState({
      ...this.state,
      ...patch
    });
    this.persist();
    return this.read();
  }
}
