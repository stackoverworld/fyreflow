import { extractInputKeysFromText, replaceInputTokens, type RunInputs } from "../runInputs.js";
import type { Pipeline, SmartRunCheck } from "../types.js";

const URL_CANDIDATE_REGEX = /\bhttps?:\/\/[^\s"'`<>)\]}]+/gi;
const NESTED_URL_SCHEME_REGEX = /https?:\/\//i;
const URL_PATH_DOUBLE_SLASH_REGEX = /\/{2,}/;

function collectUrlCandidates(text: string): string[] {
  if (text.trim().length === 0) {
    return [];
  }

  const urls = new Set<string>();
  for (const match of text.matchAll(URL_CANDIDATE_REGEX)) {
    const candidate = (match[0] ?? "").trim();
    if (candidate.length > 0) {
      urls.add(candidate);
    }
  }

  return [...urls];
}

function summarizeKeys(rawTemplate: string): string {
  const keys = extractInputKeysFromText(rawTemplate);
  if (keys.length === 0) {
    return "Input placeholders: none detected.";
  }
  if (keys.length <= 4) {
    return `Input placeholders: ${keys.join(", ")}.`;
  }
  return `Input placeholders: ${keys.slice(0, 4).join(", ")} (+${keys.length - 4} more).`;
}

function decodePathname(url: URL): string {
  try {
    return decodeURIComponent(url.pathname);
  } catch {
    return url.pathname;
  }
}

export function collectRenderedInputSanityChecks(pipeline: Pipeline, runInputs: RunInputs): SmartRunCheck[] {
  const checks: SmartRunCheck[] = [];
  const seen = new Set<string>();

  for (const step of pipeline.steps) {
    const templates: Array<{ source: "prompt" | "contextTemplate"; raw: string }> = [
      { source: "prompt", raw: step.prompt },
      { source: "contextTemplate", raw: step.contextTemplate }
    ];

    for (const template of templates) {
      if (template.raw.trim().length === 0) {
        continue;
      }

      const rendered = replaceInputTokens(template.raw, runInputs);
      for (const candidate of collectUrlCandidates(rendered)) {
        let parsed: URL;
        try {
          parsed = new URL(candidate);
        } catch {
          continue;
        }

        const decodedPath = decodePathname(parsed);
        const normalizedPath = decodedPath.replace(/^\/+/, "");
        const keySummary = summarizeKeys(template.raw);

        if (NESTED_URL_SCHEME_REGEX.test(decodedPath)) {
          const id = `input:url_nested_scheme:${step.id}:${template.source}`;
          if (seen.has(id)) {
            continue;
          }
          seen.add(id);
          checks.push({
            id,
            title: `Input URL composition (${step.name})`,
            status: "fail",
            message: `Rendered ${template.source} contains a nested URL in endpoint path.`,
            details: `${keySummary} Check URL/repo/path inputs for this step.`
          });
          continue;
        }

        if (URL_PATH_DOUBLE_SLASH_REGEX.test(normalizedPath)) {
          const id = `input:url_double_slash_path:${step.id}:${template.source}`;
          if (seen.has(id)) {
            continue;
          }
          seen.add(id);
          checks.push({
            id,
            title: `Input URL composition (${step.name})`,
            status: "warn",
            message: `Rendered ${template.source} contains duplicate "/" path separators.`,
            details: `${keySummary} Confirm path-like inputs do not include extra leading slashes.`
          });
        }
      }
    }
  }

  return checks;
}

