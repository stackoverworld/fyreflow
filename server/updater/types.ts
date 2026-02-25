export type UpdateChannel = "stable" | "prerelease";

export interface CoreHealthSnapshot {
  ok: boolean;
  version?: string;
  now?: string;
}

export interface UpdateStatus {
  channel: UpdateChannel;
  currentTag: string;
  currentVersion?: string;
  latestTag?: string;
  latestPublishedAt?: string;
  updateAvailable: boolean;
  rollbackAvailable: boolean;
  busy: boolean;
  lastCheckedAt?: string;
  lastAppliedAt?: string;
  lastError?: string;
}

export interface ApplyUpdateRequest {
  version?: string;
}

export interface UpdateStateSnapshot {
  version: 1;
  currentTag: string;
  previousTag?: string;
  latestTag?: string;
  latestPublishedAt?: string;
  lastCheckedAt?: string;
  lastAppliedAt?: string;
  lastError?: string;
}

export interface ReleaseSnapshot {
  tag: string;
  publishedAt?: string;
}
