import fs from "node:fs/promises";
import path from "node:path";

interface SchedulerStateFile {
  version: 1;
  updatedAt: string;
  markers: Record<string, string>;
}

const SCHEDULER_STATE_PATH = path.resolve(process.cwd(), "data", "scheduler-state.json");

function nowIso(): string {
  return new Date().toISOString();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeMarkers(raw: unknown): Record<string, string> {
  if (!isRecord(raw)) {
    return {};
  }

  const normalized: Record<string, string> = {};
  for (const [rawPipelineId, rawMarker] of Object.entries(raw)) {
    const pipelineId = rawPipelineId.trim();
    if (pipelineId.length === 0 || typeof rawMarker !== "string") {
      continue;
    }

    const marker = rawMarker.trim();
    if (marker.length === 0) {
      continue;
    }
    normalized[pipelineId] = marker;
  }

  return normalized;
}

export async function loadSchedulerMarkers(): Promise<Map<string, string>> {
  try {
    const raw = await fs.readFile(SCHEDULER_STATE_PATH, "utf8");
    const parsed = JSON.parse(raw) as unknown;
    if (!isRecord(parsed)) {
      return new Map();
    }

    const markers = normalizeMarkers(parsed.markers);
    return new Map(Object.entries(markers));
  } catch {
    return new Map();
  }
}

export async function saveSchedulerMarkers(markers: Map<string, string>): Promise<void> {
  const payload: SchedulerStateFile = {
    version: 1,
    updatedAt: nowIso(),
    markers: Object.fromEntries(markers.entries())
  };

  const dirPath = path.dirname(SCHEDULER_STATE_PATH);
  await fs.mkdir(dirPath, { recursive: true });
  await fs.writeFile(SCHEDULER_STATE_PATH, JSON.stringify(payload, null, 2), "utf8");
}
