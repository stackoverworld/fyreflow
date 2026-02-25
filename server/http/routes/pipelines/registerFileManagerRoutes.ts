import fs from "node:fs/promises";
import { lookup as dnsLookup } from "node:dns/promises";
import { randomUUID } from "node:crypto";
import { isIP } from "node:net";
import path from "node:path";
import type { Express, Request, Response } from "express";
import type { PipelineRouteContext } from "./contracts.js";
import { firstParam, sendZodError } from "./helpers.js";
import {
  filesContentQuerySchema,
  filesDeleteSchema,
  filesImportUrlSchema,
  filesListQuerySchema,
  filesUploadChunkSchema
} from "./schemas.js";
import type { DashboardState, StorageConfig } from "../../../types.js";

const MAX_DIRECTORY_ENTRIES = 500;
const MAX_FILE_PREVIEW_BYTES_DEFAULT = 256 * 1024;
const MAX_FILE_PREVIEW_BYTES_LIMIT = 1024 * 1024;
const TEXT_PREVIEW_SAMPLE_BYTES = 4096;
const MAX_FILE_UPLOAD_BYTES = 25 * 1024 * 1024;
const MAX_UPLOAD_CHUNK_BYTES = 512 * 1024;
const MAX_URL_IMPORT_BYTES = 25 * 1024 * 1024;
const URL_IMPORT_TIMEOUT_MS = 30_000;
const URL_IMPORT_MAX_REDIRECTS = 5;
const UPLOAD_SESSION_TTL_MS = 15 * 60 * 1000;

type FilesScope = "shared" | "isolated" | "runs";
type FilePreviewKind = "text" | "html";

interface ResolvedScope {
  rootPath: string;
  rootLabel: string;
}

class FileManagerRouteError extends Error {
  constructor(
    readonly statusCode: number,
    message: string
  ) {
    super(message);
    this.name = "FileManagerRouteError";
  }
}

interface FileManagerEntry {
  name: string;
  path: string;
  type: "directory" | "file";
  sizeBytes: number | null;
  updatedAt: string;
}

interface FilePreviewPayload {
  content: string;
  sizeBytes: number;
  truncated: boolean;
}

interface UploadSession {
  key: string;
  pipelineId: string;
  scope: FilesScope;
  runId: string | null;
  destinationPath: string;
  targetPath: string;
  tempPath: string;
  totalChunks: number;
  totalSizeBytes: number;
  nextChunkIndex: number;
  receivedBytes: number;
  overwrite: boolean;
  expiresAt: number;
}

const uploadSessions = new Map<string, UploadSession>();

function safeStorageSegment(value: string): string {
  const trimmed = value.trim();
  const fallback = trimmed.length > 0 ? trimmed : "default";
  return fallback.replace(/[^a-zA-Z0-9._-]+/g, "_");
}

function toPosixPath(value: string): string {
  return value.split(path.sep).join("/");
}

function normalizeRelativePath(input: string | undefined): string {
  const raw = (input ?? "").trim();
  if (raw.length === 0) {
    return "";
  }

  const candidate = raw.replace(/\\/g, "/");
  if (candidate.includes("\0")) {
    throw new FileManagerRouteError(400, "Path contains invalid characters.");
  }
  if (candidate.startsWith("/")) {
    throw new FileManagerRouteError(400, "Absolute paths are not allowed.");
  }
  if (/^[a-zA-Z]:\//.test(candidate)) {
    throw new FileManagerRouteError(400, "Absolute paths are not allowed.");
  }

  const normalized = path.posix.normalize(candidate);
  if (normalized === "." || normalized === "./") {
    return "";
  }
  if (normalized === ".." || normalized.startsWith("../")) {
    throw new FileManagerRouteError(400, "Path escapes the allowed storage scope.");
  }

  return normalized;
}

function normalizeForComparison(value: string): string {
  const resolved = path.resolve(value);
  const normalized = process.platform === "win32" ? resolved.toLowerCase() : resolved;
  return normalized.replace(/[\\/]+$/, "");
}

function isPathWithinRoot(rootPath: string, candidatePath: string): boolean {
  const root = normalizeForComparison(rootPath);
  const candidate = normalizeForComparison(candidatePath);
  if (candidate === root) {
    return true;
  }

  const rootPrefix = `${root}${path.sep}`;
  return candidate.startsWith(rootPrefix);
}

function resolvePathWithinRoot(rootPath: string, relativePath: string): string {
  const resolvedRoot = path.resolve(rootPath);
  const candidate = relativePath.length > 0
    ? path.resolve(resolvedRoot, ...relativePath.split("/"))
    : resolvedRoot;

  if (!isPathWithinRoot(resolvedRoot, candidate)) {
    throw new FileManagerRouteError(400, "Path escapes the allowed storage scope.");
  }

  return candidate;
}

async function assertRealPathInsideRoot(rootPath: string, candidatePath: string): Promise<void> {
  const resolvedRoot = path.resolve(rootPath);
  const rootRealPath = await fs.realpath(resolvedRoot).catch(() => resolvedRoot);
  const resolvedCandidate = path.resolve(candidatePath);
  const candidateRealPath = await fs.realpath(resolvedCandidate).catch(() => {
    const relativeToRoot = path.relative(resolvedRoot, resolvedCandidate);
    if (relativeToRoot === "" || (!relativeToRoot.startsWith("..") && !path.isAbsolute(relativeToRoot))) {
      return path.resolve(rootRealPath, relativeToRoot);
    }
    return resolvedCandidate;
  });

  if (!isPathWithinRoot(rootRealPath, candidateRealPath)) {
    throw new FileManagerRouteError(400, "Path escapes the allowed storage scope.");
  }
}

function resolveScopeRoot(
  state: DashboardState,
  storage: StorageConfig,
  pipelineId: string,
  scope: FilesScope,
  runId?: string
): ResolvedScope {
  if (!storage.enabled) {
    throw new FileManagerRouteError(409, "Storage is disabled. Enable storage in MCP & Storage.");
  }

  const storageRoot = path.resolve(storage.rootPath);
  const safePipelineId = safeStorageSegment(pipelineId);

  if (scope === "shared") {
    return {
      rootPath: path.join(storageRoot, storage.sharedFolder, safePipelineId),
      rootLabel: "Shared storage"
    };
  }

  if (scope === "isolated") {
    return {
      rootPath: path.join(storageRoot, storage.isolatedFolder, safePipelineId),
      rootLabel: "Isolated storage"
    };
  }

  const normalizedRunId = (runId ?? "").trim();
  if (normalizedRunId.length === 0) {
    throw new FileManagerRouteError(400, "runId is required for runs scope.");
  }

  const run = state.runs.find((candidate) => candidate.id === normalizedRunId);
  if (!run || run.pipelineId !== pipelineId) {
    throw new FileManagerRouteError(404, "Run not found for this pipeline.");
  }

  return {
    rootPath: path.join(storageRoot, storage.runsFolder, safeStorageSegment(normalizedRunId)),
    rootLabel: `Run storage (${normalizedRunId})`
  };
}

async function listDirectoryEntries(
  rootPath: string,
  targetPath: string
): Promise<{ entries: FileManagerEntry[]; truncated: boolean }> {
  const dirEntries = await fs.readdir(targetPath, { withFileTypes: true });
  const truncated = dirEntries.length > MAX_DIRECTORY_ENTRIES;
  const selected = dirEntries.slice(0, MAX_DIRECTORY_ENTRIES);

  const entries = (
    await Promise.all(
      selected.map(async (entry): Promise<FileManagerEntry | null> => {
        if (entry.name === "." || entry.name === "..") {
          return null;
        }

        const absoluteEntryPath = path.join(targetPath, entry.name);
        const stats = await fs.lstat(absoluteEntryPath).catch(() => null);
        if (!stats || stats.isSymbolicLink()) {
          return null;
        }

        await assertRealPathInsideRoot(rootPath, absoluteEntryPath);
        const relativeEntryPath = toPosixPath(path.relative(rootPath, absoluteEntryPath));

        return {
          name: entry.name,
          path: relativeEntryPath,
          type: stats.isDirectory() ? "directory" : "file",
          sizeBytes: stats.isFile() ? stats.size : null,
          updatedAt: stats.mtime.toISOString()
        };
      })
    )
  )
    .filter((entry): entry is FileManagerEntry => entry !== null)
    .sort((left, right) => {
      if (left.type !== right.type) {
        return left.type === "directory" ? -1 : 1;
      }
      return left.name.localeCompare(right.name);
    });

  return { entries, truncated };
}

function inferMimeType(filePath: string): string {
  const extension = path.extname(filePath).toLowerCase();
  switch (extension) {
    case ".png":
      return "image/png";
    case ".jpg":
    case ".jpeg":
      return "image/jpeg";
    case ".gif":
      return "image/gif";
    case ".svg":
      return "image/svg+xml";
    case ".webp":
      return "image/webp";
    case ".ico":
      return "image/x-icon";
    case ".bmp":
      return "image/bmp";
    case ".html":
    case ".htm":
      return "text/html";
    case ".js":
      return "text/javascript";
    case ".mjs":
      return "text/javascript";
    case ".css":
      return "text/css";
    case ".md":
    case ".markdown":
      return "text/markdown";
    case ".json":
      return "application/json";
    case ".xml":
      return "application/xml";
    case ".yaml":
    case ".yml":
      return "application/yaml";
    case ".csv":
      return "text/csv";
    case ".tsv":
      return "text/tab-separated-values";
    default:
      return "text/plain";
  }
}

function inferPreviewKind(mimeType: string): FilePreviewKind {
  if (mimeType === "text/html") {
    return "html";
  }
  return "text";
}

function isLikelyTextContent(buffer: Buffer): boolean {
  if (buffer.length === 0) {
    return true;
  }

  const sample = buffer.subarray(0, Math.min(buffer.length, TEXT_PREVIEW_SAMPLE_BYTES));
  let controlChars = 0;
  for (const byte of sample) {
    if (byte === 0) {
      return false;
    }

    const isControlChar = byte < 0x09 || (byte > 0x0d && byte < 0x20);
    if (isControlChar) {
      controlChars += 1;
    }
  }

  return controlChars / sample.length < 0.02;
}

async function readFilePreview(targetPath: string, maxBytes: number): Promise<FilePreviewPayload> {
  const fileHandle = await fs.open(targetPath, "r");
  try {
    const stats = await fileHandle.stat();
    const sizeBytes = Math.max(0, Number(stats.size));
    const bytesToRead = Math.max(0, Math.min(sizeBytes, maxBytes + 1));

    if (bytesToRead === 0) {
      return {
        content: "",
        sizeBytes,
        truncated: false
      };
    }

    const buffer = Buffer.allocUnsafe(bytesToRead);
    const { bytesRead } = await fileHandle.read(buffer, 0, bytesToRead, 0);
    const data = buffer.subarray(0, bytesRead);
    const truncated = sizeBytes > maxBytes || bytesRead > maxBytes;
    const previewBytes = truncated ? data.subarray(0, maxBytes) : data;

    if (!isLikelyTextContent(previewBytes)) {
      throw new FileManagerRouteError(415, "File preview supports text files only.");
    }

    return {
      content: previewBytes.toString("utf8"),
      sizeBytes,
      truncated
    };
  } finally {
    await fileHandle.close();
  }
}

function toContentDispositionFilename(fileName: string): string {
  return fileName.replace(/[\r\n"]/g, "_");
}

function isTruthyQueryFlag(raw: string | undefined): boolean {
  if (!raw) {
    return false;
  }
  const normalized = raw.trim().toLowerCase();
  return normalized === "1" || normalized === "true" || normalized === "yes";
}

function normalizeUploadId(uploadId: string): string {
  const normalized = safeStorageSegment(uploadId).slice(0, 120);
  if (normalized.length === 0) {
    throw new FileManagerRouteError(400, "uploadId must include valid characters.");
  }
  return normalized;
}

function uploadSessionKey(input: {
  pipelineId: string;
  scope: FilesScope;
  runId?: string;
  uploadId: string;
}): string {
  return `${input.pipelineId}::${input.scope}::${input.runId ?? "-"}::${input.uploadId}`;
}

function parseBase64Chunk(value: string): Buffer {
  const normalized = value.replace(/\s+/g, "");
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(normalized) || normalized.length % 4 !== 0) {
    throw new FileManagerRouteError(400, "chunkBase64 must be valid base64.");
  }
  return Buffer.from(normalized, "base64");
}

function isPrivateIpv4Address(hostname: string): boolean {
  const segments = hostname.split(".");
  if (segments.length !== 4) {
    return false;
  }

  const bytes = segments.map((segment) => Number.parseInt(segment, 10));
  if (bytes.some((value) => !Number.isFinite(value) || value < 0 || value > 255)) {
    return false;
  }

  if (bytes[0] === 10 || bytes[0] === 127 || bytes[0] === 0) {
    return true;
  }
  if (bytes[0] === 169 && bytes[1] === 254) {
    return true;
  }
  if (bytes[0] === 192 && bytes[1] === 168) {
    return true;
  }
  if (bytes[0] === 172 && bytes[1] >= 16 && bytes[1] <= 31) {
    return true;
  }
  return false;
}

function normalizeHostnameForNetworkChecks(hostname: string): string {
  const normalized = hostname.trim().toLowerCase();
  const withoutBrackets =
    normalized.startsWith("[") && normalized.endsWith("]") ? normalized.slice(1, -1).trim() : normalized;
  return withoutBrackets.replace(/\.+$/, "");
}

function parseIpv4Address(hostname: string): number[] | null {
  const segments = hostname.split(".");
  if (segments.length !== 4) {
    return null;
  }

  const bytes = segments.map((segment) => Number.parseInt(segment, 10));
  if (bytes.some((value) => !Number.isFinite(value) || value < 0 || value > 255)) {
    return null;
  }

  return bytes;
}

function decodeMappedIpv4FromIpv6(hostname: string): string | null {
  const dottedMatch = hostname.match(/^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i);
  if (dottedMatch?.[1]) {
    const bytes = parseIpv4Address(dottedMatch[1]);
    return bytes ? bytes.join(".") : null;
  }

  const hexMatch = hostname.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/i);
  if (!hexMatch?.[1] || !hexMatch[2]) {
    return null;
  }

  const high = Number.parseInt(hexMatch[1], 16);
  const low = Number.parseInt(hexMatch[2], 16);
  if (!Number.isFinite(high) || !Number.isFinite(low)) {
    return null;
  }

  const a = (high >> 8) & 0xff;
  const b = high & 0xff;
  const c = (low >> 8) & 0xff;
  const d = low & 0xff;
  return `${a}.${b}.${c}.${d}`;
}

function isPrivateIpv6Address(hostname: string): boolean {
  const normalized = normalizeHostnameForNetworkChecks(hostname).split("%")[0] ?? "";
  if (normalized === "::1" || normalized === "::" || normalized.startsWith("fe80:")) {
    return true;
  }

  const mappedIpv4 = decodeMappedIpv4FromIpv6(normalized);
  if (mappedIpv4 && isPrivateIpv4Address(mappedIpv4)) {
    return true;
  }

  return normalized.startsWith("fc") || normalized.startsWith("fd");
}

function assertImportUrlAllowed(sourceUrl: string): URL {
  let parsed: URL;
  try {
    parsed = new URL(sourceUrl);
  } catch {
    throw new FileManagerRouteError(400, "sourceUrl must be a valid URL.");
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new FileManagerRouteError(400, "Only http/https source URLs are allowed.");
  }

  const host = normalizeHostnameForNetworkChecks(parsed.hostname);
  if (host.length === 0) {
    throw new FileManagerRouteError(400, "sourceUrl must include a hostname.");
  }
  if (host === "localhost" || host.endsWith(".localhost")) {
    throw new FileManagerRouteError(400, "Localhost URLs are not allowed.");
  }
  if (
    host.endsWith(".local") ||
    host.endsWith(".localdomain") ||
    host.endsWith(".internal")
  ) {
    throw new FileManagerRouteError(400, "Private network hostnames are not allowed.");
  }

  const ipVersion = isIP(host);
  if (ipVersion === 4 && isPrivateIpv4Address(host)) {
    throw new FileManagerRouteError(400, "Private network URLs are not allowed.");
  }
  if (ipVersion === 6 && isPrivateIpv6Address(host)) {
    throw new FileManagerRouteError(400, "Private network URLs are not allowed.");
  }

  return parsed;
}

function isDnsValidationDisabled(): boolean {
  const raw = (process.env.FYREFLOW_DISABLE_URL_IMPORT_DNS_VALIDATION ?? "").trim().toLowerCase();
  return raw === "1" || raw === "true" || raw === "yes" || raw === "on";
}

function isRedirectStatus(statusCode: number): boolean {
  return statusCode === 301 || statusCode === 302 || statusCode === 303 || statusCode === 307 || statusCode === 308;
}

async function assertResolvedAddressAllowed(hostname: string): Promise<void> {
  if (isDnsValidationDisabled()) {
    return;
  }

  const normalizedHost = normalizeHostnameForNetworkChecks(hostname);
  if (isIP(normalizedHost) !== 0) {
    return;
  }

  let resolved: Array<{ address: string; family: number }>;
  try {
    resolved = await dnsLookup(normalizedHost, { all: true, verbatim: true });
  } catch {
    throw new FileManagerRouteError(400, "sourceUrl hostname could not be resolved.");
  }

  if (!Array.isArray(resolved) || resolved.length === 0) {
    throw new FileManagerRouteError(400, "sourceUrl hostname could not be resolved.");
  }

  for (const address of resolved) {
    if (address.family === 4 && isPrivateIpv4Address(address.address)) {
      throw new FileManagerRouteError(400, "Private network URLs are not allowed.");
    }
    if (address.family === 6 && isPrivateIpv6Address(address.address)) {
      throw new FileManagerRouteError(400, "Private network URLs are not allowed.");
    }
  }
}

function deriveDestinationPathFromUrl(sourceUrl: URL): string {
  const fileNameRaw = sourceUrl.pathname.split("/").at(-1) ?? "";
  if (fileNameRaw.trim().length === 0) {
    throw new FileManagerRouteError(400, "destinationPath is required when URL does not contain a file name.");
  }

  let decodedName = fileNameRaw;
  try {
    decodedName = decodeURIComponent(fileNameRaw);
  } catch {
    decodedName = fileNameRaw;
  }

  const normalized = normalizeRelativePath(decodedName);
  if (normalized.length === 0) {
    throw new FileManagerRouteError(400, "Could not derive a valid destinationPath from sourceUrl.");
  }
  return normalized;
}

function buildUploadTempPath(targetPath: string, uploadId: string): string {
  const parentDir = path.dirname(targetPath);
  const baseName = path.basename(targetPath);
  return path.join(parentDir, `.${baseName}.upload-${uploadId}-${randomUUID()}.part`);
}

async function cleanupExpiredUploadSessions(now = Date.now()): Promise<void> {
  const expiredTempPaths: string[] = [];

  for (const [key, session] of uploadSessions.entries()) {
    if (session.expiresAt > now) {
      continue;
    }
    uploadSessions.delete(key);
    expiredTempPaths.push(session.tempPath);
  }

  if (expiredTempPaths.length === 0) {
    return;
  }

  await Promise.all(expiredTempPaths.map((tempPath) => fs.rm(tempPath, { force: true }).catch(() => undefined)));
}

async function ensureTargetCanBeWritten(targetPath: string, overwrite: boolean): Promise<void> {
  const existing = await fs.lstat(targetPath).catch((error) => {
    const code = (error as NodeJS.ErrnoException | undefined)?.code;
    if (code === "ENOENT") {
      return null;
    }
    throw error;
  });

  if (!existing) {
    return;
  }
  if (existing.isSymbolicLink()) {
    throw new FileManagerRouteError(400, "Symbolic links are not supported.");
  }
  if (!existing.isFile()) {
    throw new FileManagerRouteError(400, "Destination path must point to a file.");
  }
  if (!overwrite) {
    throw new FileManagerRouteError(409, "Destination file already exists.");
  }
}

async function ensureParentDirectory(rootPath: string, targetPath: string): Promise<void> {
  const parentDir = path.dirname(targetPath);
  await fs.mkdir(parentDir, { recursive: true });
  await assertRealPathInsideRoot(rootPath, parentDir);
}

async function finalizeUploadedFile(session: UploadSession): Promise<void> {
  if (session.receivedBytes !== session.totalSizeBytes) {
    throw new FileManagerRouteError(
      400,
      `Upload size mismatch: expected ${session.totalSizeBytes} bytes, received ${session.receivedBytes}.`
    );
  }

  if (session.overwrite) {
    await fs.rm(session.targetPath, { force: true }).catch((error) => {
      const code = (error as NodeJS.ErrnoException | undefined)?.code;
      if (code !== "ENOENT") {
        throw error;
      }
    });
  }

  await fs.rename(session.tempPath, session.targetPath);
}

async function downloadRemoteFileToTemp(sourceUrl: URL, tempPath: string): Promise<number> {
  const controller = new AbortController();
  const timeout = setTimeout(() => {
    controller.abort("timeout");
  }, URL_IMPORT_TIMEOUT_MS);

  let handle: fs.FileHandle | null = null;

  try {
    let response: Response | null = null;
    let currentUrl = new URL(sourceUrl.toString());
    let redirectCount = 0;

    while (true) {
      await assertResolvedAddressAllowed(currentUrl.hostname.trim().toLowerCase());

      response = await fetch(currentUrl, {
        method: "GET",
        redirect: "manual",
        signal: controller.signal,
        headers: {
          "User-Agent": "fyreflow-file-manager/1.0"
        }
      });

      if (!isRedirectStatus(response.status)) {
        break;
      }

      if (redirectCount >= URL_IMPORT_MAX_REDIRECTS) {
        throw new FileManagerRouteError(400, "URL import failed: too many redirects.");
      }

      const location = response.headers.get("location")?.trim();
      if (!location) {
        throw new FileManagerRouteError(400, "URL import failed: redirect location is missing.");
      }

      currentUrl = assertImportUrlAllowed(new URL(location, currentUrl).toString());
      redirectCount += 1;
    }

    if (!response.ok) {
      throw new FileManagerRouteError(400, `URL import failed: upstream returned HTTP ${response.status}.`);
    }

    const contentLengthHeader = response.headers.get("content-length");
    if (contentLengthHeader) {
      const parsedLength = Number.parseInt(contentLengthHeader, 10);
      if (Number.isFinite(parsedLength) && parsedLength > MAX_URL_IMPORT_BYTES) {
        throw new FileManagerRouteError(
          413,
          `URL import exceeds ${Math.trunc(MAX_URL_IMPORT_BYTES / (1024 * 1024))} MB limit.`
        );
      }
    }

    if (!response.body) {
      throw new FileManagerRouteError(502, "URL import failed: response body is empty.");
    }

    handle = await fs.open(tempPath, "wx");
    const reader = response.body.getReader();
    let totalBytes = 0;

    while (true) {
      const chunk = await reader.read();
      if (chunk.done) {
        break;
      }

      const bytes = chunk.value ?? new Uint8Array(0);
      if (bytes.length === 0) {
        continue;
      }

      totalBytes += bytes.length;
      if (totalBytes > MAX_URL_IMPORT_BYTES) {
        throw new FileManagerRouteError(
          413,
          `URL import exceeds ${Math.trunc(MAX_URL_IMPORT_BYTES / (1024 * 1024))} MB limit.`
        );
      }

      await handle.write(bytes);
    }

    return totalBytes;
  } catch (error) {
    if (error instanceof FileManagerRouteError) {
      throw error;
    }

    if (error instanceof Error && error.name === "AbortError") {
      throw new FileManagerRouteError(408, "URL import timed out.");
    }

    const message = error instanceof Error ? error.message : "Unknown import error.";
    throw new FileManagerRouteError(502, `Failed to import URL: ${message}`);
  } finally {
    clearTimeout(timeout);
    if (handle) {
      await handle.close().catch(() => undefined);
    }
  }
}

function toQueryParam(raw: unknown): string | undefined {
  if (raw === undefined || raw === null) {
    return undefined;
  }

  return firstParam(raw as string | string[] | undefined);
}

function parseListQuery(request: Request): {
  pipelineId: string;
  scope: FilesScope;
  runId?: string;
  path: string;
} {
  const parsed = filesListQuerySchema.parse({
    pipelineId: toQueryParam(request.query.pipelineId),
    scope: toQueryParam(request.query.scope),
    runId: toQueryParam(request.query.runId),
    path: toQueryParam(request.query.path)
  });

  return {
    pipelineId: parsed.pipelineId.trim(),
    scope: parsed.scope,
    runId: parsed.runId?.trim(),
    path: parsed.path
  };
}

function parseContentQuery(request: Request): {
  pipelineId: string;
  scope: FilesScope;
  runId?: string;
  path: string;
  maxBytes: number;
} {
  const parsed = filesContentQuerySchema.parse({
    pipelineId: toQueryParam(request.query.pipelineId),
    scope: toQueryParam(request.query.scope),
    runId: toQueryParam(request.query.runId),
    path: toQueryParam(request.query.path),
    maxBytes: toQueryParam(request.query.maxBytes)
  });

  return {
    pipelineId: parsed.pipelineId.trim(),
    scope: parsed.scope,
    runId: parsed.runId?.trim(),
    path: parsed.path,
    maxBytes: parsed.maxBytes
  };
}

function parseDeleteBody(request: Request): {
  pipelineId: string;
  scope: FilesScope;
  runId?: string;
  path: string;
  recursive: boolean;
} {
  const parsed = filesDeleteSchema.parse(request.body ?? {});
  return {
    pipelineId: parsed.pipelineId.trim(),
    scope: parsed.scope,
    runId: parsed.runId?.trim(),
    path: parsed.path,
    recursive: parsed.recursive
  };
}

function parseUploadChunkBody(request: Request): {
  pipelineId: string;
  scope: FilesScope;
  runId?: string;
  destinationPath: string;
  uploadId: string;
  chunkIndex: number;
  totalChunks: number;
  totalSizeBytes: number;
  chunk: Buffer;
  overwrite: boolean;
} {
  const parsed = filesUploadChunkSchema.parse(request.body ?? {});
  const destinationPath = normalizeRelativePath(parsed.destinationPath);
  if (destinationPath.length === 0) {
    throw new FileManagerRouteError(400, "destinationPath is required.");
  }

  const uploadId = normalizeUploadId(parsed.uploadId.trim());
  const chunk = parseBase64Chunk(parsed.chunkBase64);
  if (chunk.length > MAX_UPLOAD_CHUNK_BYTES) {
    throw new FileManagerRouteError(
      413,
      `Upload chunk exceeds ${Math.trunc(MAX_UPLOAD_CHUNK_BYTES / 1024)} KB limit.`
    );
  }
  if (parsed.totalSizeBytes > MAX_FILE_UPLOAD_BYTES) {
    throw new FileManagerRouteError(
      413,
      `Upload exceeds ${Math.trunc(MAX_FILE_UPLOAD_BYTES / (1024 * 1024))} MB limit.`
    );
  }

  return {
    pipelineId: parsed.pipelineId.trim(),
    scope: parsed.scope,
    runId: parsed.runId?.trim(),
    destinationPath,
    uploadId,
    chunkIndex: parsed.chunkIndex,
    totalChunks: parsed.totalChunks,
    totalSizeBytes: parsed.totalSizeBytes,
    chunk,
    overwrite: parsed.overwrite
  };
}

function parseImportUrlBody(request: Request): {
  pipelineId: string;
  scope: FilesScope;
  runId?: string;
  sourceUrl: URL;
  destinationPath?: string;
  overwrite: boolean;
} {
  const parsed = filesImportUrlSchema.parse(request.body ?? {});
  const destinationPathRaw = parsed.destinationPath?.trim() ?? "";
  const destinationPath = destinationPathRaw.length > 0 ? normalizeRelativePath(destinationPathRaw) : undefined;
  if (destinationPathRaw.length > 0 && (!destinationPath || destinationPath.length === 0)) {
    throw new FileManagerRouteError(400, "destinationPath is invalid.");
  }

  return {
    pipelineId: parsed.pipelineId.trim(),
    scope: parsed.scope,
    runId: parsed.runId?.trim(),
    sourceUrl: assertImportUrlAllowed(parsed.sourceUrl),
    destinationPath,
    overwrite: parsed.overwrite
  };
}

function parseRawParams(request: Request): {
  pipelineId: string;
  scope: FilesScope;
  runId?: string;
  path: string;
} {
  const scopeValue = (request.params.scope ?? "").trim();
  if (scopeValue !== "shared" && scopeValue !== "isolated" && scopeValue !== "runs") {
    throw new FileManagerRouteError(400, "Invalid storage scope.");
  }

  const pipelineId = (request.params.pipelineId ?? "").trim();
  if (pipelineId.length === 0 || pipelineId.length > 240) {
    throw new FileManagerRouteError(400, "Invalid pipelineId.");
  }

  const runIdParam = (request.params.runId ?? "").trim();
  const runId = runIdParam === "-" ? undefined : runIdParam;
  if (scopeValue === "runs" && (!runId || runId.length === 0)) {
    throw new FileManagerRouteError(400, "runId is required for runs scope.");
  }

  const wildcardPath = (request.params["0"] ?? "").trim();
  const normalizedPath = normalizeRelativePath(wildcardPath);
  if (normalizedPath.length === 0) {
    throw new FileManagerRouteError(400, "File path is required.");
  }

  return {
    pipelineId,
    scope: scopeValue,
    runId,
    path: normalizedPath
  };
}

function parentPathFrom(relativePath: string): string | null {
  if (relativePath.length === 0) {
    return null;
  }

  const parent = path.posix.dirname(relativePath);
  if (parent === "." || parent.length === 0) {
    return "";
  }

  return parent;
}

function sendFileManagerError(error: unknown, response: Response): void {
  if (error instanceof FileManagerRouteError) {
    response.status(error.statusCode).json({ error: error.message });
    return;
  }

  sendZodError(error, response);
}

export function registerFileManagerRoutes(app: Express, deps: PipelineRouteContext): void {
  app.get("/api/files", async (request: Request, response: Response) => {
    try {
      const input = parseListQuery(request);
      const pipeline = deps.store.getPipeline(input.pipelineId);
      if (!pipeline) {
        response.status(404).json({ error: "Pipeline not found" });
        return;
      }

      const state = deps.store.getState();
      const scope = resolveScopeRoot(state, state.storage, input.pipelineId, input.scope, input.runId);
      const normalizedPath = normalizeRelativePath(input.path);
      const targetPath = resolvePathWithinRoot(scope.rootPath, normalizedPath);
      await assertRealPathInsideRoot(scope.rootPath, targetPath);

      let entries: FileManagerEntry[] = [];
      let truncated = false;
      let exists = true;

      try {
        const stats = await fs.stat(targetPath);
        if (!stats.isDirectory()) {
          throw new FileManagerRouteError(400, "Requested path is not a directory.");
        }
        const listed = await listDirectoryEntries(scope.rootPath, targetPath);
        entries = listed.entries;
        truncated = listed.truncated;
      } catch (error) {
        const code = (error as NodeJS.ErrnoException | undefined)?.code;
        if (code === "ENOENT") {
          exists = false;
          entries = [];
          truncated = false;
        } else if (error instanceof FileManagerRouteError) {
          throw error;
        } else {
          throw error;
        }
      }

      response.json({
        pipelineId: input.pipelineId,
        scope: input.scope,
        runId: input.runId ?? null,
        rootLabel: scope.rootLabel,
        currentPath: normalizedPath,
        parentPath: parentPathFrom(normalizedPath),
        exists,
        entries,
        truncated
      });
    } catch (error) {
      sendFileManagerError(error, response);
    }
  });

  app.get("/api/files/content", async (request: Request, response: Response) => {
    try {
      const input = parseContentQuery(request);
      const pipeline = deps.store.getPipeline(input.pipelineId);
      if (!pipeline) {
        response.status(404).json({ error: "Pipeline not found" });
        return;
      }

      const state = deps.store.getState();
      const scope = resolveScopeRoot(state, state.storage, input.pipelineId, input.scope, input.runId);
      const normalizedPath = normalizeRelativePath(input.path);
      if (normalizedPath.length === 0) {
        throw new FileManagerRouteError(400, "File path is required.");
      }

      const targetPath = resolvePathWithinRoot(scope.rootPath, normalizedPath);
      await assertRealPathInsideRoot(scope.rootPath, targetPath);

      const stats = await fs.lstat(targetPath).catch((error) => {
        const code = (error as NodeJS.ErrnoException | undefined)?.code;
        if (code === "ENOENT") {
          throw new FileManagerRouteError(404, "Path not found.");
        }
        throw error;
      });

      if (!stats) {
        throw new FileManagerRouteError(404, "Path not found.");
      }
      if (stats.isSymbolicLink()) {
        throw new FileManagerRouteError(400, "Symbolic links are not supported.");
      }
      if (!stats.isFile()) {
        throw new FileManagerRouteError(400, "Requested path is not a file.");
      }

      const maxBytes = Math.min(
        MAX_FILE_PREVIEW_BYTES_LIMIT,
        Math.max(1, input.maxBytes || MAX_FILE_PREVIEW_BYTES_DEFAULT)
      );
      const preview = await readFilePreview(targetPath, maxBytes);
      const mimeType = inferMimeType(targetPath);

      response.json({
        pipelineId: input.pipelineId,
        scope: input.scope,
        runId: input.runId ?? null,
        rootLabel: scope.rootLabel,
        path: normalizedPath,
        name: path.posix.basename(normalizedPath),
        mimeType,
        previewKind: inferPreviewKind(mimeType),
        sizeBytes: preview.sizeBytes,
        truncated: preview.truncated,
        maxBytes,
        content: preview.content
      });
    } catch (error) {
      sendFileManagerError(error, response);
    }
  });

  app.get("/api/files/raw/:scope/:pipelineId/:runId/*", async (request: Request, response: Response) => {
    try {
      const input = parseRawParams(request);
      const pipeline = deps.store.getPipeline(input.pipelineId);
      if (!pipeline) {
        response.status(404).json({ error: "Pipeline not found" });
        return;
      }

      const state = deps.store.getState();
      const scope = resolveScopeRoot(state, state.storage, input.pipelineId, input.scope, input.runId);
      const targetPath = resolvePathWithinRoot(scope.rootPath, input.path);
      await assertRealPathInsideRoot(scope.rootPath, targetPath);

      const stats = await fs.lstat(targetPath).catch((error) => {
        const code = (error as NodeJS.ErrnoException | undefined)?.code;
        if (code === "ENOENT") {
          throw new FileManagerRouteError(404, "Path not found.");
        }
        throw error;
      });

      if (!stats) {
        throw new FileManagerRouteError(404, "Path not found.");
      }
      if (stats.isSymbolicLink()) {
        throw new FileManagerRouteError(400, "Symbolic links are not supported.");
      }
      if (!stats.isFile()) {
        throw new FileManagerRouteError(400, "Requested path is not a file.");
      }

      const content = await fs.readFile(targetPath);
      const mimeType = inferMimeType(targetPath);
      response.setHeader("Content-Type", mimeType);
      response.setHeader("Content-Length", String(content.length));
      response.setHeader("Cache-Control", "no-store");
      const shouldDownload = isTruthyQueryFlag(toQueryParam(request.query.download));
      if (shouldDownload) {
        const fileName = path.basename(targetPath);
        const safeFileName = toContentDispositionFilename(fileName);
        response.setHeader(
          "Content-Disposition",
          `attachment; filename="${safeFileName}"; filename*=UTF-8''${encodeURIComponent(fileName)}`
        );
      }
      response.send(content);
    } catch (error) {
      sendFileManagerError(error, response);
    }
  });

  app.post("/api/files/upload", async (request: Request, response: Response) => {
    try {
      await cleanupExpiredUploadSessions();
      const input = parseUploadChunkBody(request);
      const pipeline = deps.store.getPipeline(input.pipelineId);
      if (!pipeline) {
        response.status(404).json({ error: "Pipeline not found" });
        return;
      }

      const state = deps.store.getState();
      const scope = resolveScopeRoot(state, state.storage, input.pipelineId, input.scope, input.runId);
      await fs.mkdir(scope.rootPath, { recursive: true });

      const targetPath = resolvePathWithinRoot(scope.rootPath, input.destinationPath);
      await ensureParentDirectory(scope.rootPath, targetPath);
      await assertRealPathInsideRoot(scope.rootPath, targetPath);

      const sessionKey = uploadSessionKey({
        pipelineId: input.pipelineId,
        scope: input.scope,
        runId: input.runId,
        uploadId: input.uploadId
      });
      const now = Date.now();
      const runId = input.runId ?? null;

      if (input.chunkIndex === 0) {
        const existing = uploadSessions.get(sessionKey);
        if (existing) {
          uploadSessions.delete(sessionKey);
          await fs.rm(existing.tempPath, { force: true }).catch(() => undefined);
        }

        await ensureTargetCanBeWritten(targetPath, input.overwrite);
        const tempPath = buildUploadTempPath(targetPath, input.uploadId);
        const handle = await fs.open(tempPath, "wx");
        try {
          if (input.chunk.length > 0) {
            await handle.write(input.chunk);
          }
        } finally {
          await handle.close();
        }

        const session: UploadSession = {
          key: sessionKey,
          pipelineId: input.pipelineId,
          scope: input.scope,
          runId,
          destinationPath: input.destinationPath,
          targetPath,
          tempPath,
          totalChunks: input.totalChunks,
          totalSizeBytes: input.totalSizeBytes,
          nextChunkIndex: 1,
          receivedBytes: input.chunk.length,
          overwrite: input.overwrite,
          expiresAt: now + UPLOAD_SESSION_TTL_MS
        };

        if (session.receivedBytes > session.totalSizeBytes) {
          uploadSessions.delete(sessionKey);
          await fs.rm(session.tempPath, { force: true }).catch(() => undefined);
          throw new FileManagerRouteError(400, "Upload chunk exceeds declared totalSizeBytes.");
        }

        if (session.totalChunks === 1) {
          try {
            await finalizeUploadedFile(session);
          } catch (error) {
            await fs.rm(session.tempPath, { force: true }).catch(() => undefined);
            throw error;
          }
          response.status(201).json({
            pipelineId: input.pipelineId,
            scope: input.scope,
            runId,
            path: input.destinationPath,
            sizeBytes: session.receivedBytes,
            status: "completed"
          });
          return;
        }

        uploadSessions.set(sessionKey, session);
        response.status(202).json({
          pipelineId: input.pipelineId,
          scope: input.scope,
          runId,
          path: input.destinationPath,
          chunkIndex: input.chunkIndex,
          totalChunks: session.totalChunks,
          receivedBytes: session.receivedBytes,
          status: "chunk_received"
        });
        return;
      }

      const session = uploadSessions.get(sessionKey);
      if (!session) {
        throw new FileManagerRouteError(409, "Upload session not found or expired. Restart upload from chunk 0.");
      }
      if (
        session.pipelineId !== input.pipelineId ||
        session.scope !== input.scope ||
        session.runId !== runId ||
        session.destinationPath !== input.destinationPath ||
        session.totalChunks !== input.totalChunks ||
        session.totalSizeBytes !== input.totalSizeBytes
      ) {
        throw new FileManagerRouteError(409, "Upload session payload does not match the original upload.");
      }
      if (session.nextChunkIndex !== input.chunkIndex) {
        throw new FileManagerRouteError(
          409,
          `Unexpected chunkIndex ${input.chunkIndex}. Expected ${session.nextChunkIndex}.`
        );
      }

      const handle = await fs.open(session.tempPath, "a");
      try {
        if (input.chunk.length > 0) {
          await handle.write(input.chunk);
        }
      } finally {
        await handle.close();
      }

      session.receivedBytes += input.chunk.length;
      if (session.receivedBytes > session.totalSizeBytes) {
        uploadSessions.delete(sessionKey);
        await fs.rm(session.tempPath, { force: true }).catch(() => undefined);
        throw new FileManagerRouteError(400, "Upload chunks exceed declared totalSizeBytes.");
      }

      session.nextChunkIndex += 1;
      session.expiresAt = now + UPLOAD_SESSION_TTL_MS;

      if (session.nextChunkIndex >= session.totalChunks) {
        uploadSessions.delete(sessionKey);
        try {
          await finalizeUploadedFile(session);
        } catch (error) {
          await fs.rm(session.tempPath, { force: true }).catch(() => undefined);
          throw error;
        }
        response.status(201).json({
          pipelineId: input.pipelineId,
          scope: input.scope,
          runId,
          path: input.destinationPath,
          sizeBytes: session.receivedBytes,
          status: "completed"
        });
        return;
      }

      uploadSessions.set(sessionKey, session);
      response.status(202).json({
        pipelineId: input.pipelineId,
        scope: input.scope,
        runId,
        path: input.destinationPath,
        chunkIndex: input.chunkIndex,
        totalChunks: session.totalChunks,
        receivedBytes: session.receivedBytes,
        status: "chunk_received"
      });
    } catch (error) {
      sendFileManagerError(error, response);
    }
  });

  app.post("/api/files/import-url", async (request: Request, response: Response) => {
    try {
      const input = parseImportUrlBody(request);
      const pipeline = deps.store.getPipeline(input.pipelineId);
      if (!pipeline) {
        response.status(404).json({ error: "Pipeline not found" });
        return;
      }

      const state = deps.store.getState();
      const scope = resolveScopeRoot(state, state.storage, input.pipelineId, input.scope, input.runId);
      await fs.mkdir(scope.rootPath, { recursive: true });

      const destinationPath = input.destinationPath ?? deriveDestinationPathFromUrl(input.sourceUrl);
      const targetPath = resolvePathWithinRoot(scope.rootPath, destinationPath);
      await ensureParentDirectory(scope.rootPath, targetPath);
      await assertRealPathInsideRoot(scope.rootPath, targetPath);
      await ensureTargetCanBeWritten(targetPath, input.overwrite);

      const tempPath = buildUploadTempPath(targetPath, "url-import");
      let downloadedBytes = 0;
      try {
        downloadedBytes = await downloadRemoteFileToTemp(input.sourceUrl, tempPath);
        if (input.overwrite) {
          await fs.rm(targetPath, { force: true }).catch((error) => {
            const code = (error as NodeJS.ErrnoException | undefined)?.code;
            if (code !== "ENOENT") {
              throw error;
            }
          });
        }
        await fs.rename(tempPath, targetPath);
      } catch (error) {
        await fs.rm(tempPath, { force: true }).catch(() => undefined);
        throw error;
      }

      response.status(201).json({
        pipelineId: input.pipelineId,
        scope: input.scope,
        runId: input.runId ?? null,
        path: destinationPath,
        sizeBytes: downloadedBytes,
        sourceUrl: input.sourceUrl.toString()
      });
    } catch (error) {
      sendFileManagerError(error, response);
    }
  });

  app.delete("/api/files", async (request: Request, response: Response) => {
    try {
      const input = parseDeleteBody(request);
      const pipeline = deps.store.getPipeline(input.pipelineId);
      if (!pipeline) {
        response.status(404).json({ error: "Pipeline not found" });
        return;
      }

      const normalizedPath = normalizeRelativePath(input.path);
      if (normalizedPath.length === 0) {
        throw new FileManagerRouteError(400, "Deleting scope root is not allowed.");
      }

      const state = deps.store.getState();
      const scope = resolveScopeRoot(state, state.storage, input.pipelineId, input.scope, input.runId);
      const targetPath = resolvePathWithinRoot(scope.rootPath, normalizedPath);
      await assertRealPathInsideRoot(scope.rootPath, targetPath);

      const stats = await fs.lstat(targetPath).catch((error) => {
        const code = (error as NodeJS.ErrnoException | undefined)?.code;
        if (code === "ENOENT") {
          throw new FileManagerRouteError(404, "Path not found.");
        }
        throw error;
      });

      if (!stats) {
        throw new FileManagerRouteError(404, "Path not found.");
      }
      if (stats.isSymbolicLink()) {
        throw new FileManagerRouteError(400, "Symbolic links are not supported.");
      }
      if (stats.isDirectory() && !input.recursive) {
        throw new FileManagerRouteError(400, "Directory deletion requires recursive=true.");
      }

      await fs.rm(targetPath, {
        recursive: stats.isDirectory(),
        force: false
      });

      response.json({
        deletedPath: normalizedPath,
        type: stats.isDirectory() ? "directory" : "file"
      });
    } catch (error) {
      sendFileManagerError(error, response);
    }
  });
}
