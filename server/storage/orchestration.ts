import fs from "node:fs";
import path from "node:path";
import type {
  DashboardState,
  McpServerConfig,
  McpServerInput,
  Pipeline,
  PipelineInput,
  PipelineRun,
  ProviderConfig,
  ProviderId,
  ProviderUpdateInput,
  StorageConfig,
  StorageUpdateInput
} from "../types.js";
import type { RunInputs } from "../runInputs.js";
import type { StorageStateContainers } from "./contracts.js";
import {
  applyMcpServerUpdate,
  applyProviderUpdate,
  applyStorageConfigUpdate,
  createDefaultState,
  createMcpServerRecord,
  deepClone,
  sanitizeState,
  serializeStateForDisk
} from "./helpers.js";
import { withStorageLock } from "./locks.js";
import {
  createPipeline as createPipelineInState,
  deletePipeline as deletePipelineInState,
  getPipeline as getPipelineInState,
  listPipelines as listPipelinesInState,
  updatePipeline as updatePipelineInState
} from "./pipelineStore.js";
import {
  createRun as createRunInState,
  getRun as getRunInState,
  listRuns as listRunsInState,
  updateRun as updateRunInState
} from "./runStore.js";

export function initializeStorageDb(dbPath: string, createDefaultStateFn: () => DashboardState): void {
  const dir = path.dirname(dbPath);

  withStorageLock(() => {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    if (!fs.existsSync(dbPath)) {
      fs.writeFileSync(dbPath, JSON.stringify(createDefaultStateFn(), null, 2), "utf8");
    }
  });
}

export function loadStorageState(
  dbPath: string,
  sanitize: (state: DashboardState) => DashboardState
): DashboardState {
  return withStorageLock(() => {
    const raw = fs.readFileSync(dbPath, "utf8");
    const parsed = JSON.parse(raw) as DashboardState;
    return sanitize(parsed);
  });
}

export function persistStorageState(
  dbPath: string,
  state: DashboardState,
  serialize: (state: DashboardState) => DashboardState
): void {
  withStorageLock(() => {
    fs.writeFileSync(dbPath, JSON.stringify(serialize(state), null, 2), "utf8");
  });
}

export function bootstrapStorageState(dbPath: string): DashboardState {
  initializeStorageDb(dbPath, createDefaultState);
  return loadStorageState(dbPath, sanitizeState);
}

export function persistStorageStateForFacade(dbPath: string, state: DashboardState): void {
  persistStorageState(dbPath, state, serializeStateForDisk);
}

export function cloneStorageState(state: StorageStateContainers): DashboardState {
  return deepClone(state);
}

export function cloneProviderConfigs(state: StorageStateContainers): Record<ProviderId, ProviderConfig> {
  return deepClone(state.providers);
}

export function listPipelines(state: StorageStateContainers): Pipeline[] {
  return deepClone(listPipelinesInState(state));
}

export function getPipeline(state: StorageStateContainers, id: string): Pipeline | undefined {
  const pipeline = getPipelineInState(state, id);
  return pipeline ? deepClone(pipeline) : undefined;
}

export function createPipeline(state: StorageStateContainers, input: PipelineInput): Pipeline {
  const pipeline = createPipelineInState(state, input);
  return deepClone(pipeline);
}

export function updatePipeline(state: StorageStateContainers, id: string, input: PipelineInput): Pipeline | undefined {
  const updated = updatePipelineInState(state, id, input);
  return updated ? deepClone(updated) : undefined;
}

export function deletePipeline(state: StorageStateContainers, id: string): boolean {
  return deletePipelineInState(state, id);
}

export function upsertProvider(state: StorageStateContainers, providerId: ProviderId, input: ProviderUpdateInput): ProviderConfig {
  const updated = applyProviderUpdate(state.providers[providerId], input);
  state.providers[providerId] = updated;
  return deepClone(updated);
}

export function listMcpServers(state: StorageStateContainers): McpServerConfig[] {
  return deepClone(state.mcpServers);
}

export function createMcpServer(state: StorageStateContainers, input: McpServerInput): McpServerConfig {
  const server = createMcpServerRecord(input);
  state.mcpServers.unshift(server);
  state.mcpServers = state.mcpServers.slice(0, 40);
  return deepClone(server);
}

export function updateMcpServer(
  state: StorageStateContainers,
  id: string,
  input: Partial<McpServerInput>
): McpServerConfig | undefined {
  const index = state.mcpServers.findIndex((entry) => entry.id === id);
  if (index === -1) {
    return undefined;
  }

  const updated = applyMcpServerUpdate(state.mcpServers[index], input);
  state.mcpServers[index] = updated;
  return deepClone(updated);
}

export function deleteMcpServer(state: StorageStateContainers, id: string): boolean {
  const previousCount = state.mcpServers.length;
  state.mcpServers = state.mcpServers.filter((entry) => entry.id !== id);

  if (state.mcpServers.length === previousCount) {
    return false;
  }

  return true;
}

export function updateStorageConfig(state: StorageStateContainers, input: StorageUpdateInput): StorageConfig {
  const updated = applyStorageConfigUpdate(state.storage, input);
  state.storage = updated;
  return deepClone(updated);
}

export function createRun(
  state: StorageStateContainers,
  pipeline: Pipeline,
  task: string,
  rawInputs?: RunInputs,
  scenario?: string
): PipelineRun {
  const run = createRunInState(state, pipeline, task, rawInputs, scenario);
  return deepClone(run);
}

export function getRun(state: StorageStateContainers, runId: string): PipelineRun | undefined {
  const run = getRunInState(state, runId);
  return run ? deepClone(run) : undefined;
}

export function updateRun(state: StorageStateContainers, runId: string, updater: (run: PipelineRun) => PipelineRun): PipelineRun | undefined {
  const updated = updateRunInState(state, runId, updater);
  return updated ? deepClone(updated) : undefined;
}

export function listRuns(state: StorageStateContainers, limit = 30): PipelineRun[] {
  return deepClone(listRunsInState(state, limit));
}
