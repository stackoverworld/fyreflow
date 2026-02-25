import type { Dispatch, SetStateAction } from "react";
import { type ModelCatalogEntry } from "@/lib/modelCatalog";
import type { LinkCondition, PipelinePayload, PipelineRun, ProviderId, ReasoningEffort } from "@/lib/types";

export interface PipelineEditorMcpServer {
  id: string;
  name: string;
  enabled: boolean;
}

export interface PipelineEditorProps {
  draft: PipelinePayload;
  activeRun?: PipelineRun | null;
  startingRun?: boolean;
  debugPreviewDispatchRouteId?: string | null;
  readOnly?: boolean;
  modelCatalog: Record<ProviderId, ModelCatalogEntry[]>;
  mcpServers: PipelineEditorMcpServer[];
  claudeFastModeAvailable: boolean;
  claudeFastModeUnavailableNote?: string;
  onChange: (next: PipelinePayload) => void;
  onAddStep?: () => void;
  onSpawnOrchestrator?: () => void;
  hasOrchestrator?: boolean;
  onCanvasDragStateChange?: (active: boolean) => void;
  onStepPanelChange?: (open: boolean) => void;
  stepPanelBlocked?: boolean;
  className?: string;
}

export interface PipelineEditorCanvasSelection {
  nodeIds: string[];
  primaryNodeId: string | null;
  linkId: string | null;
  isDragStart?: boolean;
}

export interface PipelineEditorCanvasNode {
  id: string;
  name: string;
  role: PipelinePayload["steps"][number]["role"];
  providerId: PipelinePayload["steps"][number]["providerId"];
  model: string;
  position: {
    x: number;
    y: number;
  };
  enableDelegation?: boolean;
  delegationCount?: number;
  fastMode?: boolean;
  use1MContext?: boolean;
  enableIsolatedStorage?: boolean;
  enableSharedStorage?: boolean;
}

export interface PipelineEditorCanvasLink {
  id: string;
  sourceStepId: string;
  targetStepId: string;
  condition: LinkCondition;
}

export interface PipelineEditorState {
  selectedStepId: string | null;
  selectedStepIds: string[];
  selectedLinkId: string | null;
  pendingTargetId: string;
  pendingCondition: LinkCondition;
  setPendingTargetId: (nextTargetId: string) => void;
  setPendingCondition: (nextCondition: LinkCondition) => void;
  setSelectedStepId: Dispatch<SetStateAction<string | null>>;
  removeSelectedStep: () => void;
  selectedStepIndex: number;
  selectedStep: PipelinePayload["steps"][number] | undefined;
  selectedModelMeta: ModelCatalogEntry | undefined;
  reasoningModes: ReasoningEffort[];
  providerDefaultModel: string;
  canvasNodes: PipelineEditorCanvasNode[];
  canvasLinks: PipelineEditorCanvasLink[];
  animatedNodeIds: string[];
  animatedLinkIds: string[];
  stepNameById: Map<string, string>;
  outgoingLinks: PipelinePayload["links"];
  incomingLinks: PipelinePayload["links"];
  removeStepsByIds: (stepIds: string[]) => void;
  removeLinkById: (linkId: string) => void;
  applyAutoLayout: () => void;
  handleCanvasSelectionChange: (selection: PipelineEditorCanvasSelection) => void;
  handleCanvasMoveNode: (nodeId: string, position: { x: number; y: number }) => void;
  handleCanvasMoveNodes: (updates: Array<{ nodeId: string; position: { x: number; y: number } }>) => void;
  handleCanvasConnectNodes: (sourceNodeId: string, targetNodeId: string) => void;
  patchSelectedStep: (patch: Partial<PipelinePayload["steps"][number]>) => void;
  addConnectionFromSelectedStep: (targetStepId: string, condition: LinkCondition) => void;
  updateConnectionCondition: (linkId: string, condition: LinkCondition) => void;
}

export interface GeneralSectionProps {
  draft: PipelinePayload;
  readOnly: boolean;
  modelCatalog: Record<ProviderId, ModelCatalogEntry[]>;
  mcpServers: PipelineEditorMcpServer[];
  claudeFastModeAvailable: boolean;
  claudeFastModeUnavailableNote?: string;
  selectedStep: PipelinePayload["steps"][number];
  selectedStepIndex: number;
  selectedModelMeta?: ModelCatalogEntry;
  reasoningModes: ReasoningEffort[];
  providerDefaultModel: string;
  pendingTargetId: string;
  pendingCondition: LinkCondition;
  stepNameById: Map<string, string>;
  outgoingLinks: PipelinePayload["links"];
  incomingLinks: PipelinePayload["links"];
  setPendingTargetId: (nextTargetId: string) => void;
  setPendingCondition: (nextCondition: LinkCondition) => void;
  onPatchSelectedStep: (patch: Partial<PipelinePayload["steps"][number]>) => void;
  onAddConnection: (targetStepId: string, condition: LinkCondition) => void;
  onUpdateLinkCondition: (linkId: string, condition: LinkCondition) => void;
  onRemoveLink: (linkId: string) => void;
}

export interface QualityGatesSectionProps {
  draft: PipelinePayload;
  readOnly: boolean;
  onChange: (next: PipelinePayload) => void;
}

export interface ScheduleSectionProps {
  draft: PipelinePayload;
  readOnly: boolean;
  onChange: (next: PipelinePayload) => void;
}
