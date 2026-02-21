import type { DashboardState, Pipeline, SmartRunCheck, SmartRunField, SmartRunPlan } from "../types.js";
import { getRunInputValue, normalizeRunInputs, type RunInputs } from "../runInputs.js";
import { collectFieldsFromPipeline } from "./planning.js";
import { collectRuntimeChecks } from "./guards.js";

export function validateRequiredInputs(fields: SmartRunField[], runInputs: RunInputs): SmartRunCheck[] {
  const checks: SmartRunCheck[] = [];

  for (const field of fields.filter((entry) => entry.required)) {
    const value = getRunInputValue(runInputs, field.key);
    const ok = typeof value === "string" && value.trim().length > 0;
    checks.push({
      id: `input:${field.key}`,
      title: `Input ${field.label}`,
      status: ok ? "pass" : "fail",
      message: ok ? "Provided." : "Required input is missing."
    });
  }

  return checks;
}

export async function buildSmartRunPlan(
  pipeline: Pipeline,
  state: DashboardState,
  rawInputs?: unknown
): Promise<SmartRunPlan> {
  const fields = collectFieldsFromPipeline(pipeline);
  const runInputs = normalizeRunInputs(rawInputs);
  const runtimeChecks = await collectRuntimeChecks(pipeline, state);
  const checks = [...runtimeChecks, ...validateRequiredInputs(fields, runInputs)];
  const canRun = checks.every((check) => check.status !== "fail");

  return {
    fields,
    checks,
    canRun
  };
}
