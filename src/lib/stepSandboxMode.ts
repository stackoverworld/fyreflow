import type { PipelinePayload, StepSandboxMode } from "@/lib/types";

type StepSandboxSignalSource = Pick<
  PipelinePayload["steps"][number],
  "name" | "role" | "prompt" | "contextTemplate" | "requiredOutputFiles" | "skipIfArtifacts"
>;

export interface StepSandboxRequirement {
  requiresFullAccess: boolean;
  reasons: string[];
}

const NETWORK_SIGNAL_PATTERNS: Array<{ pattern: RegExp; reason: string }> = [
  {
    pattern: /\bhttps?:\/\/|ssh:\/\/|git@/i,
    reason: "Contains external URL or remote repository address."
  },
  {
    pattern: /\b(github\.com|gitlab\.com|bitbucket\.org|raw\.githubusercontent\.com|api\.github\.com|api\.gitlab\.com)\b/i,
    reason: "Targets a remote source-control/API host."
  },
  {
    pattern:
      /\b(curl|wget|httpie|fetch\(|axios|gh\s+api|glab|git\s+(clone|fetch|pull|push)|npm\s+publish|pnpm\s+publish|bun\s+publish)\b/i,
    reason: "Uses a command pattern that requires outbound network access."
  },
  {
    pattern: /\b(publish|deploy|push|upload|sync|release|commit)\b[\s\S]{0,80}\b(gitlab|github|repo|repository|api|endpoint|remote|webhook)\b/i,
    reason: "This looks like a publish/deploy step against remote infrastructure."
  }
];

const INPUT_SECRET_HINT = /\{\{\s*input\.[^}]*?(token|secret|api[_-]?key|pat|password|oauth)\s*\}\}/i;
const INPUT_REMOTE_HINT = /\{\{\s*input\.[^}]*?(url|uri|endpoint|repo|repository|host|domain)\s*\}\}/i;

function toStepSignalText(step: StepSandboxSignalSource): string {
  const parts = [
    step.name ?? "",
    step.role ?? "",
    step.prompt ?? "",
    step.contextTemplate ?? "",
    ...(Array.isArray(step.requiredOutputFiles) ? step.requiredOutputFiles : []),
    ...(Array.isArray(step.skipIfArtifacts) ? step.skipIfArtifacts : [])
  ];

  return parts.join("\n");
}

export function normalizeStepSandboxMode(value: unknown): StepSandboxMode {
  if (value === "secure" || value === "full" || value === "auto") {
    return value;
  }
  return "auto";
}

export function analyzeStepSandboxRequirement(step: StepSandboxSignalSource): StepSandboxRequirement {
  const signalText = toStepSignalText(step);
  const reasons: string[] = [];

  for (const signal of NETWORK_SIGNAL_PATTERNS) {
    if (signal.pattern.test(signalText)) {
      reasons.push(signal.reason);
    }
  }

  if (INPUT_SECRET_HINT.test(signalText) && INPUT_REMOTE_HINT.test(signalText)) {
    reasons.push("Combines secret runtime input with remote endpoint input.");
  }

  const dedupedReasons = [...new Set(reasons)].slice(0, 4);
  return {
    requiresFullAccess: dedupedReasons.length > 0,
    reasons: dedupedReasons
  };
}

export function resolvePreferredSandboxMode(step: StepSandboxSignalSource & { sandboxMode?: StepSandboxMode }): StepSandboxMode {
  const requested = normalizeStepSandboxMode(step.sandboxMode);
  const requirement = analyzeStepSandboxRequirement(step);

  if (requested === "full") {
    return "full";
  }

  if (requirement.requiresFullAccess) {
    return "secure";
  }

  if (requested === "secure") {
    return requested;
  }

  return "secure";
}
