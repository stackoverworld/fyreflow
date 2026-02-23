import { z } from "zod";

export const generatedFlowSchema = z.object({
  name: z.string().min(2).max(120).optional(),
  description: z.string().max(2000).optional(),
  runtime: z
    .object({
      maxLoops: z.number().int().min(0).max(12).optional(),
      maxStepExecutions: z.number().int().min(4).max(120).optional(),
      stageTimeoutMs: z.number().int().min(10000).max(18000000).optional()
    })
    .partial()
    .optional(),
  schedule: z
    .object({
      enabled: z.boolean().optional(),
      cron: z.string().max(120).optional(),
      timezone: z.string().max(120).optional(),
      task: z.string().max(16000).optional(),
      runMode: z.enum(["smart", "quick"]).optional(),
      inputs: z
        .record(z.string().max(4000))
        .refine((value) => Object.keys(value).length <= 120, {
          message: "Too many schedule inputs (max 120)."
        })
        .optional()
    })
    .optional(),
  steps: z
    .array(
      z.object({
        name: z.string().min(1).max(120),
        role: z.enum(["analysis", "planner", "orchestrator", "executor", "tester", "review"]).optional(),
        prompt: z.string().min(1).max(8000).optional(),
        contextTemplate: z.string().min(1).max(6000).optional(),
        enableDelegation: z.boolean().optional(),
        delegationCount: z.number().int().min(1).max(8).optional(),
        enableIsolatedStorage: z.boolean().optional(),
        enableSharedStorage: z.boolean().optional(),
        enabledMcpServerIds: z.array(z.string().min(1)).max(16).optional(),
        outputFormat: z.enum(["markdown", "json"]).optional(),
        requiredOutputFields: z.array(z.string().min(1)).max(40).optional(),
        requiredOutputFiles: z.array(z.string().min(1)).max(40).optional(),
        scenarios: z.array(z.string().min(1).max(80)).max(20).optional(),
        skipIfArtifacts: z.array(z.string().min(1).max(4000)).max(40).optional(),
        policyProfileIds: z.array(z.string().min(1).max(120)).max(20).optional(),
        cacheBypassInputKeys: z.array(z.string().min(1).max(160)).max(20).optional(),
        cacheBypassOrchestratorPromptPatterns: z.array(z.string().min(1).max(800)).max(20).optional()
      })
    )
    .min(1)
    .max(18),
  links: z
    .array(
      z.object({
        source: z.string().min(1),
        target: z.string().min(1),
        condition: z.enum(["always", "on_pass", "on_fail"]).optional()
      })
    )
    .optional(),
  qualityGates: z
    .array(
      z.object({
        name: z.string().min(1).max(160),
        target: z.string().min(1).optional(),
        kind: z.enum(["regex_must_match", "regex_must_not_match", "json_field_exists", "artifact_exists", "manual_approval"]),
        blocking: z.boolean().optional(),
        pattern: z.string().max(2000).optional(),
        flags: z.string().max(12).optional(),
        jsonPath: z.string().max(2000).optional(),
        artifactPath: z.string().max(4000).optional(),
        message: z.string().max(2000).optional()
      })
    )
    .max(80)
    .optional()
});

const flowQuestionOptionSchema = z.object({
  label: z.string().min(1).max(160),
  value: z.string().min(1).max(1200),
  description: z.string().max(320).optional()
});

const flowQuestionSchema = z.object({
  id: z
    .string()
    .min(1)
    .max(80)
    .regex(/^[a-z0-9_\-]+$/i),
  question: z.string().min(1).max(600),
  options: z.array(flowQuestionOptionSchema).min(1).max(6)
});

export const flowDecisionSchema = z.object({
  action: z.enum(["answer", "update_current_flow", "replace_flow"]),
  message: z.string().min(1).max(6000),
  questions: z.array(flowQuestionSchema).max(3).optional(),
  flow: generatedFlowSchema.optional()
});

export type GeneratedFlowSpec = z.infer<typeof generatedFlowSchema>;
export type FlowDecision = z.infer<typeof flowDecisionSchema>;
