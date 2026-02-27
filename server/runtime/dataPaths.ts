import path from "node:path";

const DEFAULT_DATA_DIR = "data";

function normalizeDataDir(raw: string | undefined): string {
  const trimmed = raw?.trim() ?? "";
  if (trimmed.length === 0) {
    return DEFAULT_DATA_DIR;
  }
  return trimmed;
}

export function resolveDataRootPath(env: NodeJS.ProcessEnv = process.env, cwd: string = process.cwd()): string {
  const configured = normalizeDataDir(env.FYREFLOW_DATA_DIR);
  return path.resolve(cwd, configured);
}

export function resolveDataPath(...segments: string[]): string {
  return path.join(resolveDataRootPath(), ...segments);
}
