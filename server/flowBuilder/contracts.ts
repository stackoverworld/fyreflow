import type {
  PipelineInput,
  ProviderId,
  ReasoningEffort
} from "../types.js";

export interface FlowChatMessage {
  role: "user" | "assistant";
  content: string;
}

export type FlowBuilderAction = "answer" | "update_current_flow" | "replace_flow";

export interface FlowBuilderQuestionOption {
  label: string;
  value: string;
  description?: string;
}

export interface FlowBuilderQuestion {
  id: string;
  question: string;
  options: FlowBuilderQuestionOption[];
}

export interface FlowBuilderRequest {
  prompt: string;
  providerId: ProviderId;
  model: string;
  reasoningEffort?: ReasoningEffort;
  fastMode?: boolean;
  use1MContext?: boolean;
  history?: FlowChatMessage[];
  currentDraft?: PipelineInput;
  availableMcpServers?: Array<{
    id: string;
    name: string;
    enabled?: boolean;
    transport?: "stdio" | "http" | "sse";
    summary?: string;
  }>;
}

export interface FlowBuilderResponse {
  action: FlowBuilderAction;
  message: string;
  draft?: PipelineInput;
  questions?: FlowBuilderQuestion[];
  source: "model" | "fallback";
  notes: string[];
  rawOutput?: string;
}

export interface DraftOnlyResult {
  draft: PipelineInput;
  source: "model" | "fallback";
  notes: string[];
  rawOutput?: string;
}

export interface DraftActionResult {
  action: FlowBuilderAction;
  draft?: PipelineInput;
  notes: string[];
}
