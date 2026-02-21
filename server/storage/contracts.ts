import type { DashboardState } from "../types.js";

export interface PipelineStateContainer {
  pipelines: DashboardState["pipelines"];
}

export interface RunStateContainer {
  runs: DashboardState["runs"];
}

export interface StorageStateContainers extends PipelineStateContainer, RunStateContainer {
  providers: DashboardState["providers"];
  mcpServers: DashboardState["mcpServers"];
  storage: DashboardState["storage"];
}
