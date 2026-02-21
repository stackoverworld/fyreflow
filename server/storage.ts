import { DB_PATH } from "./storage/helpers.js";
import {
  bootstrapStorageState,
  cloneProviderConfigs,
  cloneStorageState,
  createMcpServer,
  createPipeline,
  createRun,
  deleteMcpServer,
  deletePipeline,
  getPipeline,
  getRun,
  listMcpServers,
  listPipelines,
  listRuns,
  persistStorageStateForFacade,
  upsertProvider,
  updateMcpServer,
  updatePipeline,
  updateRun,
  updateStorageConfig
} from "./storage/orchestration.js";
import type {
  DashboardState,
  McpServerConfig,
  Pipeline,
  PipelineInput,
  PipelineRun,
  ProviderConfig,
  ProviderId,
  ProviderUpdateInput,
  McpServerInput,
  StorageConfig,
  StorageUpdateInput
} from "./types.js";
import type { RunInputs } from "./runInputs.js";

export class LocalStore {
  private state: DashboardState;

  constructor(private readonly dbPath: string = DB_PATH) {
    this.state = bootstrapStorageState(this.dbPath);
  }

  private persist(): void {
    persistStorageStateForFacade(this.dbPath, this.state);
  }

  getState(): DashboardState {
    return cloneStorageState(this.state);
  }

  getProviders(): Record<ProviderId, ProviderConfig> {
    return cloneProviderConfigs(this.state);
  }

  listPipelines(): Pipeline[] {
    return listPipelines(this.state);
  }

  getPipeline(id: string): Pipeline | undefined {
    return getPipeline(this.state, id);
  }

  createPipeline(input: PipelineInput): Pipeline {
    const pipeline = createPipeline(this.state, input);
    this.persist();
    return pipeline;
  }

  updatePipeline(id: string, input: PipelineInput): Pipeline | undefined {
    const updated = updatePipeline(this.state, id, input);
    if (!updated) {
      return undefined;
    }

    this.persist();
    return updated;
  }

  deletePipeline(id: string): boolean {
    const deleted = deletePipeline(this.state, id);
    if (!deleted) {
      return false;
    }

    this.persist();
    return true;
  }

  upsertProvider(providerId: ProviderId, input: ProviderUpdateInput): ProviderConfig {
    const updated = upsertProvider(this.state, providerId, input);
    this.persist();
    return updated;
  }

  listMcpServers(): McpServerConfig[] {
    return listMcpServers(this.state);
  }

  createMcpServer(input: McpServerInput): McpServerConfig {
    const server = createMcpServer(this.state, input);
    this.persist();
    return server;
  }

  updateMcpServer(id: string, input: Partial<McpServerInput>): McpServerConfig | undefined {
    const updated = updateMcpServer(this.state, id, input);
    if (!updated) {
      return undefined;
    }

    this.persist();
    return updated;
  }

  deleteMcpServer(id: string): boolean {
    const deleted = deleteMcpServer(this.state, id);
    if (!deleted) {
      return false;
    }

    this.persist();
    return true;
  }

  updateStorageConfig(input: StorageUpdateInput): StorageConfig {
    const updated = updateStorageConfig(this.state, input);
    this.persist();
    return updated;
  }

  createRun(pipeline: Pipeline, task: string, rawInputs?: RunInputs, scenario?: string): PipelineRun {
    const run = createRun(this.state, pipeline, task, rawInputs, scenario);
    this.persist();
    return run;
  }

  getRun(runId: string): PipelineRun | undefined {
    return getRun(this.state, runId);
  }

  updateRun(runId: string, updater: (run: PipelineRun) => PipelineRun): PipelineRun | undefined {
    const updated = updateRun(this.state, runId, updater);
    if (!updated) {
      return undefined;
    }

    this.persist();
    return updated;
  }

  listRuns(limit = 30): PipelineRun[] {
    return listRuns(this.state, limit);
  }
}
