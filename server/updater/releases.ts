import type { ReleaseSnapshot, UpdateChannel } from "./types.js";

function normalizeTag(tag: string): string {
  return tag.trim().replace(/^v/i, "");
}

function normalizeIsoDate(raw: unknown): string | undefined {
  if (typeof raw !== "string") {
    return undefined;
  }

  const parsed = Date.parse(raw);
  if (!Number.isFinite(parsed)) {
    return undefined;
  }

  return new Date(parsed).toISOString();
}

function buildReleaseFetchHeaders(githubToken: string): Headers {
  const headers = new Headers();
  headers.set("Accept", "application/vnd.github+json");
  if (githubToken.trim().length > 0) {
    headers.set("Authorization", `Bearer ${githubToken.trim()}`);
  }
  return headers;
}

function extractReleaseTag(payload: unknown): ReleaseSnapshot | null {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return null;
  }

  const value = payload as Record<string, unknown>;
  const rawTag = typeof value.tag_name === "string" ? value.tag_name.trim() : "";
  if (rawTag.length === 0) {
    return null;
  }

  return {
    tag: normalizeTag(rawTag),
    publishedAt: normalizeIsoDate(value.published_at)
  };
}

async function fetchJson(url: string, githubToken: string, timeoutMs: number): Promise<unknown> {
  const controller = new AbortController();
  const timeout = setTimeout(() => {
    controller.abort(`Release lookup timed out after ${timeoutMs}ms`);
  }, timeoutMs);

  try {
    const response = await fetch(url, {
      method: "GET",
      headers: buildReleaseFetchHeaders(githubToken),
      signal: controller.signal
    });

    if (!response.ok) {
      const body = (await response.text()).trim();
      throw new Error(body.length > 0 ? body : `GitHub release lookup failed with ${response.status}`);
    }

    return await response.json();
  } finally {
    clearTimeout(timeout);
  }
}

export async function fetchLatestRelease(
  owner: string,
  repo: string,
  channel: UpdateChannel,
  githubToken: string,
  timeoutMs: number
): Promise<ReleaseSnapshot> {
  const normalizedOwner = owner.trim();
  const normalizedRepo = repo.trim();
  if (normalizedOwner.length === 0 || normalizedRepo.length === 0) {
    throw new Error("UPDATER_GITHUB_OWNER and UPDATER_GITHUB_REPO must be configured.");
  }

  if (channel === "stable") {
    const payload = await fetchJson(
      `https://api.github.com/repos/${encodeURIComponent(normalizedOwner)}/${encodeURIComponent(normalizedRepo)}/releases/latest`,
      githubToken,
      timeoutMs
    );
    const release = extractReleaseTag(payload);
    if (!release) {
      throw new Error("GitHub stable release payload did not include tag_name.");
    }
    return release;
  }

  const payload = await fetchJson(
    `https://api.github.com/repos/${encodeURIComponent(normalizedOwner)}/${encodeURIComponent(normalizedRepo)}/releases?per_page=20`,
    githubToken,
    timeoutMs
  );

  if (!Array.isArray(payload)) {
    throw new Error("GitHub releases response is not an array.");
  }

  for (const entry of payload) {
    const release = extractReleaseTag(entry);
    if (release) {
      return release;
    }
  }

  throw new Error("No published releases were found.");
}

export function sameReleaseTag(left: string | undefined, right: string | undefined): boolean {
  const normalizedLeft = normalizeTag(left ?? "");
  const normalizedRight = normalizeTag(right ?? "");
  if (normalizedLeft.length === 0 || normalizedRight.length === 0) {
    return false;
  }

  return normalizedLeft === normalizedRight;
}

export function normalizeReleaseTag(raw: string): string {
  return normalizeTag(raw);
}
