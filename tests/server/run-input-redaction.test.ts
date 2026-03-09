import { describe, expect, it } from "vitest";

import { extractInputKeysFromText, formatRunInputsSummary, replaceInputTokens } from "../../server/runInputs.js";
import { redactContextForRunState } from "../../server/runner/scheduling/state.js";

describe("run input redaction", () => {
  it("redacts sensitive values in run input summary by default", () => {
    const summary = formatRunInputsSummary({
      source_links: "https://example.com/a,https://example.com/b",
      source_api_key: "sk-live-secret",
      access_token: "token-123"
    });

    expect(summary).toContain("- source_links: https://example.com/a,https://example.com/b");
    expect(summary).toContain("- source_api_key: [REDACTED]");
    expect(summary).toContain("- access_token: [REDACTED]");
    expect(summary).not.toContain("sk-live-secret");
    expect(summary).not.toContain("token-123");
  });

  it("includes sensitive values when redactSecrets is false", () => {
    const summary = formatRunInputsSummary(
      {
        source_links: "https://example.com/a",
        source_api_key: "sk-live-secret",
        access_token: "token-123"
      },
      { redactSecrets: false }
    );

    expect(summary).toContain("- source_links: https://example.com/a");
    expect(summary).toContain("- source_api_key: sk-live-secret");
    expect(summary).toContain("- access_token: token-123");
    expect(summary).not.toContain("[REDACTED]");
  });

  it("redacts sensitive run input values from persisted context", () => {
    const context = [
      "Task: analyze docs",
      "Run inputs:",
      "- source_api_key: sk-live-secret",
      "Direct token usage: sk-live-secret"
    ].join("\n");

    const redacted = redactContextForRunState(context, {
      source_api_key: "sk-live-secret",
      source_links: "https://example.com/a"
    });

    expect(redacted).toContain("[REDACTED]");
    expect(redacted).not.toContain("sk-live-secret");
  });

  it("replaces both input and secret placeholders from run inputs", () => {
    const rendered = replaceInputTokens(
      [
        "Repo: {{input.gitlab_repo}}",
        "Token: {{secret.gitlab_token}}",
        "Missing: {{secret.github_token}}"
      ].join("\n"),
      {
        gitlab_repo: "group/project",
        gitlab_token: "glpat-secret-token"
      }
    );

    expect(rendered).toContain("Repo: group/project");
    expect(rendered).toContain("Token: glpat-secret-token");
    expect(rendered).toContain("Missing: MISSING_INPUT:github_token");
  });

  it("keeps secret placeholders intact when model-facing rendering excludes secrets", () => {
    const rendered = replaceInputTokens(
      [
        "Repo: {{input.gitlab_repo}}",
        "Token: {{secret.gitlab_token}}"
      ].join("\n"),
      {
        gitlab_repo: "group/project",
        gitlab_token: "glpat-secret-token"
      },
      { includeSecrets: false }
    );

    expect(rendered).toContain("Repo: group/project");
    expect(rendered).toContain("Token: {{secret.gitlab_token}}");
    expect(rendered).not.toContain("glpat-secret-token");
  });

  it("extracts keys from both input and secret token placeholders", () => {
    const keys = extractInputKeysFromText(
      "Use {{input.gitlab_repo}}, {{secret.gitlab_token}}, and {{input.gitlab_site_path}}."
    );

    expect(keys).toEqual(expect.arrayContaining(["gitlab_repo", "gitlab_token", "gitlab_site_path"]));
  });
});
