import fs from "node:fs/promises";
import type { PipelineStep, StepQualityGateResult } from "../types.js";
import type { ArtifactStateCheck } from "./artifacts.js";

export interface StepSkipArtifactsValidationResult {
  ok: boolean;
  reason?: string;
}

interface StepPolicyProfileDefinition {
  id: string;
  summary: string;
  inferFromStep?: (step: PipelineStep) => boolean;
  defaultCacheBypassInputKeys?: string[];
  defaultCacheBypassOrchestratorPromptPatterns?: string[];
  validateSkipArtifacts?: (
    step: PipelineStep,
    states: ArtifactStateCheck[]
  ) => Promise<StepSkipArtifactsValidationResult>;
  evaluateArtifactContracts?: (
    step: PipelineStep,
    afterSnapshots: ArtifactStateCheck[]
  ) => Promise<StepQualityGateResult[]>;
}

const MIN_FRAME_MAP_BYTES = 256;
const MAX_DESIGN_ASSETS_MANIFEST_BYTES = 8 * 1024 * 1024;
const FRAME_ASSET_FILE_REF_PATTERN = /"file"\s*:\s*"assets\/frame-[^"]+\.(?:png|jpe?g|webp|gif|svg)"/i;
const INLINE_DATA_URI_PATTERN = /"backgroundImageBase64"\s*:\s*"data:image\//i;

function normalizeProfileId(value: string): string {
  return value.trim().toLowerCase();
}

function uniqueStrings(values: string[]): string[] {
  const seen = new Set<string>();
  const normalized: string[] = [];
  for (const value of values) {
    const key = value.trim();
    if (key.length === 0 || seen.has(key)) {
      continue;
    }
    seen.add(key);
    normalized.push(key);
  }
  return normalized;
}

function extractFrameCountFromMap(value: unknown): number | null {
  if (typeof value !== "object" || value === null) {
    return null;
  }
  const record = value as Record<string, unknown>;
  const totalFrames = record.totalFrames;
  if (typeof totalFrames === "number" && Number.isFinite(totalFrames) && totalFrames > 0) {
    return Math.floor(totalFrames);
  }
  const frameCount = record.frameCount;
  if (typeof frameCount === "number" && Number.isFinite(frameCount) && frameCount > 0) {
    return Math.floor(frameCount);
  }
  const frames = record.frames;
  if (Array.isArray(frames) && frames.length > 0) {
    return frames.length;
  }
  const slideMap = record.slideMap;
  if (Array.isArray(slideMap) && slideMap.length > 0) {
    return slideMap.length;
  }
  return null;
}

function findArtifactState(states: ArtifactStateCheck[], pattern: string): ArtifactStateCheck | undefined {
  const normalizedPattern = pattern.toLowerCase();
  return states.find((entry) => entry.template.toLowerCase().includes(normalizedPattern));
}

function includesDesignAssetTemplates(step: PipelineStep): boolean {
  const templates = [...step.requiredOutputFiles, ...step.skipIfArtifacts].map((entry) => entry.toLowerCase());
  const hasAssetsManifest = templates.some((entry) => entry.includes("assets-manifest.json"));
  const hasFrameMap = templates.some((entry) => entry.includes("frame-map.json"));
  return hasAssetsManifest && hasFrameMap;
}

async function validateDesignDeckSkipArtifacts(
  _step: PipelineStep,
  states: ArtifactStateCheck[]
): Promise<StepSkipArtifactsValidationResult> {
  const frameState = findArtifactState(states, "frame-map.json");
  const manifestState = findArtifactState(states, "assets-manifest.json");
  if (!frameState || !frameState.exists || !frameState.foundPath) {
    return { ok: false, reason: "frame-map.json is missing or unreadable" };
  }
  if (!manifestState || !manifestState.exists || !manifestState.foundPath) {
    return { ok: false, reason: "assets-manifest.json is missing or unreadable" };
  }

  if ((frameState.sizeBytes ?? 0) < MIN_FRAME_MAP_BYTES) {
    return { ok: false, reason: "frame-map.json is too small for safe cache reuse" };
  }
  if ((manifestState.sizeBytes ?? 0) <= 0) {
    return { ok: false, reason: "assets-manifest.json is empty" };
  }
  if ((manifestState.sizeBytes ?? 0) > MAX_DESIGN_ASSETS_MANIFEST_BYTES) {
    return { ok: false, reason: "assets-manifest.json exceeds size limit for cache reuse" };
  }

  try {
    const [frameRaw, manifestRaw] = await Promise.all([
      fs.readFile(frameState.foundPath, "utf8"),
      fs.readFile(manifestState.foundPath, "utf8")
    ]);
    const frameParsed = JSON.parse(frameRaw);
    const manifestParsed = JSON.parse(manifestRaw);
    if (extractFrameCountFromMap(frameParsed) === null) {
      return { ok: false, reason: "frame-map.json has no valid frame count" };
    }
    if (typeof manifestParsed !== "object" || manifestParsed === null) {
      return { ok: false, reason: "assets-manifest.json must be a JSON object" };
    }
    if (!FRAME_ASSET_FILE_REF_PATTERN.test(manifestRaw)) {
      return { ok: false, reason: "assets-manifest.json has no reusable assets/frame-* file references" };
    }
    if (
      INLINE_DATA_URI_PATTERN.test(manifestRaw) &&
      (manifestState.sizeBytes ?? 0) > MAX_DESIGN_ASSETS_MANIFEST_BYTES / 2
    ) {
      return { ok: false, reason: "assets-manifest.json contains large inline data:image payloads" };
    }
    return { ok: true };
  } catch {
    return { ok: false, reason: "failed to parse frame-map.json or assets-manifest.json" };
  }
}

async function buildDesignDeckManifestContractResults(
  step: PipelineStep,
  afterSnapshots: ArtifactStateCheck[]
): Promise<StepQualityGateResult[]> {
  const manifestSnapshot = findArtifactState(afterSnapshots, "assets-manifest.json");
  if (!manifestSnapshot || manifestSnapshot.disabledStorage || !manifestSnapshot.exists || !manifestSnapshot.foundPath) {
    return [];
  }

  const manifestSize = manifestSnapshot.sizeBytes ?? 0;
  if (manifestSize > MAX_DESIGN_ASSETS_MANIFEST_BYTES) {
    return [
      {
        gateId: `contract-design-assets-manifest-size-${step.id}`,
        gateName: "Design assets manifest is oversized",
        kind: "step_contract",
        status: "fail",
        blocking: true,
        message: `assets-manifest.json is too large (${manifestSize} bytes). Use file references under shared/assets instead of inline base64 payloads.`,
        details: `path=${manifestSnapshot.foundPath}, maxBytes=${MAX_DESIGN_ASSETS_MANIFEST_BYTES}`
      }
    ];
  }

  let manifestRaw = "";
  try {
    manifestRaw = await fs.readFile(manifestSnapshot.foundPath, "utf8");
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "unknown read error";
    return [
      {
        gateId: `contract-design-assets-manifest-read-${step.id}`,
        gateName: "Design assets manifest is unreadable",
        kind: "step_contract",
        status: "fail",
        blocking: true,
        message: "Could not read assets-manifest.json after extraction.",
        details: `path=${manifestSnapshot.foundPath}, error=${errorMessage}`
      }
    ];
  }

  if (INLINE_DATA_URI_PATTERN.test(manifestRaw)) {
    return [
      {
        gateId: `contract-design-assets-manifest-inline-${step.id}`,
        gateName: "Design assets manifest contains inline base64 payloads",
        kind: "step_contract",
        status: "fail",
        blocking: true,
        message: "assets-manifest.json must be metadata-only (file references). Inline data URIs are not allowed.",
        details: `path=${manifestSnapshot.foundPath}`
      }
    ];
  }

  if (!FRAME_ASSET_FILE_REF_PATTERN.test(manifestRaw)) {
    return [
      {
        gateId: `contract-design-assets-manifest-filerefs-${step.id}`,
        gateName: "Design assets manifest has no reusable file references",
        kind: "step_contract",
        status: "fail",
        blocking: true,
        message: "assets-manifest.json must include reusable assets/* file references.",
        details: `path=${manifestSnapshot.foundPath}`
      }
    ];
  }

  return [];
}

const POLICY_PROFILES: StepPolicyProfileDefinition[] = [
  {
    id: "design_deck_assets",
    summary: "Contracts for design-deck extraction artifacts (frame-map/assets-manifest).",
    inferFromStep: includesDesignAssetTemplates,
    defaultCacheBypassInputKeys: ["force_refresh_design_assets", "force_design_assets_refresh"],
    validateSkipArtifacts: validateDesignDeckSkipArtifacts,
    evaluateArtifactContracts: buildDesignDeckManifestContractResults
  }
];

const POLICY_PROFILE_BY_ID = new Map(POLICY_PROFILES.map((profile) => [normalizeProfileId(profile.id), profile]));

function resolveProfilesForStep(step: PipelineStep): StepPolicyProfileDefinition[] {
  const explicitProfileIds = Array.isArray(step.policyProfileIds)
    ? step.policyProfileIds
        .filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0)
        .map((entry) => normalizeProfileId(entry))
    : [];

  const selectedProfiles: StepPolicyProfileDefinition[] = [];
  const seenIds = new Set<string>();

  for (const profileId of explicitProfileIds) {
    const profile = POLICY_PROFILE_BY_ID.get(profileId);
    if (!profile || seenIds.has(profile.id)) {
      continue;
    }
    seenIds.add(profile.id);
    selectedProfiles.push(profile);
  }

  if (selectedProfiles.length > 0) {
    return selectedProfiles;
  }

  for (const profile of POLICY_PROFILES) {
    if (!profile.inferFromStep || !profile.inferFromStep(step) || seenIds.has(profile.id)) {
      continue;
    }
    seenIds.add(profile.id);
    selectedProfiles.push(profile);
  }

  return selectedProfiles;
}

export function listAvailablePolicyProfiles(): Array<{ id: string; summary: string }> {
  return POLICY_PROFILES.map((profile) => ({ id: profile.id, summary: profile.summary }));
}

export function resolvePolicyProfileIdsForStep(step: PipelineStep): string[] {
  return resolveProfilesForStep(step).map((profile) => profile.id);
}

export function resolveCacheBypassInputKeysForStep(step: PipelineStep): string[] {
  const profileDefaults = resolveProfilesForStep(step).flatMap((profile) => profile.defaultCacheBypassInputKeys ?? []);
  const stepKeys = Array.isArray(step.cacheBypassInputKeys)
    ? step.cacheBypassInputKeys.filter((entry): entry is string => typeof entry === "string")
    : [];
  return uniqueStrings([...profileDefaults, ...stepKeys].map((entry) => entry.trim().toLowerCase()).filter(Boolean));
}

export function resolveCacheBypassOrchestratorPromptPatternsForStep(step: PipelineStep): string[] {
  const profileDefaults = resolveProfilesForStep(step).flatMap(
    (profile) => profile.defaultCacheBypassOrchestratorPromptPatterns ?? []
  );
  const stepPatterns = Array.isArray(step.cacheBypassOrchestratorPromptPatterns)
    ? step.cacheBypassOrchestratorPromptPatterns.filter((entry): entry is string => typeof entry === "string")
    : [];
  return uniqueStrings([...profileDefaults, ...stepPatterns].map((entry) => entry.trim()).filter(Boolean));
}

export async function validateStepSkipArtifactsQuality(
  step: PipelineStep,
  states: ArtifactStateCheck[]
): Promise<StepSkipArtifactsValidationResult> {
  for (const profile of resolveProfilesForStep(step)) {
    if (!profile.validateSkipArtifacts) {
      continue;
    }
    const result = await profile.validateSkipArtifacts(step, states);
    if (!result.ok) {
      return result;
    }
  }

  return { ok: true };
}

export async function evaluateArtifactContractsForStepProfiles(
  step: PipelineStep,
  afterSnapshots: ArtifactStateCheck[]
): Promise<StepQualityGateResult[]> {
  const profileResults: StepQualityGateResult[] = [];
  for (const profile of resolveProfilesForStep(step)) {
    if (!profile.evaluateArtifactContracts) {
      continue;
    }
    const results = await profile.evaluateArtifactContracts(step, afterSnapshots);
    if (results.length === 0) {
      continue;
    }
    profileResults.push(...results);
  }
  return profileResults;
}
