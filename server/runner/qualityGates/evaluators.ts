import fs from "node:fs/promises";
import path from "node:path";
import type {
  PipelineLink,
  PipelineQualityGate,
  PipelineStep,
  StepQualityGateResult,
  WorkflowOutcome
} from "../../types.js";
import type { StepStoragePaths } from "../types.js";
import { checkArtifactExists } from "../artifacts.js";
import type { RunInputs } from "../../runInputs.js";
import { isGateResultContractStep, type StepContractEvaluationResult } from "./contracts.js";
import {
  buildStatusSignalOutput,
  normalizeStatusMarkers,
  parseGateResultContract,
  parseJsonOutput,
  resolvePathValue
} from "./normalizers.js";

const SITE_UPDATED_ARTIFACT_PATTERN = /(?:^|\/)site-updated\.json$/i;
const SITE_CURRENT_ARTIFACT_TEMPLATE = "{{shared_storage_path}}/site-current.json";
const LOCAL_IMPORT_SPEC_PATTERN = /^(?:@\/|\.{1,2}\/)/;
const CODE_FILE_PATTERN = /\.[cm]?[jt]sx?$/i;
const IMPORT_SPEC_PATTERN = /\b(?:import|export)\s+(?:type\s+)?(?:[^"'`]*?\sfrom\s*)?["'`]([^"'`]+)["'`]/g;
const DYNAMIC_IMPORT_SPEC_PATTERN = /\bimport\s*\(\s*["'`]([^"'`]+)["'`]\s*\)/g;
const IMPORT_RESOLUTION_EXTENSIONS = [".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".json", ".css", ".scss", ".sass"];

function extractFrameCount(value: unknown): number | null {
  if (Array.isArray(value) && value.length > 0) {
    return value.length;
  }
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
  const slideCount = record.slideCount;
  if (typeof slideCount === "number" && Number.isFinite(slideCount) && slideCount > 0) {
    return Math.floor(slideCount);
  }
  const frames = record.frames;
  if (Array.isArray(frames) && frames.length > 0) {
    return frames.length;
  }
  const slides = record.slides;
  if (Array.isArray(slides) && slides.length > 0) {
    return slides.length;
  }
  if (typeof slides === "object" && slides !== null) {
    const slideEntries = Object.values(slides).filter((entry) => typeof entry === "object" && entry !== null);
    if (slideEntries.length > 0) {
      return slideEntries.length;
    }
  }
  const slideMap = record.slideMap;
  if (Array.isArray(slideMap) && slideMap.length > 0) {
    return slideMap.length;
  }
  if (typeof slideMap === "object" && slideMap !== null) {
    const slideMapEntries = Object.values(slideMap).filter((entry) => typeof entry === "object" && entry !== null);
    if (slideMapEntries.length > 0) {
      return slideMapEntries.length;
    }
  }
  const frameMap = record.frameMap;
  if (Array.isArray(frameMap) && frameMap.length > 0) {
    return frameMap.length;
  }
  if (typeof frameMap === "object" && frameMap !== null) {
    const frameMapEntries = Object.values(frameMap).filter((entry) => typeof entry === "object" && entry !== null);
    if (frameMapEntries.length > 0) {
      return frameMapEntries.length;
    }
  }
  const framesObject = record.frames;
  if (typeof framesObject === "object" && framesObject !== null && !Array.isArray(framesObject)) {
    const frameEntries = Object.values(framesObject).filter((entry) => typeof entry === "object" && entry !== null);
    if (frameEntries.length > 0) {
      return frameEntries.length;
    }
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
  const numericRootEntries = Object.entries(record).filter(
    ([key, entry]) => /^\d+$/.test(key) && typeof entry === "object" && entry !== null
  );
  if (numericRootEntries.length > 0) {
    return numericRootEntries.length;
  }
  const figmaNodeEntries = Object.entries(record).filter(
    ([key, entry]) => /^\d+:\d+$/.test(key) && typeof entry === "object" && entry !== null
  );
  if (figmaNodeEntries.length > 0) {
    return figmaNodeEntries.length;
  }
  return null;
}

function normalizeAssetRef(value: string): string {
  return value
    .trim()
    .replace(/^['"]|['"]$/g, "")
    .replace(/\\/g, "/")
    .replace(/^\.?\//, "")
    .split(/[?#]/, 1)[0]
    .toLowerCase();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function looksLikeManifestAssetEntry(value: Record<string, unknown>): boolean {
  const signals = [
    "frameId",
    "frameName",
    "slideIndex",
    "background",
    "textOverlayRisk",
    "imageRefs",
    "backgroundImageBase64",
    "frameImage",
    "backgroundLayer"
  ];
  return signals.some((signal) => signal in value);
}

function collectManifestAssetEntries(root: unknown): Array<Record<string, unknown>> {
  if (!isRecord(root) && !Array.isArray(root)) {
    return [];
  }

  const entries: Array<Record<string, unknown>> = [];
  const stack: unknown[] = [root];
  let visited = 0;
  const maxVisited = 8_000;

  while (stack.length > 0 && visited < maxVisited) {
    const current = stack.pop();
    visited += 1;

    if (Array.isArray(current)) {
      for (const item of current) {
        if (isRecord(item) || Array.isArray(item)) {
          stack.push(item);
        }
      }
      continue;
    }

    if (!isRecord(current)) {
      continue;
    }

    if (looksLikeManifestAssetEntry(current)) {
      entries.push(current);
    }

    for (const value of Object.values(current)) {
      if (isRecord(value) || Array.isArray(value)) {
        stack.push(value);
      }
    }
  }

  return entries;
}

function extractBackgroundFileFromManifestEntry(entry: Record<string, unknown>): string | null {
  const directFieldCandidates = ["backgroundFile", "file", "frameImage", "backgroundLayer"];
  for (const key of directFieldCandidates) {
    const value = entry[key];
    if (typeof value === "string" && value.trim().length > 0) {
      return normalizeAssetRef(value);
    }
  }

  const background = entry.background;
  if (typeof background === "string" && background.trim().length > 0) {
    return normalizeAssetRef(background);
  }
  if (isRecord(background)) {
    const backgroundFile = background.file;
    if (typeof backgroundFile === "string" && backgroundFile.trim().length > 0) {
      return normalizeAssetRef(backgroundFile);
    }
  }

  return null;
}

function extractOverlayRiskBackgroundRefs(manifestParsed: unknown): string[] {
  const riskyBackgrounds = new Set<string>();
  const entries = collectManifestAssetEntries(manifestParsed);

  for (const entry of entries) {
    const background = entry.background;
    const entryRisk = entry.textOverlayRisk;
    const backgroundRisk = isRecord(background) ? background.textOverlayRisk : undefined;
    const isRisky = entryRisk === true || backgroundRisk === true;

    if (!isRisky) {
      continue;
    }

    const backgroundFile = extractBackgroundFileFromManifestEntry(entry);
    if (backgroundFile) {
      riskyBackgrounds.add(backgroundFile);
    }
  }

  return Array.from(riskyBackgrounds);
}

function extractHtmlBackgroundAssetRefs(html: string): string[] {
  const refs = new Set<string>();
  const backgroundImagePattern =
    /background-image\s*:\s*url\(\s*['"]?(?!data:)(?!https?:)(?!\/\/)(?!#)([^'")]+)['"]?\s*\)/gi;
  let match: RegExpExecArray | null = null;
  while ((match = backgroundImagePattern.exec(html)) !== null) {
    const rawRef = match[1]?.trim() ?? "";
    if (rawRef.length === 0) {
      continue;
    }
    refs.add(normalizeAssetRef(rawRef));
  }
  return Array.from(refs);
}

function hasMeaningfulVisibleText(html: string): boolean {
  const text = extractTextContent(html);
  return text.length >= 120;
}

function refsMatch(candidate: string, riskyRef: string): boolean {
  if (candidate === riskyRef) {
    return true;
  }
  return candidate.endsWith(`/${riskyRef}`) || riskyRef.endsWith(`/${candidate}`);
}

function countHtmlSlides(html: string): number {
  const slideIdMatches = html.match(/\bid\s*=\s*["']slide-\d+["']/gi)?.length ?? 0;
  if (slideIdMatches > 0) {
    return slideIdMatches;
  }

  const hasSlideClassToken = (classValue: string): boolean =>
    classValue
      .split(/\s+/)
      .map((token) => token.trim().toLowerCase())
      .includes("slide");

  let count = 0;
  const quotedClassPattern = /<([a-zA-Z][\w:-]*)\b[^>]*\bclass\s*=\s*(["'])(.*?)\2[^>]*>/gsi;
  let quotedMatch: RegExpExecArray | null = null;
  while ((quotedMatch = quotedClassPattern.exec(html)) !== null) {
    const classValue = quotedMatch[3] ?? "";
    if (hasSlideClassToken(classValue)) {
      count += 1;
    }
  }
  if (count > 0) {
    return count;
  }

  const unquotedClassPattern = /<([a-zA-Z][\w:-]*)\b[^>]*\bclass\s*=\s*([^\s"'`=<>]+)[^>]*>/gi;
  let unquotedMatch: RegExpExecArray | null = null;
  while ((unquotedMatch = unquotedClassPattern.exec(html)) !== null) {
    const classValue = unquotedMatch[2] ?? "";
    if (hasSlideClassToken(classValue)) {
      count += 1;
    }
  }
  if (count > 0) {
    return count;
  }

  return 0;
}

function extractTextContent(fragment: string): string {
  return fragment
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

interface HiddenContentViolation {
  reason: string;
  snippet: string;
}

function countHtmlDataUriBackgrounds(html: string): number {
  const inlineStyleMatches =
    html.match(/background-image\s*:\s*url\(\s*['"]data:image\/[a-zA-Z0-9.+-]+;base64,/gi)?.length ?? 0;
  if (inlineStyleMatches > 0) {
    return inlineStyleMatches;
  }

  return html.match(/url\(\s*['"]data:image\/[a-zA-Z0-9.+-]+;base64,/gi)?.length ?? 0;
}

function hasDuplicatedDataUriPrefix(html: string): boolean {
  return /data:image\/[a-zA-Z0-9.+-]+;base64,\s*data:image\/[a-zA-Z0-9.+-]+;base64,/i.test(html);
}

function countManifestBackgroundEntries(manifestRaw: string): number {
  return manifestRaw.match(/"[^"]*(?:background|image)[^"]*"\s*:\s*"data:image\//gi)?.length ?? 0;
}

function countManifestBackgroundFileEntries(manifestRaw: string): number {
  return manifestRaw.match(/"file"\s*:\s*"assets\/[^"]+\.(?:png|jpe?g|webp|gif|svg)"/gi)?.length ?? 0;
}

function countHtmlFileBackgroundReferences(html: string): number {
  const backgroundStyleMatches =
    html.match(
      /background-image\s*:\s*url\(\s*['"]?(?!data:)(?!https?:)(?!\/\/)(?!#)([^'")]+)['"]?\s*\)/gi
    )?.length ?? 0;
  if (backgroundStyleMatches > 0) {
    return backgroundStyleMatches;
  }

  return html.match(/<img\b[^>]*\bsrc\s*=\s*["'](?!data:)(?!https?:)(?!\/\/)(?!#)[^"']+["'][^>]*>/gi)?.length ?? 0;
}

function detectHiddenPrimaryContent(html: string): HiddenContentViolation[] {
  const violations: HiddenContentViolation[] = [];
  const seen = new Set<string>();

  const pushViolation = (reason: string, snippet: string): void => {
    const compact = snippet.replace(/\s+/g, " ").trim().slice(0, 220);
    if (compact.length === 0) {
      return;
    }
    const key = `${reason}:${compact}`;
    if (seen.has(key)) {
      return;
    }
    seen.add(key);
    violations.push({ reason, snippet: compact });
  };

  const sectionLevelChecks: Array<{ reason: string; pattern: RegExp }> = [
    {
      reason: "slide section marked as sr-only/visually-hidden",
      pattern:
        /<section\b[^>]*\bclass\s*=\s*["'][^"']*\b(?:sr-only|visually-hidden|screen-reader-only)\b[^"']*["'][^>]*>/gi
    },
    {
      reason: "slide section marked aria-hidden",
      pattern: /<section\b[^>]*\baria-hidden\s*=\s*["']true["'][^>]*>/gi
    },
    {
      reason: "slide section hidden via inline style",
      pattern:
        /<section\b[^>]*\bstyle\s*=\s*["'][^"']*(?:display\s*:\s*none|visibility\s*:\s*hidden)[^"']*["'][^>]*>/gi
    }
  ];

  for (const check of sectionLevelChecks) {
    const matches = html.match(check.pattern) ?? [];
    for (const match of matches) {
      pushViolation(check.reason, match);
    }
  }

  const hiddenTextChecks: Array<{ reason: string; pattern: RegExp }> = [
    {
      reason: "text inside sr-only/visually-hidden container",
      pattern:
        /<[^>]*\bclass\s*=\s*["'][^"']*\b(?:sr-only|visually-hidden|screen-reader-only)\b[^"']*["'][^>]*>([\s\S]*?)<\/[^>]+>/gi
    },
    {
      reason: "text inside aria-hidden container",
      pattern: /<[^>]*\baria-hidden\s*=\s*["']true["'][^>]*>([\s\S]*?)<\/[^>]+>/gi
    },
    {
      reason: "text inside display:none/visibility:hidden container",
      pattern:
        /<[^>]*\bstyle\s*=\s*["'][^"']*(?:display\s*:\s*none|visibility\s*:\s*hidden)[^"']*["'][^>]*>([\s\S]*?)<\/[^>]+>/gi
    }
  ];

  for (const check of hiddenTextChecks) {
    let match: RegExpExecArray | null = null;
    while ((match = check.pattern.exec(html)) !== null) {
      const hiddenText = extractTextContent(match[1] ?? "");
      if (hiddenText.length < 24 || !/[A-Za-zА-Яа-я0-9]/.test(hiddenText)) {
        continue;
      }
      pushViolation(check.reason, hiddenText);
    }
  }

  return violations;
}

async function evaluateSlideCountContract(
  step: PipelineStep,
  storagePaths: StepStoragePaths,
  runInputs: RunInputs
): Promise<StepQualityGateResult | null> {
  const htmlTemplates = step.requiredOutputFiles.filter((template) => /\.html?$/i.test(template.trim()));
  if (htmlTemplates.length === 0) {
    return null;
  }

  const frameMapArtifact = await checkArtifactExists("{{shared_storage_path}}/frame-map.json", storagePaths, runInputs);
  if (!frameMapArtifact.exists || !frameMapArtifact.foundPath) {
    return null;
  }

  const htmlArtifact = await checkArtifactExists(htmlTemplates[0], storagePaths, runInputs);
  if (!htmlArtifact.exists || !htmlArtifact.foundPath) {
    return null;
  }

  let frameMapRaw = "";
  let htmlRaw = "";
  try {
    [frameMapRaw, htmlRaw] = await Promise.all([
      fs.readFile(frameMapArtifact.foundPath, "utf8"),
      fs.readFile(htmlArtifact.foundPath, "utf8")
    ]);
  } catch (error) {
    return {
      gateId: `contract-slide-count-${step.id}`,
      gateName: "Slide count matches frame map",
      kind: "step_contract",
      status: "fail",
      blocking: true,
      message: "Failed to read HTML or frame-map artifacts for slide-count validation.",
      details: error instanceof Error ? error.message : "unknown read error"
    };
  }

  let frameMapParsed: unknown;
  try {
    frameMapParsed = JSON.parse(frameMapRaw);
  } catch (error) {
    return {
      gateId: `contract-slide-count-${step.id}`,
      gateName: "Slide count matches frame map",
      kind: "step_contract",
      status: "fail",
      blocking: true,
      message: "frame-map.json is invalid JSON.",
      details: error instanceof Error ? error.message : "unknown parse error"
    };
  }

  const expectedSlides = extractFrameCount(frameMapParsed);
  if (expectedSlides === null) {
    return {
      gateId: `contract-slide-count-${step.id}`,
      gateName: "Slide count matches frame map",
      kind: "step_contract",
      status: "fail",
      blocking: true,
      message: "frame-map.json does not include a valid frame count.",
      details:
        "Expected one of: totalFrames, frameCount, slideCount, frames[], slides[], slideMap[], frameMap[], frameOrder[]"
    };
  }

  const actualSlides = countHtmlSlides(htmlRaw);
  const passed = actualSlides === expectedSlides;
  return {
    gateId: `contract-slide-count-${step.id}`,
    gateName: "Slide count matches frame map",
    kind: "step_contract",
    status: passed ? "pass" : "fail",
    blocking: true,
    message: passed
      ? `HTML slide count matches frame-map (${expectedSlides}).`
      : `HTML slide count (${actualSlides}) does not match frame-map (${expectedSlides}).`,
    details: `html=${htmlArtifact.foundPath}, frameMap=${frameMapArtifact.foundPath}`
  };
}

async function evaluateOverlayRiskContract(
  step: PipelineStep,
  storagePaths: StepStoragePaths,
  runInputs: RunInputs
): Promise<StepQualityGateResult | null> {
  const htmlTemplates = step.requiredOutputFiles.filter((template) => /\.html?$/i.test(template.trim()));
  if (htmlTemplates.length === 0) {
    return null;
  }

  const assetsManifestArtifact = await checkArtifactExists(
    "{{shared_storage_path}}/assets-manifest.json",
    storagePaths,
    runInputs
  );
  if (!assetsManifestArtifact.exists || !assetsManifestArtifact.foundPath) {
    return null;
  }

  const htmlArtifact = await checkArtifactExists(htmlTemplates[0], storagePaths, runInputs);
  if (!htmlArtifact.exists || !htmlArtifact.foundPath) {
    return null;
  }

  let htmlRaw = "";
  let manifestRaw = "";
  try {
    [htmlRaw, manifestRaw] = await Promise.all([
      fs.readFile(htmlArtifact.foundPath, "utf8"),
      fs.readFile(assetsManifestArtifact.foundPath, "utf8")
    ]);
  } catch (error) {
    return {
      gateId: `contract-overlay-risk-${step.id}`,
      gateName: "Overlay-risk backgrounds are not reused for visible text",
      kind: "step_contract",
      status: "fail",
      blocking: true,
      message: "Failed to read HTML or assets-manifest for overlay-risk validation.",
      details: error instanceof Error ? error.message : "unknown read error"
    };
  }

  let manifestParsed: unknown;
  try {
    manifestParsed = JSON.parse(manifestRaw);
  } catch (error) {
    return {
      gateId: `contract-overlay-risk-${step.id}`,
      gateName: "Overlay-risk backgrounds are not reused for visible text",
      kind: "step_contract",
      status: "fail",
      blocking: true,
      message: "assets-manifest.json is invalid JSON for overlay-risk validation.",
      details: error instanceof Error ? error.message : "unknown parse error"
    };
  }

  const riskyBackgroundRefs = extractOverlayRiskBackgroundRefs(manifestParsed);
  if (riskyBackgroundRefs.length === 0) {
    return {
      gateId: `contract-overlay-risk-${step.id}`,
      gateName: "Overlay-risk backgrounds are not reused for visible text",
      kind: "step_contract",
      status: "pass",
      blocking: true,
      message: "assets-manifest declares no text-overlay-risk backgrounds.",
      details: `html=${htmlArtifact.foundPath}, manifest=${assetsManifestArtifact.foundPath}`
    };
  }

  if (!hasMeaningfulVisibleText(htmlRaw)) {
    return {
      gateId: `contract-overlay-risk-${step.id}`,
      gateName: "Overlay-risk backgrounds are not reused for visible text",
      kind: "step_contract",
      status: "pass",
      blocking: true,
      message: "HTML contains no meaningful visible text; overlay-risk check is not applicable.",
      details: `riskyBackgrounds=${riskyBackgroundRefs.length}`
    };
  }

  const htmlBackgroundRefs = extractHtmlBackgroundAssetRefs(htmlRaw);
  const usedRiskyBackgrounds = riskyBackgroundRefs.filter((riskyRef) =>
    htmlBackgroundRefs.some((candidateRef) => refsMatch(candidateRef, riskyRef))
  );

  if (usedRiskyBackgrounds.length > 0) {
    return {
      gateId: `contract-overlay-risk-${step.id}`,
      gateName: "Overlay-risk backgrounds are not reused for visible text",
      kind: "step_contract",
      status: "fail",
      blocking: true,
      message:
        "HTML uses backgrounds flagged as textOverlayRisk=true while rendering visible text. This causes text-on-text overlap.",
      details: `riskyBackgroundsUsed=${usedRiskyBackgrounds.slice(0, 8).join(", ")}`
    };
  }

  return {
    gateId: `contract-overlay-risk-${step.id}`,
    gateName: "Overlay-risk backgrounds are not reused for visible text",
    kind: "step_contract",
    status: "pass",
    blocking: true,
    message: "HTML avoids backgrounds flagged as textOverlayRisk=true when rendering visible text.",
    details: `riskyBackgrounds=${riskyBackgroundRefs.length}, htmlBackgroundRefs=${htmlBackgroundRefs.length}`
  };
}

async function evaluateHiddenContentContract(
  step: PipelineStep,
  storagePaths: StepStoragePaths,
  runInputs: RunInputs
): Promise<StepQualityGateResult | null> {
  const htmlTemplates = step.requiredOutputFiles.filter((template) => /\.html?$/i.test(template.trim()));
  if (htmlTemplates.length === 0) {
    return null;
  }

  const htmlArtifact = await checkArtifactExists(htmlTemplates[0], storagePaths, runInputs);
  if (!htmlArtifact.exists || !htmlArtifact.foundPath) {
    return null;
  }

  let htmlRaw = "";
  try {
    htmlRaw = await fs.readFile(htmlArtifact.foundPath, "utf8");
  } catch (error) {
    return {
      gateId: `contract-hidden-content-${step.id}`,
      gateName: "Primary content must stay visible",
      kind: "step_contract",
      status: "fail",
      blocking: true,
      message: "Failed to read HTML artifact for hidden-content validation.",
      details: error instanceof Error ? error.message : "unknown read error"
    };
  }

  const violations = detectHiddenPrimaryContent(htmlRaw);
  const passed = violations.length === 0;
  return {
    gateId: `contract-hidden-content-${step.id}`,
    gateName: "Primary content must stay visible",
    kind: "step_contract",
    status: passed ? "pass" : "fail",
    blocking: true,
    message: passed
      ? "No hidden primary content markers were detected in HTML."
      : "HTML includes hidden primary content markers (sr-only/aria-hidden/display:none).",
    details: passed
      ? `html=${htmlArtifact.foundPath}`
      : violations
          .slice(0, 4)
          .map((entry) => `${entry.reason}: ${entry.snippet}`)
          .join(" | ")
  };
}

async function evaluateBackgroundAssetContract(
  step: PipelineStep,
  storagePaths: StepStoragePaths,
  runInputs: RunInputs
): Promise<StepQualityGateResult | null> {
  const htmlTemplates = step.requiredOutputFiles.filter((template) => /\.html?$/i.test(template.trim()));
  if (htmlTemplates.length === 0) {
    return null;
  }

  const assetsManifestArtifact = await checkArtifactExists(
    "{{shared_storage_path}}/assets-manifest.json",
    storagePaths,
    runInputs
  );
  if (!assetsManifestArtifact.exists || !assetsManifestArtifact.foundPath) {
    return null;
  }

  const htmlArtifact = await checkArtifactExists(htmlTemplates[0], storagePaths, runInputs);
  if (!htmlArtifact.exists || !htmlArtifact.foundPath) {
    return null;
  }

  let htmlRaw = "";
  let manifestRaw = "";
  try {
    [htmlRaw, manifestRaw] = await Promise.all([
      fs.readFile(htmlArtifact.foundPath, "utf8"),
      fs.readFile(assetsManifestArtifact.foundPath, "utf8")
    ]);
  } catch (error) {
    return {
      gateId: `contract-background-assets-${step.id}`,
      gateName: "Background assets are embedded correctly",
      kind: "step_contract",
      status: "fail",
      blocking: true,
      message: "Failed to read HTML or assets-manifest for background asset validation.",
      details: error instanceof Error ? error.message : "unknown read error"
    };
  }

  if (hasDuplicatedDataUriPrefix(htmlRaw)) {
    return {
      gateId: `contract-background-assets-${step.id}`,
      gateName: "Background assets are embedded correctly",
      kind: "step_contract",
      status: "fail",
      blocking: true,
      message: "HTML contains malformed duplicated data URI prefixes for background images.",
      details: `html=${htmlArtifact.foundPath}`
    };
  }

  const manifestBackgroundCount = countManifestBackgroundEntries(manifestRaw);
  const manifestBackgroundFileCount = countManifestBackgroundFileEntries(manifestRaw);
  const htmlDataUriBackgroundCount = countHtmlDataUriBackgrounds(htmlRaw);
  const htmlFileBackgroundCount = countHtmlFileBackgroundReferences(htmlRaw);
  const manifestHasBackgrounds = manifestBackgroundCount > 0 || manifestBackgroundFileCount > 0;

  if (manifestHasBackgrounds && htmlDataUriBackgroundCount === 0 && htmlFileBackgroundCount === 0) {
    return {
      gateId: `contract-background-assets-${step.id}`,
      gateName: "Background assets are embedded correctly",
      kind: "step_contract",
      status: "fail",
      blocking: true,
      message: "assets-manifest contains background images, but HTML does not reference them (neither data-URI nor file-backed backgrounds found).",
      details: `manifestBackgrounds=${manifestBackgroundCount}, manifestBackgroundFiles=${manifestBackgroundFileCount}, htmlDataUriBackgrounds=${htmlDataUriBackgroundCount}, htmlFileBackgrounds=${htmlFileBackgroundCount}`
    };
  }

  return {
    gateId: `contract-background-assets-${step.id}`,
    gateName: "Background assets are embedded correctly",
    kind: "step_contract",
    status: "pass",
    blocking: true,
    message:
      manifestHasBackgrounds
        ? htmlDataUriBackgroundCount > 0
          ? "Background assets from assets-manifest are embedded in HTML via data URIs."
          : "Background assets from assets-manifest are referenced in HTML via local file-backed backgrounds."
        : "No background assets declared in assets-manifest; skipping embed strictness.",
    details: `manifestBackgrounds=${manifestBackgroundCount}, manifestBackgroundFiles=${manifestBackgroundFileCount}, htmlDataUriBackgrounds=${htmlDataUriBackgroundCount}, htmlFileBackgrounds=${htmlFileBackgroundCount}`
  };
}

function normalizeArtifactPath(value: string): string {
  const normalized = value.trim().replace(/\\/g, "/").replace(/^\/+/, "");
  if (normalized.length === 0) {
    return "";
  }
  return path.posix.normalize(normalized).replace(/^\.\/+/, "");
}

function collectImportSpecifiers(content: string): string[] {
  const specs = new Set<string>();
  for (const matcher of [IMPORT_SPEC_PATTERN, DYNAMIC_IMPORT_SPEC_PATTERN]) {
    matcher.lastIndex = 0;
    let match: RegExpExecArray | null = null;
    while ((match = matcher.exec(content)) !== null) {
      const spec = match[1]?.trim() ?? "";
      if (spec.length > 0) {
        specs.add(spec);
      }
    }
  }
  return [...specs];
}

function resolveLocalImportBasePath(filePath: string, specifier: string): string | null {
  if (!LOCAL_IMPORT_SPEC_PATTERN.test(specifier)) {
    return null;
  }

  if (specifier.startsWith("@/")) {
    return normalizeArtifactPath(`src/${specifier.slice(2)}`);
  }

  const sourceDir = path.posix.dirname(filePath);
  return normalizeArtifactPath(path.posix.join(sourceDir, specifier));
}

function buildImportCandidates(basePath: string): string[] {
  const normalizedBase = normalizeArtifactPath(basePath).replace(/\/+$/, "");
  if (normalizedBase.length === 0) {
    return [];
  }

  const candidates = new Set<string>([normalizedBase]);
  const ext = path.posix.extname(normalizedBase);

  if (ext.length === 0) {
    for (const extension of IMPORT_RESOLUTION_EXTENSIONS) {
      candidates.add(`${normalizedBase}${extension}`);
      candidates.add(`${normalizedBase}/index${extension}`);
    }
  }

  return [...candidates];
}

interface ParsedSiteArtifact {
  allPaths: Set<string>;
  contentByPath: Map<string, string>;
  error?: string;
}

function parseSiteArtifact(raw: string): ParsedSiteArtifact {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    return {
      allPaths: new Set<string>(),
      contentByPath: new Map<string, string>(),
      error: error instanceof Error ? error.message : "invalid JSON"
    };
  }

  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return {
      allPaths: new Set<string>(),
      contentByPath: new Map<string, string>(),
      error: "artifact root must be an object"
    };
  }

  const root = parsed as Record<string, unknown>;
  const allPaths = new Set<string>();
  const contentByPath = new Map<string, string>();

  const repositoryTree = root.repositoryTree;
  if (Array.isArray(repositoryTree)) {
    for (const entry of repositoryTree) {
      if (typeof entry !== "string") {
        continue;
      }
      const normalizedPath = normalizeArtifactPath(entry);
      if (normalizedPath.length > 0) {
        allPaths.add(normalizedPath);
      }
    }
  }

  const files = root.files;
  if (Array.isArray(files)) {
    for (const entry of files) {
      if (typeof entry !== "object" || entry === null || Array.isArray(entry)) {
        continue;
      }
      const record = entry as Record<string, unknown>;
      const rawPath = typeof record.path === "string" ? record.path : "";
      const normalizedPath = normalizeArtifactPath(rawPath);
      if (normalizedPath.length === 0) {
        continue;
      }
      allPaths.add(normalizedPath);
      if (typeof record.content === "string") {
        contentByPath.set(normalizedPath, record.content);
      }
    }
  } else if (typeof files === "object" && files !== null) {
    for (const [filePath, value] of Object.entries(files as Record<string, unknown>)) {
      const normalizedPath = normalizeArtifactPath(filePath);
      if (normalizedPath.length === 0) {
        continue;
      }
      allPaths.add(normalizedPath);
      if (typeof value === "string") {
        contentByPath.set(normalizedPath, value);
        continue;
      }
      if (typeof value === "object" && value !== null && !Array.isArray(value)) {
        const content = (value as Record<string, unknown>).content;
        if (typeof content === "string") {
          contentByPath.set(normalizedPath, content);
        }
      }
    }
  }

  return { allPaths, contentByPath };
}

function shouldEvaluateSiteImportIntegrity(step: PipelineStep): boolean {
  return step.requiredOutputFiles.some((template) => SITE_UPDATED_ARTIFACT_PATTERN.test(template.trim()));
}

async function evaluateSiteImportIntegrityContract(
  step: PipelineStep,
  storagePaths: StepStoragePaths,
  runInputs: RunInputs
): Promise<StepQualityGateResult | null> {
  if (!shouldEvaluateSiteImportIntegrity(step)) {
    return null;
  }

  const siteUpdatedTemplate = step.requiredOutputFiles.find((template) => SITE_UPDATED_ARTIFACT_PATTERN.test(template.trim()));
  if (!siteUpdatedTemplate) {
    return null;
  }

  const siteUpdatedArtifact = await checkArtifactExists(siteUpdatedTemplate, storagePaths, runInputs);
  if (!siteUpdatedArtifact.exists || !siteUpdatedArtifact.foundPath) {
    return null;
  }

  let updatedRaw = "";
  try {
    updatedRaw = await fs.readFile(siteUpdatedArtifact.foundPath, "utf8");
  } catch (error) {
    return {
      gateId: `contract-site-import-integrity-${step.id}`,
      gateName: "Site bundle import integrity",
      kind: "step_contract",
      status: "fail",
      blocking: true,
      message: "Failed to read site-updated artifact for import integrity validation.",
      details: error instanceof Error ? error.message : "unknown read error"
    };
  }

  const updatedArtifact = parseSiteArtifact(updatedRaw);
  if (updatedArtifact.error) {
    return {
      gateId: `contract-site-import-integrity-${step.id}`,
      gateName: "Site bundle import integrity",
      kind: "step_contract",
      status: "fail",
      blocking: true,
      message: "site-updated.json is invalid and cannot be validated for import integrity.",
      details: updatedArtifact.error
    };
  }

  const availablePaths = new Set<string>(updatedArtifact.allPaths);
  const siteCurrentArtifact = await checkArtifactExists(SITE_CURRENT_ARTIFACT_TEMPLATE, storagePaths, runInputs);
  if (siteCurrentArtifact.exists && siteCurrentArtifact.foundPath) {
    try {
      const currentRaw = await fs.readFile(siteCurrentArtifact.foundPath, "utf8");
      const currentArtifact = parseSiteArtifact(currentRaw);
      for (const entry of currentArtifact.allPaths) {
        availablePaths.add(entry);
      }
    } catch {
      // Optional baseline artifact; keep validation based on site-updated paths if unreadable.
    }
  }

  const unresolvedImports: string[] = [];
  let scannedFiles = 0;
  let scannedImports = 0;

  for (const [filePath, content] of updatedArtifact.contentByPath.entries()) {
    if (!CODE_FILE_PATTERN.test(filePath)) {
      continue;
    }
    scannedFiles += 1;
    const imports = collectImportSpecifiers(content);
    for (const specifier of imports) {
      const basePath = resolveLocalImportBasePath(filePath, specifier);
      if (!basePath) {
        continue;
      }
      scannedImports += 1;
      const candidates = buildImportCandidates(basePath);
      const resolved = candidates.some((candidate) => availablePaths.has(candidate));
      if (!resolved) {
        unresolvedImports.push(`${filePath} -> ${specifier} (expected: ${basePath})`);
      }
    }
  }

  if (scannedFiles === 0 || scannedImports === 0) {
    return null;
  }

  if (unresolvedImports.length > 0) {
    return {
      gateId: `contract-site-import-integrity-${step.id}`,
      gateName: "Site bundle import integrity",
      kind: "step_contract",
      status: "fail",
      blocking: true,
      message: "site-updated bundle contains unresolved local imports.",
      details: unresolvedImports.slice(0, 8).join(" | ")
    };
  }

  return {
    gateId: `contract-site-import-integrity-${step.id}`,
    gateName: "Site bundle import integrity",
    kind: "step_contract",
    status: "pass",
    blocking: true,
    message: "Local imports in generated site files resolve against site-updated/site-current inventories.",
    details: `checked_files=${scannedFiles}, checked_imports=${scannedImports}`
  };
}

function normalizeRegexFlags(rawFlags: string): string {
  const allowed = new Set(["g", "i", "m", "s", "u", "y"]);
  const deduped: string[] = [];
  for (const flag of rawFlags) {
    if (!allowed.has(flag) || deduped.includes(flag)) {
      continue;
    }
    deduped.push(flag);
  }
  return deduped.join("");
}

function isWorkflowStatusRegexPattern(pattern: string): boolean {
  return /\bWORKFLOW_STATUS\b/i.test(pattern);
}

function allowsCompleteWorkflowStatus(pattern: string): boolean {
  return /\bCOMPLETE\b/i.test(pattern);
}

function isLegacyRegexGateEvaluationEnabled(): boolean {
  return process.env.FYREFLOW_ENABLE_LEGACY_REGEX_GATES !== "0";
}

export async function evaluateStepContracts(
  step: PipelineStep,
  output: string,
  storagePaths: StepStoragePaths,
  runInputs: RunInputs
): Promise<StepContractEvaluationResult> {
  const gateResults: StepQualityGateResult[] = [];
  let parsedJson: Record<string, unknown> | null = null;

  if (step.outputFormat === "json") {
    parsedJson = parseJsonOutput(output);
    const jsonValid = parsedJson !== null;

    gateResults.push({
      gateId: `contract-json-format-${step.id}`,
      gateName: "Step output must be valid JSON",
      kind: "step_contract",
      status: jsonValid ? "pass" : "fail",
      blocking: true,
      message: jsonValid
        ? "Step produced valid JSON output."
        : "Step is configured for JSON output but the output is not valid JSON.",
      details: jsonValid ? "JSON parser check passed." : output.slice(0, 400)
    });
  }

  if (step.requiredOutputFields.length > 0) {
    const payload = parsedJson ?? parseJsonOutput(output);
    parsedJson = payload;

    if (!payload) {
      for (const fieldPath of step.requiredOutputFields) {
        gateResults.push({
          gateId: `contract-json-field-${step.id}-${fieldPath}`,
          gateName: `Required field: ${fieldPath}`,
          kind: "step_contract",
          status: "fail",
          blocking: true,
          message: `Cannot verify required field "${fieldPath}" because output is not valid JSON.`,
          details: "Step output JSON parse failed."
        });
      }
    } else {
      for (const fieldPath of step.requiredOutputFields) {
        const value = resolvePathValue(payload, fieldPath);
        gateResults.push({
          gateId: `contract-json-field-${step.id}-${fieldPath}`,
          gateName: `Required field: ${fieldPath}`,
          kind: "step_contract",
          status: value.found ? "pass" : "fail",
          blocking: true,
          message: value.found
            ? `Required field "${fieldPath}" is present.`
            : `Required field "${fieldPath}" is missing from output JSON.`,
          details: value.found ? `Value: ${JSON.stringify(value.value).slice(0, 260)}` : "Path lookup failed."
        });
      }
    }
  }

  if (isGateResultContractStep(step)) {
    const contractCheck = parseGateResultContract(output, parsedJson);
    const strictJsonContract = contractCheck.contract !== null && contractCheck.source === "json";
    gateResults.push({
      gateId: `contract-gate-result-${step.id}`,
      gateName: "Step emits GateResult contract",
      kind: "step_contract",
      status: strictJsonContract ? "pass" : "fail",
      blocking: true,
      message: strictJsonContract
        ? "Step emitted strict GateResult JSON contract."
        : contractCheck.contract
          ? "Legacy text status markers are not accepted for this step; emit strict GateResult JSON."
          : "Step did not emit strict GateResult JSON contract.",
      details: contractCheck.contract
        ? `source=${contractCheck.source}, workflow_status=${contractCheck.contract.workflowStatus}, next_action=${contractCheck.contract.nextAction}`
        : "Expected fields: workflow_status, next_action, reasons[]"
    });
  }

  for (const fileTemplate of step.requiredOutputFiles) {
    const artifactCheck = await checkArtifactExists(fileTemplate, storagePaths, runInputs);
    gateResults.push({
      gateId: `contract-artifact-${step.id}-${fileTemplate}`,
      gateName: `Required artifact: ${fileTemplate}`,
      kind: "step_contract",
      status: artifactCheck.exists ? "pass" : "fail",
      blocking: true,
      message: artifactCheck.exists
        ? `Required artifact exists: ${artifactCheck.foundPath}`
        : `Required artifact is missing: ${fileTemplate}`,
      details: artifactCheck.disabledStorage
        ? "Storage mode required by this artifact path is disabled for this step."
        : artifactCheck.paths.length > 0
          ? `Checked paths: ${artifactCheck.paths.join(" | ")}`
          : "No candidate artifact paths were resolved."
    });
  }

  const slideCountContract = await evaluateSlideCountContract(step, storagePaths, runInputs);
  if (slideCountContract) {
    gateResults.push(slideCountContract);
  }
  const hiddenContentContract = await evaluateHiddenContentContract(step, storagePaths, runInputs);
  if (hiddenContentContract) {
    gateResults.push(hiddenContentContract);
  }
  const backgroundAssetContract = await evaluateBackgroundAssetContract(step, storagePaths, runInputs);
  if (backgroundAssetContract) {
    gateResults.push(backgroundAssetContract);
  }
  const overlayRiskContract = await evaluateOverlayRiskContract(step, storagePaths, runInputs);
  if (overlayRiskContract) {
    gateResults.push(overlayRiskContract);
  }
  const siteImportIntegrityContract = await evaluateSiteImportIntegrityContract(step, storagePaths, runInputs);
  if (siteImportIntegrityContract) {
    gateResults.push(siteImportIntegrityContract);
  }

  return { parsedJson, gateResults };
}

export async function evaluatePipelineQualityGates(
  step: PipelineStep,
  output: string,
  parsedJson: Record<string, unknown> | null,
  qualityGates: PipelineQualityGate[],
  storagePaths: StepStoragePaths,
  runInputs: RunInputs
): Promise<StepQualityGateResult[]> {
  const relevant = qualityGates.filter(
    (gate) => gate.targetStepId === "any_step" || gate.targetStepId === step.id
  );

  if (relevant.length === 0) {
    return [];
  }

  let cachedJson = parsedJson;
  const normalizedStatusOutput = normalizeStatusMarkers(output);
  const derivedStatusOutput = buildStatusSignalOutput(output, cachedJson);
  const results: StepQualityGateResult[] = [];

  for (const gate of relevant) {
    if (gate.kind === "manual_approval") {
      continue;
    }

    if (gate.kind === "regex_must_match" || gate.kind === "regex_must_not_match") {
      if (!isLegacyRegexGateEvaluationEnabled()) {
        results.push({
          gateId: gate.id,
          gateName: gate.name,
          kind: gate.kind,
          status: "pass",
          blocking: gate.blocking,
          message:
            gate.message ||
            `Legacy regex gate "${gate.name}" skipped because legacy regex evaluation is disabled for this runtime.`,
          details: "Set FYREFLOW_ENABLE_LEGACY_REGEX_GATES=1 (or unset) to evaluate regex gates."
        });
        continue;
      }

      if (!gate.pattern || gate.pattern.trim().length === 0) {
        results.push({
          gateId: gate.id,
          gateName: gate.name,
          kind: gate.kind,
          status: "fail",
          blocking: gate.blocking,
          message: gate.message || `Regex gate "${gate.name}" has empty pattern.`,
          details: "Define a regex pattern for this gate."
        });
        continue;
      }

      try {
        const flags = normalizeRegexFlags(gate.flags);
        const matches = (value: string): boolean => {
          const regex = new RegExp(gate.pattern, flags);
          return regex.test(value);
        };
        let matched =
          matches(output) ||
          (normalizedStatusOutput !== output && matches(normalizedStatusOutput)) ||
          (derivedStatusOutput.length > 0 && matches(derivedStatusOutput));
        if (
          !matched &&
          gate.kind === "regex_must_match" &&
          isWorkflowStatusRegexPattern(gate.pattern) &&
          !allowsCompleteWorkflowStatus(gate.pattern) &&
          /WORKFLOW_STATUS\s*:\s*COMPLETE/i.test(normalizedStatusOutput)
        ) {
          matched = true;
        }
        const passed = gate.kind === "regex_must_match" ? matched : !matched;

        results.push({
          gateId: gate.id,
          gateName: gate.name,
          kind: gate.kind,
          status: passed ? "pass" : "fail",
          blocking: gate.blocking,
          message:
            gate.message ||
            (passed
              ? `Gate "${gate.name}" passed.`
              : gate.kind === "regex_must_match"
                ? `Output did not match required regex for gate "${gate.name}".`
                : `Output matched blocked regex for gate "${gate.name}".`),
          details: `pattern=${gate.pattern} flags=${gate.flags || "(none)"}`
        });
      } catch (error) {
        const reason = error instanceof Error ? error.message : "Invalid regex";
        results.push({
          gateId: gate.id,
          gateName: gate.name,
          kind: gate.kind,
          status: "fail",
          blocking: gate.blocking,
          message: gate.message || `Invalid regex in gate "${gate.name}".`,
          details: reason
        });
      }

      continue;
    }

    if (gate.kind === "json_field_exists") {
      if (!gate.jsonPath || gate.jsonPath.trim().length === 0) {
        results.push({
          gateId: gate.id,
          gateName: gate.name,
          kind: gate.kind,
          status: "fail",
          blocking: gate.blocking,
          message: gate.message || `JSON path is empty for gate "${gate.name}".`,
          details: "Set jsonPath in gate configuration."
        });
        continue;
      }

      const artifactPathTemplate = gate.artifactPath?.trim() ?? "";
      if (artifactPathTemplate.length > 0) {
        const artifactCheck = await checkArtifactExists(artifactPathTemplate, storagePaths, runInputs);
        if (!artifactCheck.exists || !artifactCheck.foundPath) {
          results.push({
            gateId: gate.id,
            gateName: gate.name,
            kind: gate.kind,
            status: "fail",
            blocking: gate.blocking,
            message: gate.message || `JSON path "${gate.jsonPath}" is missing.`,
            details: artifactCheck.disabledStorage
              ? "Storage policy disabled the required artifact path."
              : artifactCheck.paths.length > 0
                ? `Artifact missing for json_field_exists. Checked paths: ${artifactCheck.paths.join(" | ")}`
                : "Artifact path could not be resolved."
          });
          continue;
        }

        let artifactPayload: unknown;
        try {
          const artifactRaw = await fs.readFile(artifactCheck.foundPath, "utf8");
          artifactPayload = JSON.parse(artifactRaw) as unknown;
        } catch (error) {
          const reason = error instanceof Error ? error.message : "unknown parse error";
          results.push({
            gateId: gate.id,
            gateName: gate.name,
            kind: gate.kind,
            status: "fail",
            blocking: gate.blocking,
            message: gate.message || `JSON path "${gate.jsonPath}" is missing.`,
            details: `Artifact JSON parse failed (${artifactCheck.foundPath}): ${reason}`
          });
          continue;
        }

        const found = resolvePathValue(artifactPayload, gate.jsonPath).found;
        results.push({
          gateId: gate.id,
          gateName: gate.name,
          kind: gate.kind,
          status: found ? "pass" : "fail",
          blocking: gate.blocking,
          message:
            gate.message ||
            (found
              ? `JSON path "${gate.jsonPath}" exists.`
              : `JSON path "${gate.jsonPath}" is missing.`),
          details: `path=${gate.jsonPath} source=artifact file=${artifactCheck.foundPath}`
        });
        continue;
      }

      if (!cachedJson) {
        cachedJson = parseJsonOutput(output);
      }

      const found = cachedJson ? resolvePathValue(cachedJson, gate.jsonPath).found : false;
      results.push({
        gateId: gate.id,
        gateName: gate.name,
        kind: gate.kind,
        status: found ? "pass" : "fail",
        blocking: gate.blocking,
        message:
          gate.message ||
          (found
            ? `JSON path "${gate.jsonPath}" exists.`
            : `JSON path "${gate.jsonPath}" is missing.`),
        details: cachedJson ? `path=${gate.jsonPath} source=output` : "Output is not valid JSON."
      });
      continue;
    }

    if (gate.kind !== "artifact_exists") {
      results.push({
        gateId: gate.id,
        gateName: gate.name,
        kind: gate.kind,
        status: "fail",
        blocking: gate.blocking,
        message: gate.message || `Unsupported quality gate kind "${gate.kind}".`,
        details: "Gate kind is not supported by the evaluator."
      });
      continue;
    }

    if (!gate.artifactPath || gate.artifactPath.trim().length === 0) {
      results.push({
        gateId: gate.id,
        gateName: gate.name,
        kind: gate.kind,
        status: "fail",
        blocking: gate.blocking,
        message: gate.message || `Artifact path is empty for gate "${gate.name}".`,
        details: "Set artifactPath in gate configuration."
      });
      continue;
    }

    const artifactCheck = await checkArtifactExists(gate.artifactPath, storagePaths, runInputs);

    results.push({
      gateId: gate.id,
      gateName: gate.name,
      kind: gate.kind,
      status: artifactCheck.exists ? "pass" : "fail",
      blocking: gate.blocking,
      message:
        gate.message ||
        (artifactCheck.exists ? `Artifact found: ${artifactCheck.foundPath}` : `Artifact missing: ${gate.artifactPath}`),
      details: artifactCheck.disabledStorage
        ? "Storage policy disabled the required artifact path."
        : artifactCheck.paths.length > 0
          ? `Checked paths: ${artifactCheck.paths.join(" | ")}`
          : "No candidate artifact paths were resolved."
    });
  }

  return results;
}

function parseRouteConditionLiteral(rawValue: string): unknown {
  const trimmed = rawValue.trim();
  if (trimmed.length === 0) {
    return "";
  }

  if (trimmed === "true") return true;
  if (trimmed === "false") return false;
  if (trimmed === "null") return null;
  if ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
    return trimmed.slice(1, -1);
  }

  const numeric = Number(trimmed);
  if (Number.isFinite(numeric) && /^-?\d+(?:\.\d+)?$/.test(trimmed)) {
    return numeric;
  }

  return trimmed;
}

function evaluateRouteConditionExpression(expression: string, payload?: Record<string, unknown> | null): boolean {
  const trimmed = expression.trim();
  if (trimmed.length === 0) {
    return true;
  }

  if (!payload) {
    return false;
  }

  const match = trimmed.match(/^(.+?)\s*(==|!=|>=|<=|>|<)\s*(.+)$/);
  if (!match) {
    const resolved = resolvePathValue(payload, trimmed);
    return resolved.found && Boolean(resolved.value);
  }

  const [, rawPath, operator, rawExpected] = match;
  const resolved = resolvePathValue(payload, rawPath);
  if (!resolved.found) {
    return false;
  }

  const expected = parseRouteConditionLiteral(rawExpected);
  const actual = resolved.value;

  switch (operator) {
    case "==":
      return actual === expected;
    case "!=":
      return actual !== expected;
    case ">":
      return typeof actual === "number" && typeof expected === "number" && actual > expected;
    case ">=":
      return typeof actual === "number" && typeof expected === "number" && actual >= expected;
    case "<":
      return typeof actual === "number" && typeof expected === "number" && actual < expected;
    case "<=":
      return typeof actual === "number" && typeof expected === "number" && actual <= expected;
    default:
      return false;
  }
}

export function routeMatchesCondition(
  link: PipelineLink,
  outcome: WorkflowOutcome,
  payload?: Record<string, unknown> | null
): boolean {
  const baseMatch =
    link.condition === "on_pass" ? outcome === "pass" : link.condition === "on_fail" ? outcome === "fail" : true;
  if (!baseMatch) {
    return false;
  }

  if (typeof link.conditionExpression === "string" && link.conditionExpression.trim().length > 0) {
    return evaluateRouteConditionExpression(link.conditionExpression, payload);
  }

  return true;
}
