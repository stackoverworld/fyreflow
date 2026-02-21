import fs from "node:fs/promises";
import type { RunInputs } from "../runInputs.js";
import { resolveArtifactCandidatePaths } from "./context.js";
import type { StepStoragePaths } from "./types.js";

export interface ArtifactExistenceCheck {
  template: string;
  disabledStorage: boolean;
  paths: string[];
  foundPath: string | null;
  exists: boolean;
}

export async function pathExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

export async function checkArtifactExists(
  template: string,
  storagePaths: StepStoragePaths,
  runInputs: RunInputs
): Promise<ArtifactExistenceCheck> {
  const artifactCandidates = resolveArtifactCandidatePaths(template, storagePaths, runInputs);
  let foundPath: string | null = null;

  if (!artifactCandidates.disabledStorage) {
    for (const candidatePath of artifactCandidates.paths) {
      if (await pathExists(candidatePath)) {
        foundPath = candidatePath;
        break;
      }
    }
  }

  return {
    template,
    disabledStorage: artifactCandidates.disabledStorage,
    paths: artifactCandidates.paths,
    foundPath,
    exists: foundPath !== null
  };
}

export async function checkArtifactsExist(
  templates: string[],
  storagePaths: StepStoragePaths,
  runInputs: RunInputs
): Promise<ArtifactExistenceCheck[]> {
  const checks: ArtifactExistenceCheck[] = [];
  for (const template of templates) {
    checks.push(await checkArtifactExists(template, storagePaths, runInputs));
  }
  return checks;
}
