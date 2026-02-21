import type {
  PipelineLink,
  PipelineQualityGate,
  PipelineStep,
  StepQualityGateResult,
  WorkflowOutcome
} from "../../types.js";
import type { StepStoragePaths } from "../types.js";
import { checkArtifactExists } from "../artifacts.js";
import type { RunInputs } from "../../runInputs.js";
import type { StepContractEvaluationResult } from "./contracts.js";
import { parseJsonOutput, resolvePathValue } from "./normalizers.js";

function normalizeRegexFlags(rawFlags: string): string {
  const allowed = new Set(["g", "i", "m", "s", "u", "y"]);
  const deduped: string[] = [];
  for (const flag of rawFlags) {
    if (!allowed.has(flag) || deduped.includes(flag)) {
      continue;
    }
    deduped.push(flag);
  }
  return deduped.join("");
}

export async function evaluateStepContracts(
  step: PipelineStep,
  output: string,
  storagePaths: StepStoragePaths,
  runInputs: RunInputs
): Promise<StepContractEvaluationResult> {
  const gateResults: StepQualityGateResult[] = [];
  let parsedJson: Record<string, unknown> | null = null;

  if (step.outputFormat === "json") {
    parsedJson = parseJsonOutput(output);
    const jsonValid = parsedJson !== null;

    gateResults.push({
      gateId: `contract-json-format-${step.id}`,
      gateName: "Step output must be valid JSON",
      kind: "step_contract",
      status: jsonValid ? "pass" : "fail",
      blocking: true,
      message: jsonValid
        ? "Step produced valid JSON output."
        : "Step is configured for JSON output but the output is not valid JSON.",
      details: jsonValid ? "JSON parser check passed." : output.slice(0, 400)
    });
  }

  if (step.requiredOutputFields.length > 0) {
    const payload = parsedJson ?? parseJsonOutput(output);
    parsedJson = payload;

    if (!payload) {
      for (const fieldPath of step.requiredOutputFields) {
        gateResults.push({
          gateId: `contract-json-field-${step.id}-${fieldPath}`,
          gateName: `Required field: ${fieldPath}`,
          kind: "step_contract",
          status: "fail",
          blocking: true,
          message: `Cannot verify required field "${fieldPath}" because output is not valid JSON.`,
          details: "Step output JSON parse failed."
        });
      }
    } else {
      for (const fieldPath of step.requiredOutputFields) {
        const value = resolvePathValue(payload, fieldPath);
        gateResults.push({
          gateId: `contract-json-field-${step.id}-${fieldPath}`,
          gateName: `Required field: ${fieldPath}`,
          kind: "step_contract",
          status: value.found ? "pass" : "fail",
          blocking: true,
          message: value.found
            ? `Required field "${fieldPath}" is present.`
            : `Required field "${fieldPath}" is missing from output JSON.`,
          details: value.found ? `Value: ${JSON.stringify(value.value).slice(0, 260)}` : "Path lookup failed."
        });
      }
    }
  }

  for (const fileTemplate of step.requiredOutputFiles) {
    const artifactCheck = await checkArtifactExists(fileTemplate, storagePaths, runInputs);
    gateResults.push({
      gateId: `contract-artifact-${step.id}-${fileTemplate}`,
      gateName: `Required artifact: ${fileTemplate}`,
      kind: "step_contract",
      status: artifactCheck.exists ? "pass" : "fail",
      blocking: true,
      message: artifactCheck.exists
        ? `Required artifact exists: ${artifactCheck.foundPath}`
        : `Required artifact is missing: ${fileTemplate}`,
      details: artifactCheck.disabledStorage
        ? "Storage mode required by this artifact path is disabled for this step."
        : artifactCheck.paths.length > 0
          ? `Checked paths: ${artifactCheck.paths.join(" | ")}`
          : "No candidate artifact paths were resolved."
    });
  }

  return { parsedJson, gateResults };
}

export async function evaluatePipelineQualityGates(
  step: PipelineStep,
  output: string,
  parsedJson: Record<string, unknown> | null,
  qualityGates: PipelineQualityGate[],
  storagePaths: StepStoragePaths,
  runInputs: RunInputs
): Promise<StepQualityGateResult[]> {
  const relevant = qualityGates.filter(
    (gate) => gate.targetStepId === "any_step" || gate.targetStepId === step.id
  );

  if (relevant.length === 0) {
    return [];
  }

  let cachedJson = parsedJson;
  const results: StepQualityGateResult[] = [];

  for (const gate of relevant) {
    if (gate.kind === "manual_approval") {
      continue;
    }

    if (gate.kind === "regex_must_match" || gate.kind === "regex_must_not_match") {
      if (!gate.pattern || gate.pattern.trim().length === 0) {
        results.push({
          gateId: gate.id,
          gateName: gate.name,
          kind: gate.kind,
          status: "fail",
          blocking: gate.blocking,
          message: gate.message || `Regex gate "${gate.name}" has empty pattern.`,
          details: "Define a regex pattern for this gate."
        });
        continue;
      }

      try {
        const regex = new RegExp(gate.pattern, normalizeRegexFlags(gate.flags));
        const matched = regex.test(output);
        const passed = gate.kind === "regex_must_match" ? matched : !matched;

        results.push({
          gateId: gate.id,
          gateName: gate.name,
          kind: gate.kind,
          status: passed ? "pass" : "fail",
          blocking: gate.blocking,
          message:
            gate.message ||
            (passed
              ? `Gate "${gate.name}" passed.`
              : gate.kind === "regex_must_match"
                ? `Output did not match required regex for gate "${gate.name}".`
                : `Output matched blocked regex for gate "${gate.name}".`),
          details: `pattern=${gate.pattern} flags=${gate.flags || "(none)"}`
        });
      } catch (error) {
        const reason = error instanceof Error ? error.message : "Invalid regex";
        results.push({
          gateId: gate.id,
          gateName: gate.name,
          kind: gate.kind,
          status: "fail",
          blocking: gate.blocking,
          message: gate.message || `Invalid regex in gate "${gate.name}".`,
          details: reason
        });
      }

      continue;
    }

    if (gate.kind === "json_field_exists") {
      if (!cachedJson) {
        cachedJson = parseJsonOutput(output);
      }

      if (!gate.jsonPath || gate.jsonPath.trim().length === 0) {
        results.push({
          gateId: gate.id,
          gateName: gate.name,
          kind: gate.kind,
          status: "fail",
          blocking: gate.blocking,
          message: gate.message || `JSON path is empty for gate "${gate.name}".`,
          details: "Set jsonPath in gate configuration."
        });
        continue;
      }

      const found = cachedJson ? resolvePathValue(cachedJson, gate.jsonPath).found : false;
      results.push({
        gateId: gate.id,
        gateName: gate.name,
        kind: gate.kind,
        status: found ? "pass" : "fail",
        blocking: gate.blocking,
        message:
          gate.message ||
          (found
            ? `JSON path "${gate.jsonPath}" exists.`
            : `JSON path "${gate.jsonPath}" is missing.`),
        details: cachedJson ? `path=${gate.jsonPath}` : "Output is not valid JSON."
      });
      continue;
    }

    if (gate.kind !== "artifact_exists") {
      results.push({
        gateId: gate.id,
        gateName: gate.name,
        kind: gate.kind,
        status: "fail",
        blocking: gate.blocking,
        message: gate.message || `Unsupported quality gate kind "${gate.kind}".`,
        details: "Gate kind is not supported by the evaluator."
      });
      continue;
    }

    if (!gate.artifactPath || gate.artifactPath.trim().length === 0) {
      results.push({
        gateId: gate.id,
        gateName: gate.name,
        kind: gate.kind,
        status: "fail",
        blocking: gate.blocking,
        message: gate.message || `Artifact path is empty for gate "${gate.name}".`,
        details: "Set artifactPath in gate configuration."
      });
      continue;
    }

    const artifactCheck = await checkArtifactExists(gate.artifactPath, storagePaths, runInputs);

    results.push({
      gateId: gate.id,
      gateName: gate.name,
      kind: gate.kind,
      status: artifactCheck.exists ? "pass" : "fail",
      blocking: gate.blocking,
      message:
        gate.message ||
        (artifactCheck.exists ? `Artifact found: ${artifactCheck.foundPath}` : `Artifact missing: ${gate.artifactPath}`),
      details: artifactCheck.disabledStorage
        ? "Storage policy disabled the required artifact path."
        : artifactCheck.paths.length > 0
          ? `Checked paths: ${artifactCheck.paths.join(" | ")}`
          : "No candidate artifact paths were resolved."
    });
  }

  return results;
}

export function routeMatchesCondition(condition: PipelineLink["condition"], outcome: WorkflowOutcome): boolean {
  if (condition === "on_pass") {
    return outcome === "pass";
  }

  if (condition === "on_fail") {
    return outcome === "fail";
  }

  return true;
}
