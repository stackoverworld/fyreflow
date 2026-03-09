import { describe, expect, it } from "vitest";

import { normalizeSmartRunPlan } from "../../src/lib/smartRunInputs.ts";
import type { SmartRunPlan } from "../../src/lib/types.ts";

describe("normalizeSmartRunPlan", () => {
  it("dedupes equivalent input fields and input checks", () => {
    const plan: SmartRunPlan = {
      fields: [
        {
          key: "github_repository",
          label: "GitHub Repository",
          type: "text",
          required: true,
          description: "Repository slug.",
          placeholder: "org/repo",
          sources: ["Fetcher.prompt"]
        },
        {
          key: "github_repo",
          label: "GitHub Repo",
          type: "text",
          required: true,
          description: "Repository identifier.",
          placeholder: "owner/repo",
          sources: ["Publisher.prompt"]
        }
      ],
      checks: [
        {
          id: "input:github_repository",
          title: "Input GitHub Repository",
          status: "pass",
          message: "Provided."
        },
        {
          id: "input:github_repo",
          title: "Input GitHub Repo",
          status: "fail",
          message: "Required input is missing."
        },
        {
          id: "provider:openai",
          title: "OpenAI auth",
          status: "pass",
          message: "Connected."
        }
      ],
      canRun: false
    };

    const normalized = normalizeSmartRunPlan(plan);

    expect(normalized.fields).toEqual([
      expect.objectContaining({
        key: "github_repo",
        sources: ["Fetcher.prompt", "Publisher.prompt"]
      })
    ]);
    expect(normalized.checks).toEqual([
      expect.objectContaining({
        id: "provider:openai",
        status: "pass"
      }),
      expect.objectContaining({
        id: "input:github_repo",
        title: "Input GitHub Repository",
        status: "fail"
      })
    ]);
    expect(normalized.canRun).toBe(false);
  });
});
