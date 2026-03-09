import { describe, expect, it } from "vitest";

import type { RunInputRequest } from "../../src/lib/types.ts";
import { autoNormalizeInputsFromRequests } from "../../src/app/state/appStateRunHelpers.ts";

function createRequest(partial: Partial<RunInputRequest> = {}): RunInputRequest {
  return {
    key: "github_repo",
    label: "GitHub Repo",
    type: "text",
    required: true,
    reason: 'Expected owner/repo format without protocol (example: "org/project").',
    ...partial
  };
}

describe("autoNormalizeInputsFromRequests", () => {
  it("normalizes repo URL to owner/repo when request indicates repo format", () => {
    const { inputs, changed } = autoNormalizeInputsFromRequests(
      { github_repo: "https://github.com/Lunarbase-Lab/Prop-AMM-RnD" },
      [createRequest()]
    );

    expect(changed).toBe(true);
    expect(inputs.github_repo).toBe("Lunarbase-Lab/Prop-AMM-RnD");
  });

  it("normalizes leading slash for relative path requests", () => {
    const { inputs, changed } = autoNormalizeInputsFromRequests(
      { github_file_path: "/WHITEPAPER.md" },
      [
        createRequest({
          key: "github_file_path",
          label: "GitHub File Path",
          type: "path",
          reason: 'Expected relative path without leading "/" (example: docs/WHITEPAPER.md).'
        })
      ]
    );

    expect(changed).toBe(true);
    expect(inputs.github_file_path).toBe("WHITEPAPER.md");
  });

  it("normalizes gitlab URL with nested subgroup path to repo slug", () => {
    const { inputs, changed } = autoNormalizeInputsFromRequests(
      { gitlab_repo: "https://gitlab.com/group/subgroup/lunar-base-front/-/tree/main" },
      [
        createRequest({
          key: "gitlab_repo",
          label: "GitLab Repo",
          type: "text",
          reason: 'Expected owner/repo format without protocol (example: "org/project").'
        })
      ]
    );

    expect(changed).toBe(true);
    expect(inputs.gitlab_repo).toBe("group/subgroup/lunar-base-front");
  });

  it("normalizes equivalent repository alias keys when request key differs", () => {
    const { inputs, changed } = autoNormalizeInputsFromRequests(
      { github_repository: "https://github.com/Lunarbase-Lab/Prop-AMM-RnD" },
      [createRequest({ key: "github_repo", label: "GitHub Repo" })]
    );

    expect(changed).toBe(true);
    expect(inputs.github_repository).toBe("Lunarbase-Lab/Prop-AMM-RnD");
    expect(inputs.github_repo).toBe("Lunarbase-Lab/Prop-AMM-RnD");
  });

  it("does not change inputs when request has no matching normalization rule", () => {
    const original = { gitlab_repo: "https://gitlab.com/group/project" };
    const { inputs, changed } = autoNormalizeInputsFromRequests(original, [
      createRequest({
        key: "gitlab_repo",
        label: "GitLab Repo",
        type: "text",
        reason: "Provide repository URL."
      })
    ]);

    expect(changed).toBe(false);
    expect(inputs).toBe(original);
  });
});
