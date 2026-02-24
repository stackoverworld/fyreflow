import fs from "node:fs/promises";
import path from "node:path";
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
const ASSET_FILE_REF_PATTERN = /"file"\s*:\s*"assets\/[^"]+\.(?:png|jpe?g|webp|gif|svg)"/i;
const INLINE_DATA_URI_PATTERN = /"[^"]*(?:base64|image|background)[^"]*"\s*:\s*"data:image\//i;

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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function countObjectEntries(value: unknown, keyPattern?: RegExp): number | null {
  if (!isRecord(value)) {
    return null;
  }

  const entries = Object.entries(value).filter(([key, entryValue]) => {
    if (keyPattern && !keyPattern.test(key)) {
      return false;
    }
    return typeof entryValue === "object" && entryValue !== null;
  });
  if (entries.length === 0) {
    return null;
  }
  return entries.length;
}

function extractFrameCountFromMap(value: unknown): number | null {
  if (Array.isArray(value) && value.length > 0) {
    return value.length;
  }
  if (!isRecord(value)) {
    return null;
  }

  const record = value;
  const totalFrames = record.totalFrames;
  if (typeof totalFrames === "number" && Number.isFinite(totalFrames) && totalFrames > 0) {
    return Math.floor(totalFrames);
  }
  const frameCount = record.frameCount;
  if (typeof frameCount === "number" && Number.isFinite(frameCount) && frameCount > 0) {
    return Math.floor(frameCount);
  }
  const slideCount = record.slideCount;
  if (typeof slideCount === "number" && Number.isFinite(slideCount) && slideCount > 0) {
    return Math.floor(slideCount);
  }
  const frames = record.frames;
  if (Array.isArray(frames) && frames.length > 0) {
    return frames.length;
  }
  const frameOrder = record.frameOrder;
  if (Array.isArray(frameOrder) && frameOrder.length > 0) {
    return frameOrder.length;
  }
  const frameIds = record.frameIds;
  if (Array.isArray(frameIds) && frameIds.length > 0) {
    return frameIds.length;
  }
  const slideIds = record.slideIds;
  if (Array.isArray(slideIds) && slideIds.length > 0) {
    return slideIds.length;
  }
  const slides = record.slides;
  if (Array.isArray(slides) && slides.length > 0) {
    return slides.length;
  }
  const slideObjectCount = countObjectEntries(slides);
  if (slideObjectCount && slideObjectCount > 0) {
    return slideObjectCount;
  }
  const frameObjectCount = countObjectEntries(frames);
  if (frameObjectCount && frameObjectCount > 0) {
    return frameObjectCount;
  }
  const slideMap = record.slideMap;
  if (Array.isArray(slideMap) && slideMap.length > 0) {
    return slideMap.length;
  }
  const slideMapObjectCount = countObjectEntries(slideMap);
  if (slideMapObjectCount && slideMapObjectCount > 0) {
    return slideMapObjectCount;
  }
  const frameMap = record.frameMap;
  if (Array.isArray(frameMap) && frameMap.length > 0) {
    return frameMap.length;
  }
  const frameMapObjectCount = countObjectEntries(frameMap);
  if (frameMapObjectCount && frameMapObjectCount > 0) {
    return frameMapObjectCount;
  }

  const numericObjectCount = countObjectEntries(record, /^\d+$/);
  if (numericObjectCount && numericObjectCount > 0) {
    return numericObjectCount;
  }

  const figmaNodeObjectCount = countObjectEntries(record, /^\d+:\d+$/);
  if (figmaNodeObjectCount && figmaNodeObjectCount > 0) {
    return figmaNodeObjectCount;
  }

  return null;
}

function normalizeImageExtension(mimeToken: string): string {
  const normalized = mimeToken.trim().toLowerCase();
  if (normalized === "jpeg" || normalized === "jpg") {
    return "jpg";
  }
  if (normalized === "svg+xml" || normalized === "svg") {
    return "svg";
  }
  if (normalized === "webp") {
    return "webp";
  }
  if (normalized === "gif") {
    return "gif";
  }
  return "png";
}

function parseImageDataUri(value: string): { extension: string; bytes: Buffer } | null {
  const match = value.match(/^data:image\/([a-zA-Z0-9.+-]+);base64,([A-Za-z0-9+/=\s]+)$/);
  if (!match) {
    return null;
  }

  const payload = match[2].replace(/\s+/g, "");
  if (payload.length === 0) {
    return null;
  }

  try {
    return {
      extension: normalizeImageExtension(match[1]),
      bytes: Buffer.from(payload, "base64")
    };
  } catch {
    return null;
  }
}

async function normalizeFrameMapArtifact(frameMapPath: string): Promise<{ frameCount: number | null; parseError?: string }> {
  let frameRaw = "";
  try {
    frameRaw = await fs.readFile(frameMapPath, "utf8");
  } catch (error) {
    return {
      frameCount: null,
      parseError: error instanceof Error ? error.message : "unknown read error"
    };
  }

  let frameParsed: unknown;
  try {
    frameParsed = JSON.parse(frameRaw);
  } catch (error) {
    return {
      frameCount: null,
      parseError: error instanceof Error ? error.message : "unknown parse error"
    };
  }

  if (Array.isArray(frameParsed) && frameParsed.length > 0) {
    const normalizedPayload = {
      totalFrames: frameParsed.length,
      frameCount: frameParsed.length,
      frames: frameParsed
    };
    await fs.writeFile(frameMapPath, `${JSON.stringify(normalizedPayload, null, 2)}\n`, "utf8");
    return { frameCount: frameParsed.length };
  }

  if (!isRecord(frameParsed)) {
    return { frameCount: null };
  }

  const inferredCount = extractFrameCountFromMap(frameParsed);
  if (inferredCount === null) {
    return { frameCount: null };
  }

  let changed = false;
  if (typeof frameParsed.totalFrames !== "number" || !Number.isFinite(frameParsed.totalFrames) || frameParsed.totalFrames <= 0) {
    frameParsed.totalFrames = inferredCount;
    changed = true;
  }
  if (typeof frameParsed.frameCount !== "number" || !Number.isFinite(frameParsed.frameCount) || frameParsed.frameCount <= 0) {
    frameParsed.frameCount = inferredCount;
    changed = true;
  }
  if (changed) {
    await fs.writeFile(frameMapPath, `${JSON.stringify(frameParsed, null, 2)}\n`, "utf8");
  }

  return { frameCount: inferredCount };
}

async function normalizeManifestInlineDataUris(
  manifestPath: string
): Promise<{ converted: number; error?: string }> {
  let manifestRaw = "";
  try {
    manifestRaw = await fs.readFile(manifestPath, "utf8");
  } catch (error) {
    return {
      converted: 0,
      error: error instanceof Error ? error.message : "unknown read error"
    };
  }

  let manifestParsed: unknown;
  try {
    manifestParsed = JSON.parse(manifestRaw);
  } catch (error) {
    return {
      converted: 0,
      error: error instanceof Error ? error.message : "unknown parse error"
    };
  }

  if (!isRecord(manifestParsed) && !Array.isArray(manifestParsed)) {
    return { converted: 0 };
  }

  const assetRoot = path.dirname(manifestPath);
  const assetsDir = path.join(assetRoot, "assets");
  let converted = 0;
  const stack: unknown[] = [manifestParsed];

  while (stack.length > 0) {
    const current = stack.pop();
    if (Array.isArray(current)) {
      for (const value of current) {
        if (isRecord(value) || Array.isArray(value)) {
          stack.push(value);
        }
      }
      continue;
    }
    if (!isRecord(current)) {
      continue;
    }

    for (const [key, value] of Object.entries(current)) {
      if (typeof value === "string" && value.startsWith("data:image/")) {
        const parsedUri = parseImageDataUri(value);
        if (parsedUri) {
          converted += 1;
          const fileName = `frame-inline-${converted}.${parsedUri.extension}`;
          const assetRef = `assets/${fileName}`;
          try {
            await fs.mkdir(assetsDir, { recursive: true });
            await fs.writeFile(path.join(assetRoot, assetRef), parsedUri.bytes);
          } catch (error) {
            return {
              converted,
              error: error instanceof Error ? error.message : "unknown asset write error"
            };
          }
          if (typeof current.file !== "string" || current.file.trim().length === 0) {
            current.file = assetRef;
          }
          delete current[key];
          continue;
        }
      }

      if (isRecord(value) || Array.isArray(value)) {
        stack.push(value);
      }
    }
  }

  if (converted > 0) {
    await fs.writeFile(manifestPath, `${JSON.stringify(manifestParsed, null, 2)}\n`, "utf8");
  }

  return { converted };
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
    if (!ASSET_FILE_REF_PATTERN.test(manifestRaw)) {
      return { ok: false, reason: "assets-manifest.json has no reusable assets/* file references" };
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
  const gateResults: StepQualityGateResult[] = [];

  const frameSnapshot = findArtifactState(afterSnapshots, "frame-map.json");
  if (frameSnapshot && !frameSnapshot.disabledStorage && frameSnapshot.exists && frameSnapshot.foundPath) {
    const frameNormalization = await normalizeFrameMapArtifact(frameSnapshot.foundPath);
    if (frameNormalization.parseError) {
      gateResults.push({
        gateId: `contract-design-frame-map-parse-${step.id}`,
        gateName: "Design frame map is readable",
        kind: "step_contract",
        status: "fail",
        blocking: true,
        message: "Could not read or parse frame-map.json after extraction.",
        details: `path=${frameSnapshot.foundPath}, error=${frameNormalization.parseError}`
      });
    } else if (frameNormalization.frameCount === null) {
      gateResults.push({
        gateId: `contract-design-frame-map-count-${step.id}`,
        gateName: "Design frame map includes frame count",
        kind: "step_contract",
        status: "fail",
        blocking: true,
        message: "frame-map.json must include a usable frame count for downstream slide contracts.",
        details: `path=${frameSnapshot.foundPath}, expected=totalFrames|frameCount|slideCount|frames[]|slides[]|slideMap[]`
      });
    }
  }

  const manifestSnapshot = findArtifactState(afterSnapshots, "assets-manifest.json");
  if (!manifestSnapshot || manifestSnapshot.disabledStorage || !manifestSnapshot.exists || !manifestSnapshot.foundPath) {
    return gateResults;
  }

  const normalization = await normalizeManifestInlineDataUris(manifestSnapshot.foundPath);
  if (normalization.error) {
    gateResults.push({
      gateId: `contract-design-assets-manifest-normalize-${step.id}`,
      gateName: "Design assets manifest normalization completed",
      kind: "step_contract",
      status: "fail",
      blocking: true,
      message: "Could not normalize assets-manifest.json into file-based assets.",
      details: `path=${manifestSnapshot.foundPath}, error=${normalization.error}`
    });
    return gateResults;
  }

  let manifestSize = 0;
  try {
    const stats = await fs.stat(manifestSnapshot.foundPath);
    manifestSize = stats.size;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "unknown stat error";
    gateResults.push({
      gateId: `contract-design-assets-manifest-read-${step.id}`,
      gateName: "Design assets manifest is readable",
      kind: "step_contract",
      status: "fail",
      blocking: true,
      message: "Could not stat assets-manifest.json after extraction.",
      details: `path=${manifestSnapshot.foundPath}, error=${errorMessage}`
    });
    return gateResults;
  }

  if (manifestSize > MAX_DESIGN_ASSETS_MANIFEST_BYTES) {
    gateResults.push({
      gateId: `contract-design-assets-manifest-size-${step.id}`,
      gateName: "Design assets manifest is oversized",
      kind: "step_contract",
      status: "fail",
      blocking: true,
      message: `assets-manifest.json is too large (${manifestSize} bytes). Use file references under shared/assets instead of inline base64 payloads.`,
      details: `path=${manifestSnapshot.foundPath}, maxBytes=${MAX_DESIGN_ASSETS_MANIFEST_BYTES}`
    });
    return gateResults;
  }

  let manifestRaw = "";
  try {
    manifestRaw = await fs.readFile(manifestSnapshot.foundPath, "utf8");
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "unknown read error";
    gateResults.push({
      gateId: `contract-design-assets-manifest-read-${step.id}`,
      gateName: "Design assets manifest is unreadable",
      kind: "step_contract",
      status: "fail",
      blocking: true,
      message: "Could not read assets-manifest.json after extraction.",
      details: `path=${manifestSnapshot.foundPath}, error=${errorMessage}`
    });
    return gateResults;
  }

  if (INLINE_DATA_URI_PATTERN.test(manifestRaw)) {
    gateResults.push({
      gateId: `contract-design-assets-manifest-inline-${step.id}`,
      gateName: "Design assets manifest contains inline base64 payloads",
      kind: "step_contract",
      status: "fail",
      blocking: true,
      message: "assets-manifest.json must be metadata-only (file references). Inline data URIs are not allowed.",
      details: `path=${manifestSnapshot.foundPath}`
    });
    return gateResults;
  }

  if (!ASSET_FILE_REF_PATTERN.test(manifestRaw)) {
    gateResults.push({
      gateId: `contract-design-assets-manifest-filerefs-${step.id}`,
      gateName: "Design assets manifest has no reusable file references",
      kind: "step_contract",
      status: "fail",
      blocking: true,
      message: "assets-manifest.json must include reusable assets/* file references.",
      details: `path=${manifestSnapshot.foundPath}`
    });
    return gateResults;
  }

  return gateResults;
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
