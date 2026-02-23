import fs from "node:fs/promises";
import path from "node:path";
import type { Express, Request, Response } from "express";
import type { PipelineRouteContext } from "./contracts.js";
import { firstParam, sendZodError } from "./helpers.js";
import { filesContentQuerySchema, filesDeleteSchema, filesListQuerySchema } from "./schemas.js";
import type { DashboardState, StorageConfig } from "../../../types.js";

const MAX_DIRECTORY_ENTRIES = 500;
const MAX_FILE_PREVIEW_BYTES_DEFAULT = 256 * 1024;
const MAX_FILE_PREVIEW_BYTES_LIMIT = 1024 * 1024;
const TEXT_PREVIEW_SAMPLE_BYTES = 4096;

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
  const candidateRealPath = await fs.realpath(candidatePath).catch(() => path.resolve(candidatePath));

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
    case ".html":
    case ".htm":
      return "text/html";
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
