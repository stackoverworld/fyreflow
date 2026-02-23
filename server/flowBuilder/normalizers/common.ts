import type { AgentRole, LinkCondition } from "../../types.js";
import { normalizeQualityGateKind } from "./qualityGates.js";

export function normalizeRef(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function clip(value: string, maxLength: number): string {
  const trimmed = value.trim();
  if (trimmed.length <= maxLength) {
    return trimmed;
  }
  return `${trimmed.slice(0, maxLength)}\n...[truncated]`;
}

export function normalizeRole(value: unknown): AgentRole | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const normalized = value.trim().toLowerCase().replace(/[\s-]+/g, "_");

  if (normalized === "analysis") return "analysis";
  if (normalized === "planner") return "planner";
  if (normalized === "orchestrator") return "orchestrator";
  if (normalized === "executor") return "executor";
  if (normalized === "tester") return "tester";
  if (normalized === "review") return "review";
  if (normalized === "reviewer" || normalized === "qa" || normalized === "validator") return "review";
  if (normalized === "implementer" || normalized === "builder") return "executor";
  if (normalized === "coordinator" || normalized === "manager") return "orchestrator";
  if (normalized === "test") return "tester";
  return undefined;
}

export function normalizeCondition(value: unknown): LinkCondition | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const normalized = value.trim().toLowerCase().replace(/[\s-]+/g, "_");

  if (normalized === "always") return "always";
  if (normalized === "on_pass" || normalized === "pass" || normalized === "success" || normalized === "on_success") {
    return "on_pass";
  }
  if (normalized === "on_fail" || normalized === "fail" || normalized === "failure" || normalized === "on_error") {
    return "on_fail";
  }
  return undefined;
}

export function normalizeStringArray(value: unknown, maxLength: number): string[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }

  const normalized = value
    .filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0)
    .map((entry) => entry.trim())
    .slice(0, maxLength);

  return normalized.length > 0 ? normalized : [];
}

function normalizeQuestionId(value: string, index: number): string {
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 80);

  if (normalized.length > 0) {
    return normalized;
  }

  return `question_${index + 1}`;
}

interface NormalizedQuestionOption {
  label: string;
  value: string;
  description?: string;
}

interface NormalizedQuestion {
  id: string;
  question: string;
  options: NormalizedQuestionOption[];
}

function normalizeQuestionOption(raw: unknown): NormalizedQuestionOption | null {
  if (typeof raw === "string") {
    const trimmed = raw.trim();
    if (trimmed.length === 0) {
      return null;
    }

    return {
      label: trimmed,
      value: trimmed
    };
  }

  if (!isRecord(raw)) {
    return null;
  }

  const labelValue =
    typeof raw.label === "string"
      ? raw.label
      : typeof raw.title === "string"
        ? raw.title
        : typeof raw.text === "string"
          ? raw.text
          : raw.value;

  const valueValue =
    typeof raw.value === "string"
      ? raw.value
      : typeof raw.response === "string"
        ? raw.response
        : typeof labelValue === "string"
          ? labelValue
          : "";

  const label = typeof labelValue === "string" ? labelValue.trim() : "";
  const value = typeof valueValue === "string" ? valueValue.trim() : "";
  if (label.length === 0 || value.length === 0) {
    return null;
  }

  return {
    label,
    value,
    description: typeof raw.description === "string" && raw.description.trim().length > 0 ? raw.description.trim() : undefined
  };
}

function normalizeQuestions(value: unknown): NormalizedQuestion[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }

  const normalized = value
    .map((entry, index) => {
      if (!isRecord(entry)) {
        return null;
      }

      const questionValue =
        typeof entry.question === "string"
          ? entry.question
          : typeof entry.prompt === "string"
            ? entry.prompt
            : typeof entry.text === "string"
              ? entry.text
              : typeof entry.title === "string"
                ? entry.title
                : "";
      const question = questionValue.trim();
      if (question.length === 0) {
        return null;
      }

      const rawOptions =
        entry.options ?? entry.choices ?? entry.answers ?? (Array.isArray(entry.values) ? entry.values : undefined);
      const options = Array.isArray(rawOptions)
        ? rawOptions
            .map((option) => normalizeQuestionOption(option))
            .filter((option): option is NormalizedQuestionOption => option !== null)
            .slice(0, 6)
        : [];

      if (options.length === 0) {
        return null;
      }

      return {
        id:
          typeof entry.id === "string" && entry.id.trim().length > 0
            ? normalizeQuestionId(entry.id, index)
            : normalizeQuestionId(question, index),
        question,
        options
      };
    })
    .filter((entry): entry is NormalizedQuestion => entry !== null)
    .slice(0, 3);

  return normalized.length > 0 ? normalized : undefined;
}

export function normalizeAction(
  value: unknown
): "answer" | "update_current_flow" | "replace_flow" | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const normalized = value.trim().toLowerCase().replace(/[\s-]+/g, "_");

  if (
    normalized === "answer" ||
    normalized === "reply" ||
    normalized === "qa" ||
    normalized === "question" ||
    normalized === "analysis" ||
    normalized === "chat"
  ) {
    return "answer";
  }

  if (
    normalized === "update_current_flow" ||
    normalized === "update_current" ||
    normalized === "update" ||
    normalized === "edit" ||
    normalized === "modify" ||
    normalized === "patch" ||
    normalized === "refine"
  ) {
    return "update_current_flow";
  }

  if (
    normalized === "replace_flow" ||
    normalized === "replace" ||
    normalized === "rebuild" ||
    normalized === "new" ||
    normalized === "new_flow" ||
    normalized === "create_new" ||
    normalized === "recreate" ||
    normalized === "from_scratch"
  ) {
    return "replace_flow";
  }

  return undefined;
}

export function normalizeGeneratedFlow(raw: unknown): unknown {
  if (!isRecord(raw)) {
    return raw;
  }

  const normalized: Record<string, unknown> = {
    name: typeof raw.name === "string" ? raw.name.trim() : raw.name,
    description: typeof raw.description === "string" ? raw.description.trim() : raw.description
  };

  if (isRecord(raw.runtime)) {
    normalized.runtime = {
      maxLoops: typeof raw.runtime.maxLoops === "number" ? raw.runtime.maxLoops : undefined,
      maxStepExecutions: typeof raw.runtime.maxStepExecutions === "number" ? raw.runtime.maxStepExecutions : undefined,
      stageTimeoutMs: typeof raw.runtime.stageTimeoutMs === "number" ? raw.runtime.stageTimeoutMs : undefined
    };
  } else if (raw.runtime !== undefined) {
    normalized.runtime = raw.runtime;
  }

  if (isRecord(raw.schedule)) {
    normalized.schedule = {
      enabled: typeof raw.schedule.enabled === "boolean" ? raw.schedule.enabled : undefined,
      cron: typeof raw.schedule.cron === "string" ? raw.schedule.cron.trim() : undefined,
      timezone: typeof raw.schedule.timezone === "string" ? raw.schedule.timezone.trim() : undefined,
      task: typeof raw.schedule.task === "string" ? raw.schedule.task.trim() : undefined,
      runMode:
        raw.schedule.runMode === "quick" ? "quick" : raw.schedule.runMode === "smart" ? "smart" : undefined,
      inputs:
        typeof raw.schedule.inputs === "object" && raw.schedule.inputs !== null
          ? Object.fromEntries(
              Object.entries(raw.schedule.inputs)
                .filter(([key, value]) => key.trim().length > 0 && typeof value === "string")
                .map(([key, value]) => [key.trim().toLowerCase(), value as string])
            )
          : undefined
    };
  } else if (raw.schedule !== undefined) {
    normalized.schedule = raw.schedule;
  }

  if (Array.isArray(raw.steps)) {
    const seenNames = new Set<string>();
    normalized.steps = raw.steps
      .map((step, index) => {
        if (!isRecord(step)) {
          return null;
        }

        const baseName =
          typeof step.name === "string" && step.name.trim().length > 0 ? step.name.trim() : `Step ${index + 1}`;
        let name = baseName;
        let suffix = 2;
        while (seenNames.has(normalizeRef(name))) {
          name = `${baseName} ${suffix}`;
          suffix += 1;
        }
        seenNames.add(normalizeRef(name));

        const prompt = typeof step.prompt === "string" ? step.prompt.trim() : undefined;
        const contextTemplate =
          typeof step.contextTemplate === "string" ? step.contextTemplate.trim() : undefined;
        const delegationCount = typeof step.delegationCount === "number" ? Math.floor(step.delegationCount) : undefined;

        return {
          name,
          role: normalizeRole(step.role),
          prompt: prompt && prompt.length > 0 ? prompt : undefined,
          contextTemplate: contextTemplate && contextTemplate.length > 0 ? contextTemplate : undefined,
          enableDelegation: typeof step.enableDelegation === "boolean" ? step.enableDelegation : undefined,
          delegationCount,
          enableIsolatedStorage: typeof step.enableIsolatedStorage === "boolean" ? step.enableIsolatedStorage : undefined,
          enableSharedStorage: typeof step.enableSharedStorage === "boolean" ? step.enableSharedStorage : undefined,
          enabledMcpServerIds: Array.isArray(step.enabledMcpServerIds)
            ? step.enabledMcpServerIds
                .filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0)
                .map((entry) => entry.trim())
                .slice(0, 16)
            : undefined,
          outputFormat: step.outputFormat === "json" ? "json" : step.outputFormat === "markdown" ? "markdown" : undefined,
          requiredOutputFields: normalizeStringArray(step.requiredOutputFields, 40),
          requiredOutputFiles: normalizeStringArray(step.requiredOutputFiles, 40),
          scenarios: normalizeStringArray(step.scenarios, 20),
          skipIfArtifacts: normalizeStringArray(step.skipIfArtifacts, 40),
          policyProfileIds: normalizeStringArray(step.policyProfileIds, 20),
          cacheBypassInputKeys: normalizeStringArray(step.cacheBypassInputKeys, 20),
          cacheBypassOrchestratorPromptPatterns: normalizeStringArray(step.cacheBypassOrchestratorPromptPatterns, 20)
        };
      })
      .filter((step): step is NonNullable<typeof step> => step !== null);
  } else if (raw.steps !== undefined) {
    normalized.steps = raw.steps;
  }

  if (Array.isArray(raw.links)) {
    normalized.links = raw.links
      .map((link) => {
        if (!isRecord(link)) {
          return null;
        }

        const source = typeof link.source === "string" ? link.source.trim() : "";
        const target = typeof link.target === "string" ? link.target.trim() : "";
        if (source.length === 0 || target.length === 0) {
          return null;
        }

        return {
          source,
          target,
          condition: normalizeCondition(link.condition)
        };
      })
      .filter((link): link is NonNullable<typeof link> => link !== null);
  } else if (raw.links !== undefined) {
    normalized.links = raw.links;
  }

  if (Array.isArray(raw.qualityGates)) {
    normalized.qualityGates = raw.qualityGates
      .map((gate) => {
        if (!isRecord(gate)) {
          return null;
        }

        const name = typeof gate.name === "string" ? gate.name.trim() : "";
        if (name.length === 0) {
          return null;
        }

        return {
          name,
          target: typeof gate.target === "string" && gate.target.trim().length > 0 ? gate.target.trim() : undefined,
          kind: normalizeQualityGateKind(gate.kind),
          blocking: typeof gate.blocking === "boolean" ? gate.blocking : undefined,
          pattern: typeof gate.pattern === "string" ? gate.pattern : undefined,
          flags: typeof gate.flags === "string" ? gate.flags : undefined,
          jsonPath: typeof gate.jsonPath === "string" ? gate.jsonPath : undefined,
          artifactPath: typeof gate.artifactPath === "string" ? gate.artifactPath : undefined,
          message: typeof gate.message === "string" ? gate.message : undefined
        };
      })
      .filter((gate): gate is NonNullable<typeof gate> => gate !== null);
  } else if (raw.qualityGates !== undefined) {
    normalized.qualityGates = raw.qualityGates;
  }

  return normalized;
}

export function normalizeFlowDecision(raw: unknown): unknown {
  if (!isRecord(raw)) {
    return raw;
  }

  const messageValue =
    typeof raw.message === "string"
      ? raw.message
      : typeof raw.reply === "string"
        ? raw.reply
        : typeof raw.response === "string"
          ? raw.response
          : raw.answer;

  const flowValue =
    raw.flow ??
    raw.workflow ??
    raw.graph ??
    (isRecord(raw.result) ? raw.result.flow ?? raw.result.workflow : undefined);

  const normalized: Record<string, unknown> = {
    action: normalizeAction(raw.action ?? raw.intent ?? raw.mode ?? raw.type),
    message: typeof messageValue === "string" ? messageValue.trim() : messageValue
  };

  const questionsValue =
    raw.questions ??
    raw.followUpQuestions ??
    raw.follow_up_questions ??
    raw.clarificationQuestions ??
    raw.clarification_questions;
  const normalizedQuestions = normalizeQuestions(questionsValue);
  if (normalizedQuestions) {
    normalized.questions = normalizedQuestions;
  }

  if (flowValue !== undefined) {
    normalized.flow = normalizeGeneratedFlow(flowValue);
  }
  return normalized;
}
