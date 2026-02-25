import { readEnvFile, writeEnvVariable } from "./envFile.js";
import { pullAndRestartCoreService } from "./dockerCompose.js";
import { fetchLatestRelease, normalizeReleaseTag, sameReleaseTag } from "./releases.js";
import { UpdaterStateStore } from "./state.js";
import type { UpdaterRuntimeConfig } from "./config.js";
import type { ApplyUpdateRequest, CoreHealthSnapshot, ReleaseSnapshot, UpdateStatus } from "./types.js";

function nowIso(): string {
  return new Date().toISOString();
}

function ensureTag(raw: string | undefined, fallback = "latest"): string {
  const normalized = raw ? normalizeReleaseTag(raw) : "";
  return normalized.length > 0 ? normalized : fallback;
}

async function fetchCoreHealth(coreHealthUrl: string, timeoutMs: number): Promise<CoreHealthSnapshot | null> {
  const controller = new AbortController();
  const timeout = setTimeout(() => {
    controller.abort(`Core health lookup timed out after ${timeoutMs}ms`);
  }, timeoutMs);

  try {
    const response = await fetch(coreHealthUrl, {
      method: "GET",
      signal: controller.signal
    });

    if (!response.ok) {
      return null;
    }

    const payload = (await response.json()) as unknown;
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
      return null;
    }

    const value = payload as Record<string, unknown>;
    return {
      ok: value.ok === true,
      version: typeof value.version === "string" ? value.version.trim() : undefined,
      now: typeof value.now === "string" ? value.now : undefined
    };
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

export class UpdaterService {
  private readonly stateStore: UpdaterStateStore;
  private busy = false;

  constructor(private readonly config: UpdaterRuntimeConfig) {
    this.stateStore = new UpdaterStateStore(config.statePath);
    const envValues = readEnvFile(config.composeEnvFilePath);
    const state = this.stateStore.read();
    const envTag = ensureTag(envValues.FYREFLOW_VERSION, state.currentTag);
    if (!sameReleaseTag(state.currentTag, envTag)) {
      this.stateStore.patch({ currentTag: envTag });
    }
  }

  private getCurrentTag(): string {
    const envValues = readEnvFile(this.config.composeEnvFilePath);
    const state = this.stateStore.read();
    const resolved = ensureTag(envValues.FYREFLOW_VERSION, state.currentTag);
    if (!sameReleaseTag(state.currentTag, resolved)) {
      this.stateStore.patch({ currentTag: resolved });
    }
    return resolved;
  }

  private composeImageTag(tag: string): string {
    return `${this.config.imageRepository}:${tag}`;
  }

  private async fetchLatestRelease(): Promise<ReleaseSnapshot> {
    return fetchLatestRelease(
      this.config.githubOwner,
      this.config.githubRepo,
      this.config.channel,
      this.config.githubToken,
      this.config.releaseTimeoutMs
    );
  }

  async checkForUpdates(): Promise<UpdateStatus> {
    try {
      const release = await this.fetchLatestRelease();
      this.stateStore.patch({
        latestTag: release.tag,
        latestPublishedAt: release.publishedAt,
        lastCheckedAt: nowIso(),
        lastError: undefined
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.stateStore.patch({
        lastCheckedAt: nowIso(),
        lastError: message
      });
    }

    return this.getStatus();
  }

  async getStatus(): Promise<UpdateStatus> {
    const state = this.stateStore.read();
    const currentTag = this.getCurrentTag();
    const coreHealth = await fetchCoreHealth(this.config.coreHealthUrl, this.config.healthTimeoutMs);

    const updateAvailable =
      typeof state.latestTag === "string" && state.latestTag.trim().length > 0
        ? !sameReleaseTag(currentTag, state.latestTag)
        : false;

    return {
      channel: this.config.channel,
      currentTag,
      currentVersion: coreHealth?.version,
      latestTag: state.latestTag,
      latestPublishedAt: state.latestPublishedAt,
      updateAvailable,
      rollbackAvailable: typeof state.previousTag === "string" && state.previousTag.trim().length > 0,
      busy: this.busy,
      lastCheckedAt: state.lastCheckedAt,
      lastAppliedAt: state.lastAppliedAt,
      lastError: state.lastError
    };
  }

  private async applyTag(tag: string, rollback = false): Promise<UpdateStatus> {
    if (this.busy) {
      throw new Error("Updater is busy with another operation.");
    }

    this.busy = true;
    const currentTag = this.getCurrentTag();
    const targetTag = ensureTag(tag, currentTag);

    if (sameReleaseTag(currentTag, targetTag)) {
      this.busy = false;
      return this.getStatus();
    }

    try {
      writeEnvVariable(this.config.composeEnvFilePath, "FYREFLOW_VERSION", targetTag);

      await pullAndRestartCoreService(
        {
          dockerBinary: this.config.dockerBinary,
          composeFilePath: this.config.composeFilePath,
          composeEnvFilePath: this.config.composeEnvFilePath,
          coreServiceName: this.config.coreServiceName
        },
        this.config.healthTimeoutMs
      );

      this.stateStore.patch({
        previousTag: currentTag,
        currentTag: targetTag,
        lastAppliedAt: nowIso(),
        lastError: undefined,
        ...(rollback
          ? { latestTag: targetTag }
          : {})
      });

      return this.getStatus();
    } catch (error) {
      writeEnvVariable(this.config.composeEnvFilePath, "FYREFLOW_VERSION", currentTag);
      const message = error instanceof Error ? error.message : String(error);
      this.stateStore.patch({
        currentTag,
        lastError: message
      });
      throw new Error(message);
    } finally {
      this.busy = false;
    }
  }

  async applyUpdate(input: ApplyUpdateRequest = {}): Promise<UpdateStatus> {
    const requestedTag = ensureTag(input.version, "");
    const targetTag = requestedTag.length > 0
      ? requestedTag
      : (() => {
          const state = this.stateStore.read();
          if (state.latestTag && state.latestTag.trim().length > 0) {
            return ensureTag(state.latestTag);
          }
          return "";
        })();

    if (targetTag.length === 0) {
      throw new Error("No target version available. Run update check first or pass explicit version.");
    }

    return this.applyTag(targetTag);
  }

  async rollbackUpdate(): Promise<UpdateStatus> {
    const state = this.stateStore.read();
    const previousTag = ensureTag(state.previousTag, "");
    if (previousTag.length === 0) {
      throw new Error("Rollback is unavailable: previous version is not recorded.");
    }

    return this.applyTag(previousTag, true);
  }

  async refreshLatestWhenStale(): Promise<void> {
    const state = this.stateStore.read();
    const lastCheckedAtMs = state.lastCheckedAt ? Date.parse(state.lastCheckedAt) : Number.NaN;
    const stale = !Number.isFinite(lastCheckedAtMs) || Date.now() - lastCheckedAtMs > this.config.autoCheckIntervalMs;
    if (!stale || this.busy) {
      return;
    }

    await this.checkForUpdates();
  }

  imageTagToReference(tag: string): string {
    return this.composeImageTag(tag);
  }
}
