import { z } from "zod";
import type { RunInputRequest, RunStartupBlocker } from "../types.js";

export interface BuildStartupCheckInput {
  task?: string;
  inputs?: unknown;
}

export interface ParsedModelStartupResult {
  status?: "pass" | "needs_input" | "blocked";
  summary?: string;
  requests: RunInputRequest[];
  blockers: RunStartupBlocker[];
  notes: string[];
}

export const modelOptionSchema = z.object({
  value: z.string().min(1).max(400),
  label: z.string().min(1).max(180).optional(),
  description: z.string().min(1).max(400).optional()
});

export const modelRequestSchema = z.object({
  key: z.string().min(1).max(160).optional(),
  id: z.string().min(1).max(160).optional(),
  name: z.string().min(1).max(160).optional(),
  label: z.string().min(1).max(180).optional(),
  title: z.string().min(1).max(180).optional(),
  type: z.string().min(1).max(40).optional(),
  input_type: z.string().min(1).max(40).optional(),
  required: z.boolean().optional(),
  reason: z.string().min(1).max(800).optional(),
  message: z.string().min(1).max(800).optional(),
  placeholder: z.string().min(1).max(280).optional(),
  defaultValue: z.string().max(4000).optional(),
  default_value: z.string().max(4000).optional(),
  allowCustom: z.boolean().optional(),
  allow_custom: z.boolean().optional(),
  options: z
    .array(z.union([modelOptionSchema, z.string().min(1).max(400)]))
    .max(20)
    .optional()
});

export const modelBlockerSchema = z.object({
  id: z.string().min(1).max(180).optional(),
  title: z.string().min(1).max(200).optional(),
  message: z.string().min(1).max(800).optional(),
  details: z.string().min(1).max(800).optional(),
  reason: z.string().min(1).max(800).optional()
});

export const modelStartupSchema = z
  .object({
    status: z.enum(["pass", "needs_input", "blocked"]).optional(),
    summary: z.string().min(1).max(2000).optional(),
    requests: z.array(modelRequestSchema).max(30).optional(),
    input_requests: z.array(modelRequestSchema).max(30).optional(),
    blockers: z.array(modelBlockerSchema).max(30).optional(),
    notes: z.array(z.string().min(1).max(500)).max(20).optional()
  })
  .passthrough();
