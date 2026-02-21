import type { PipelinePayload, ProviderId } from "@/lib/types";
import type { ModelCatalogEntry } from "@/lib/modelCatalog";

export type EditorModelCatalog = Record<ProviderId, ModelCatalogEntry[]>;

export type EditorStepPatch = Partial<PipelinePayload["steps"][number]>;

export interface EditorNodeMove {
  nodeId: string;
  position: {
    x: number;
    y: number;
  };
}
