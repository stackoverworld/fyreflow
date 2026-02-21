import type { Pipeline, PipelineRun, SmartRunCheck } from "../../../types.js";
import type { LocalStore } from "../../../storage.js";
import type { generateFlowDraft } from "../../../flowBuilder.js";
import type { buildSmartRunPlan } from "../../../smartRun.js";
import type { buildRunStartupCheck } from "../../../startupCheck.js";
import type {
  deletePipelineSecureInputs,
  getPipelineSecureInputs,
  mergeRunInputsWithSecure,
  upsertPipelineSecureInputs
} from "../../../secureInputs.js";
import type { getProviderOAuthStatus, startProviderOAuthLogin, syncProviderOAuthToken } from "../../../oauth.js";
import type { normalizeRunInputs } from "../../../runInputs.js";

export interface PipelineRouteContext {
  store: LocalStore;
  queuePipelineRun: (options: {
    pipeline: Pipeline;
    task: string;
    rawInputs?: Record<string, string>;
    scenario?: string;
    persistSensitiveInputs: boolean;
  }) => Promise<PipelineRun>;
  isRunPreflightError: (error: unknown) => error is { failedChecks: SmartRunCheck[] };
  getProviderOAuthStatus: typeof getProviderOAuthStatus;
  startProviderOAuthLogin: typeof startProviderOAuthLogin;
  syncProviderOAuthToken: typeof syncProviderOAuthToken;
  buildSmartRunPlan: typeof buildSmartRunPlan;
  buildRunStartupCheck: typeof buildRunStartupCheck;
  generateFlowDraft: typeof generateFlowDraft;
  getPipelineSecureInputs: typeof getPipelineSecureInputs;
  mergeRunInputsWithSecure: typeof mergeRunInputsWithSecure;
  normalizeRunInputs: typeof normalizeRunInputs;
  upsertPipelineSecureInputs: typeof upsertPipelineSecureInputs;
  deletePipelineSecureInputs: typeof deletePipelineSecureInputs;
}
