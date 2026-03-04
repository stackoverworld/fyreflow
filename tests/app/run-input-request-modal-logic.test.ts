import { describe, expect, it } from "vitest";

import type { RunInputRequest } from "../../src/lib/types.ts";
import {
  getRequestValidationError,
  isRequiredMissing,
  MASKED_SECRET_INPUT_VALUE,
  normalizeSeededInputValue
} from "../../src/components/dashboard/RunInputRequestModal.tsx";

function createRequest(partial: Partial<RunInputRequest> = {}): RunInputRequest {
  return {
    key: "gitlab_token",
    label: "GitLab token",
    type: "secret",
    required: true,
    reason: "Required to authenticate.",
    ...partial
  };
}

describe("run input request modal logic", () => {
  it("keeps masked secure seed value for secret requests", () => {
    const request = createRequest({ type: "secret" });
    const value = normalizeSeededInputValue(request, "[secure]");
    expect(value).toBe(MASKED_SECRET_INPUT_VALUE);
  });

  it("clears masked secure seed value for non-secret requests", () => {
    const request = createRequest({ type: "text" });
    const value = normalizeSeededInputValue(request, "[secure]");
    expect(value).toBe("");
  });

  it("does not mark required secret as missing when masked secure value exists", () => {
    const request = createRequest({ type: "secret", required: true });
    const missing = isRequiredMissing(request, { gitlab_token: MASKED_SECRET_INPUT_VALUE });
    expect(missing).toBe(false);
  });

  it("marks required secret as missing when value is empty", () => {
    const request = createRequest({ type: "secret", required: true });
    const missing = isRequiredMissing(request, { gitlab_token: "" });
    expect(missing).toBe(true);
  });

  it("validates repo slug format when reason expects owner/repo", () => {
    const request = createRequest({
      key: "github_repo",
      label: "GitHub Repo",
      type: "text",
      reason: 'Expected owner/repo format without protocol (example: "org/project").'
    });

    const invalid = getRequestValidationError(request, {
      github_repo: "https://github.com/Lunarbase-Lab/Prop-AMM-RnD"
    });
    const valid = getRequestValidationError(request, {
      github_repo: "Lunarbase-Lab/Prop-AMM-RnD"
    });

    expect(invalid).toContain("owner/repo");
    expect(valid).toBeNull();
  });

  it("validates url inputs", () => {
    const request = createRequest({
      key: "source_url",
      label: "Source URL",
      type: "url",
      reason: "Provide source URL."
    });

    expect(getRequestValidationError(request, { source_url: "not-a-url" })).toContain("valid URL");
    expect(getRequestValidationError(request, { source_url: "https://example.com/a" })).toBeNull();
  });

  it("validates relative path when request asks to remove leading slash", () => {
    const request = createRequest({
      key: "github_file_path",
      label: "GitHub File Path",
      type: "path",
      reason: 'Expected relative path without leading "/" (example: docs/WHITEPAPER.md).'
    });

    expect(getRequestValidationError(request, { github_file_path: "/WHITEPAPER.md" })).toContain("relative path");
    expect(getRequestValidationError(request, { github_file_path: "WHITEPAPER.md" })).toBeNull();
  });
});
