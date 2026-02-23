import type { StorageConfig } from "@/lib/types";

function trimBoundarySlashes(value: string): string {
  return value.replace(/^[\\/]+/, "").replace(/[\\/]+$/, "");
}

function safeStorageSegment(value: string): string {
  const trimmed = value.trim();
  const fallback = trimmed.length > 0 ? trimmed : "default";
  return fallback.replace(/[^a-zA-Z0-9._-]+/g, "_");
}

export function shouldShowIsolatedStorageSection(
  isolatedEnabledStepIds: ReadonlySet<string> | null | undefined
): boolean {
  if (!isolatedEnabledStepIds) {
    return true;
  }

  return isolatedEnabledStepIds.size > 0;
}

export function isIsolatedStorageEnabledForStep(
  stepId: string,
  isolatedEnabledStepIds: ReadonlySet<string> | null | undefined
): boolean {
  if (!isolatedEnabledStepIds) {
    return true;
  }

  return isolatedEnabledStepIds.has(stepId.trim());
}

export function buildRunFolderPath(storageConfig: StorageConfig | null | undefined, runId: string): string | null {
  if (!storageConfig) {
    return null;
  }

  const normalizedRunId = runId.trim();
  if (normalizedRunId.length === 0) {
    return null;
  }

  const rootPath = storageConfig.rootPath.trim().replace(/[\\/]+$/, "");
  const runsFolder = trimBoundarySlashes(storageConfig.runsFolder.trim());
  if (rootPath.length === 0 || runsFolder.length === 0) {
    return null;
  }

  const separator = rootPath.includes("\\") ? "\\" : "/";
  return `${rootPath}${separator}${runsFolder}${separator}${safeStorageSegment(normalizedRunId)}`;
}

export function buildSharedStoragePath(
  storageConfig: StorageConfig | null | undefined,
  pipelineId: string
): string | null {
  if (!storageConfig) {
    return null;
  }

  const normalizedPipelineId = pipelineId.trim();
  if (normalizedPipelineId.length === 0) {
    return null;
  }

  const rootPath = storageConfig.rootPath.trim().replace(/[\\/]+$/, "");
  const sharedFolder = trimBoundarySlashes(storageConfig.sharedFolder.trim());
  if (rootPath.length === 0 || sharedFolder.length === 0) {
    return null;
  }

  const separator = rootPath.includes("\\") ? "\\" : "/";
  return `${rootPath}${separator}${sharedFolder}${separator}${safeStorageSegment(normalizedPipelineId)}`;
}

export function buildIsolatedStorageRootPath(
  storageConfig: StorageConfig | null | undefined,
  pipelineId: string
): string | null {
  if (!storageConfig) {
    return null;
  }

  const normalizedPipelineId = pipelineId.trim();
  if (normalizedPipelineId.length === 0) {
    return null;
  }

  const rootPath = storageConfig.rootPath.trim().replace(/[\\/]+$/, "");
  const isolatedFolder = trimBoundarySlashes(storageConfig.isolatedFolder.trim());
  if (rootPath.length === 0 || isolatedFolder.length === 0) {
    return null;
  }

  const separator = rootPath.includes("\\") ? "\\" : "/";
  return `${rootPath}${separator}${isolatedFolder}${separator}${safeStorageSegment(normalizedPipelineId)}`;
}

export function buildIsolatedStepStoragePath(
  storageConfig: StorageConfig | null | undefined,
  pipelineId: string,
  stepId: string
): string | null {
  const rootPath = buildIsolatedStorageRootPath(storageConfig, pipelineId);
  if (!rootPath) {
    return null;
  }

  const normalizedStepId = stepId.trim();
  if (normalizedStepId.length === 0) {
    return null;
  }

  const separator = rootPath.includes("\\") ? "\\" : "/";
  return `${rootPath}${separator}${safeStorageSegment(normalizedStepId)}`;
}

export function getRevealFolderButtonLabel(platform: string | undefined): string {
  if (platform === "darwin") {
    return "Open in Finder";
  }

  if (platform === "win32") {
    return "Open in Explorer";
  }

  return "Open folder";
}
