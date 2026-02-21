import type { AgentRole, PipelineInput, PipelineStep, ProviderId, ReasoningEffort } from "../../types.js";
import type { GeneratedFlowSpec } from "../schema.js";

export interface DraftBuildRequest {
  prompt: string;
  providerId: ProviderId;
  model: string;
  reasoningEffort?: ReasoningEffort;
  fastMode?: boolean;
  use1MContext?: boolean;
}

export type DraftLinkCondition = "always" | "on_pass" | "on_fail";
export type DraftQualityGateKind = GeneratedFlowSpec["qualityGates"] extends Array<infer T extends { kind: unknown }>
  ? T["kind"]
  : never;

export interface DraftLink {
  source: string;
  target: string;
  condition?: DraftLinkCondition;
}

export interface DraftQualityGateSpec {
  name: string;
  target?: string;
  kind: DraftQualityGateKind;
  blocking?: boolean;
  pattern?: string;
  flags?: string;
  jsonPath?: string;
  artifactPath?: string;
  message?: string;
}

export type DraftFlow = Omit<GeneratedFlowSpec, "qualityGates" | "links"> & {
  links?: DraftLink[];
  qualityGates?: DraftQualityGateSpec[];
  steps: Array<
    Pick<PipelineStep, "name" | "prompt" | "role"> &
      Partial<
        Pick<
          PipelineStep,
          | "contextTemplate"
          | "enableDelegation"
          | "delegationCount"
          | "enableIsolatedStorage"
          | "enableSharedStorage"
          | "enabledMcpServerIds"
          | "outputFormat"
          | "requiredOutputFields"
          | "requiredOutputFiles"
          | "scenarios"
          | "skipIfArtifacts"
        >
      >
  > & { role?: AgentRole };
};

export type DraftStepRecord = PipelineInput["steps"][number];
