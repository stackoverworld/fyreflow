import { getDefaultModelForProvider, type ModelCatalogEntry } from "@/lib/modelCatalog";
import { type ProviderId } from "@/lib/types";
import type { GeneralSectionProps } from "../../types";

export const roles: GeneralSectionProps["selectedStep"]["role"][] = [
  "analysis",
  "planner",
  "orchestrator",
  "executor",
  "tester",
  "review"
];

export const linkConditions = ["always", "on_pass", "on_fail"] as const;

export const outputFormats = [
  { value: "markdown", label: "markdown" },
  { value: "json", label: "json" }
] as const;

export function getModelMeta(
  modelCatalog: Record<ProviderId, ModelCatalogEntry[]>,
  providerId: ProviderId,
  modelId: string
) {
  return modelCatalog[providerId]?.find((entry) => entry.id === modelId);
}

export function normalizeReasoning(
  modelCatalog: Record<ProviderId, ModelCatalogEntry[]>,
  providerId: ProviderId,
  modelId: string,
  requested: GeneralSectionProps["selectedStep"]["reasoningEffort"]
) {
  const model = getModelMeta(modelCatalog, providerId, modelId);
  const supported = model?.reasoningEfforts ?? ["minimal", "low", "medium", "high", "xhigh"];
  if (supported.includes(requested)) {
    return requested;
  }

  if (supported.includes("medium")) {
    return "medium";
  }

  return supported[0] ?? "medium";
}

export function resolvePreferredModel(modelCatalog: Record<ProviderId, ModelCatalogEntry[]>, providerId: ProviderId): string {
  const preferred = getDefaultModelForProvider(providerId);
  if (modelCatalog[providerId]?.some((entry) => entry.id === preferred)) {
    return preferred;
  }

  return modelCatalog[providerId]?.[0]?.id ?? preferred;
}

export function makeStepName(role: GeneralSectionProps["selectedStep"]["role"], index: number): string {
  return `${index + 1}. ${role[0].toUpperCase()}${role.slice(1)} Bot`;
}

export function parseLineList(raw: string, max = 40): string[] {
  return raw
    .split("\n")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0)
    .slice(0, max);
}

export function linkConditionLabel(condition: GeneralSectionProps["pendingCondition"]): string {
  if (condition === "on_pass") {
    return "on pass";
  }
  if (condition === "on_fail") {
    return "on fail";
  }
  return "always";
}

export function resolveCanvasLinkId(
  link: {
    id?: string;
    sourceStepId: string;
    targetStepId: string;
    condition?: string;
  },
  index: number
) {
  if (link.id && link.id.length > 0) {
    return link.id;
  }

  return `${link.sourceStepId}-${link.targetStepId}-${link.condition ?? "always"}-${index}`;
}
