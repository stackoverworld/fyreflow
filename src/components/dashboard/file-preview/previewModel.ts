import type { StorageFilePreviewKind, StorageFilesScope } from "@/lib/types";

export type TextPreviewKind = "html" | "json" | "markdown" | "text";
export type MediaPreviewKind = "image" | "pdf" | "video" | "audio";
export type FilePreviewKind = TextPreviewKind | MediaPreviewKind | "binary";

export interface FilePreviewModalData {
  pipelineId: string;
  scope: StorageFilesScope;
  runId: string | null;
  kind: FilePreviewKind;
  name: string;
  path: string;
  mimeType: string;
  sizeBytes: number;
  content?: string;
  truncated?: boolean;
  maxBytes?: number;
  rawUrl?: string;
  message?: string;
}

export type FilePreviewClassification =
  | {
      mode: "content";
      kind: TextPreviewKind;
      mimeType: string;
    }
  | {
      mode: "raw";
      kind: MediaPreviewKind;
      mimeType: string;
    }
  | {
      mode: "unsupported";
      kind: "binary";
      mimeType: string;
    };

const IMAGE_EXTENSIONS = new Set(["png", "jpg", "jpeg", "gif", "webp", "svg", "bmp", "ico", "avif"]);
const VIDEO_EXTENSIONS = new Set(["mp4", "webm", "mov", "m4v", "mkv", "avi", "ogg"]);
const AUDIO_EXTENSIONS = new Set(["mp3", "wav", "ogg", "m4a", "aac", "flac"]);
const TEXT_EXTENSIONS = new Set([
  "txt",
  "log",
  "csv",
  "tsv",
  "xml",
  "yaml",
  "yml",
  "ini",
  "conf",
  "cfg",
  "toml",
  "env",
  "sh",
  "bash",
  "zsh",
  "ps1",
  "sql",
  "graphql",
  "gql",
  "js",
  "mjs",
  "cjs",
  "jsx",
  "ts",
  "tsx",
  "py",
  "rb",
  "php",
  "java",
  "kt",
  "go",
  "rs",
  "swift",
  "c",
  "cc",
  "cpp",
  "h",
  "hpp",
  "cs",
  "scss",
  "css",
  "less",
  "sass",
  "vue",
  "svelte"
]);
const MARKDOWN_EXTENSIONS = new Set(["md", "markdown", "mdx"]);
const JSON_EXTENSIONS = new Set(["json", "jsonl", "geojson"]);
const HTML_EXTENSIONS = new Set(["html", "htm"]);
const ARCHIVE_EXTENSIONS = new Set(["zip", "rar", "7z", "tar", "gz", "bz2", "xz"]);

function extensionFromName(fileName: string): string {
  const trimmed = fileName.trim().toLowerCase();
  const dotIndex = trimmed.lastIndexOf(".");
  if (dotIndex < 0 || dotIndex === trimmed.length - 1) {
    return "";
  }
  return trimmed.slice(dotIndex + 1);
}

function mimeByExtension(extension: string): string {
  switch (extension) {
    case "html":
    case "htm":
      return "text/html";
    case "json":
    case "jsonl":
    case "geojson":
      return "application/json";
    case "md":
    case "markdown":
    case "mdx":
      return "text/markdown";
    case "png":
      return "image/png";
    case "jpg":
    case "jpeg":
      return "image/jpeg";
    case "gif":
      return "image/gif";
    case "svg":
      return "image/svg+xml";
    case "webp":
      return "image/webp";
    case "ico":
      return "image/x-icon";
    case "bmp":
      return "image/bmp";
    case "avif":
      return "image/avif";
    case "pdf":
      return "application/pdf";
    case "mp4":
      return "video/mp4";
    case "webm":
      return "video/webm";
    case "mov":
      return "video/quicktime";
    case "m4v":
      return "video/x-m4v";
    case "mkv":
      return "video/x-matroska";
    case "avi":
      return "video/x-msvideo";
    case "mp3":
      return "audio/mpeg";
    case "wav":
      return "audio/wav";
    case "ogg":
      return "audio/ogg";
    case "m4a":
      return "audio/mp4";
    case "aac":
      return "audio/aac";
    case "flac":
      return "audio/flac";
    case "css":
      return "text/css";
    case "js":
    case "mjs":
    case "cjs":
      return "text/javascript";
    case "ts":
    case "tsx":
      return "text/typescript";
    case "csv":
      return "text/csv";
    case "xml":
      return "application/xml";
    case "yaml":
    case "yml":
      return "application/yaml";
    default:
      return "text/plain";
  }
}

export function classifyFilePreviewByName(fileName: string): FilePreviewClassification {
  const extension = extensionFromName(fileName);
  const mimeType = mimeByExtension(extension);

  if (HTML_EXTENSIONS.has(extension)) {
    return { mode: "content", kind: "html", mimeType };
  }
  if (JSON_EXTENSIONS.has(extension)) {
    return { mode: "content", kind: "json", mimeType };
  }
  if (MARKDOWN_EXTENSIONS.has(extension)) {
    return { mode: "content", kind: "markdown", mimeType };
  }
  if (IMAGE_EXTENSIONS.has(extension)) {
    return { mode: "raw", kind: "image", mimeType };
  }
  if (extension === "pdf") {
    return { mode: "raw", kind: "pdf", mimeType };
  }
  if (VIDEO_EXTENSIONS.has(extension)) {
    return { mode: "raw", kind: "video", mimeType };
  }
  if (AUDIO_EXTENSIONS.has(extension)) {
    return { mode: "raw", kind: "audio", mimeType };
  }
  if (ARCHIVE_EXTENSIONS.has(extension)) {
    return { mode: "unsupported", kind: "binary", mimeType: "application/octet-stream" };
  }
  if (TEXT_EXTENSIONS.has(extension) || extension.length === 0) {
    return { mode: "content", kind: "text", mimeType };
  }

  // Unknown extension: try text preview first; backend will reject binary by content sniffing if needed.
  return { mode: "content", kind: "text", mimeType };
}

export function resolveTextPreviewKind(
  mimeType: string,
  backendKind: StorageFilePreviewKind
): TextPreviewKind {
  if (backendKind === "html") {
    return "html";
  }

  const normalizedMime = mimeType.trim().toLowerCase();
  if (normalizedMime.includes("json")) {
    return "json";
  }
  if (normalizedMime.includes("markdown")) {
    return "markdown";
  }
  return "text";
}

export function chooseContentPreviewBytes(sizeBytes: number | null): number {
  const DEFAULT_BYTES = 256 * 1024;
  const SOFT_CAP_BYTES = 512 * 1024;
  const HARD_CAP_BYTES = 1024 * 1024;

  if (sizeBytes === null || !Number.isFinite(sizeBytes) || sizeBytes <= 0) {
    return DEFAULT_BYTES;
  }
  if (sizeBytes <= DEFAULT_BYTES) {
    return Math.max(32 * 1024, Math.trunc(sizeBytes));
  }
  if (sizeBytes <= 2 * 1024 * 1024) {
    return SOFT_CAP_BYTES;
  }
  return HARD_CAP_BYTES;
}

const RAW_PREVIEW_LIMITS: Record<MediaPreviewKind, number> = {
  image: 25 * 1024 * 1024,
  pdf: 32 * 1024 * 1024,
  video: 96 * 1024 * 1024,
  audio: 64 * 1024 * 1024
};

export function getRawPreviewLimitBytes(kind: MediaPreviewKind): number {
  return RAW_PREVIEW_LIMITS[kind];
}

export function isRawPreviewTooLarge(kind: MediaPreviewKind, sizeBytes: number | null): boolean {
  if (sizeBytes === null || !Number.isFinite(sizeBytes) || sizeBytes <= 0) {
    return false;
  }
  return sizeBytes > getRawPreviewLimitBytes(kind);
}
