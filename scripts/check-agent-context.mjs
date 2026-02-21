import { existsSync, readFileSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { basename, join, relative, resolve } from "node:path";

const ROOT = process.cwd();
const MAX_CHAIN_BYTES = 32 * 1024;
const ROOT_MIN = 60;
const ROOT_MAX = 150;
const IGNORED = new Set([".git", "node_modules", "dist", "coverage"]);
const DEFAULT_PRIMARY_FILES = ["AGENTS.override.md", "AGENTS.md"];

function parseQuotedList(raw) {
  const values = [];
  const regex = /"([^"]+)"|'([^']+)'/g;
  for (;;) {
    const match = regex.exec(raw);
    if (!match) break;
    const value = (match[1] || match[2] || "").trim();
    if (value) values.push(value);
  }
  return values;
}

function parseFallbackEnv() {
  const raw = process.env.PRIMER_AI_AGENT_FALLBACK_FILES || "";
  if (!raw.trim()) return [];
  return raw
    .split(/[\s,]+/)
    .map((value) => value.trim())
    .filter(Boolean);
}

function parseFallbackFromCodexConfig(content) {
  const keys = [
    "project_doc_fallback_files",
    "instructions_fallback_files",
    "fallback_instruction_files",
    "instruction_fallback_files"
  ];
  const values = [];
  for (const key of keys) {
    const pattern = new RegExp(`${key}\\s*=\\s*\\[([^\\]]*)\\]`, "gi");
    for (;;) {
      const match = pattern.exec(content);
      if (!match?.[1]) break;
      values.push(...parseQuotedList(match[1]));
    }
  }
  return values;
}

function parseFallbackFiles() {
  const files = [];
  files.push(...parseFallbackEnv());

  const candidateConfigPaths = [
    join(ROOT, ".codex", "config.toml"),
    join(homedir(), ".codex", "config.toml")
  ];

  for (const configPath of candidateConfigPaths) {
    if (!existsSync(configPath)) continue;
    const content = readFileSync(configPath, "utf8");
    files.push(...parseFallbackFromCodexConfig(content));
  }

  const seen = new Set();
  const normalized = [];
  for (const file of files) {
    const onlyName = basename(file);
    if (!onlyName.endsWith(".md")) continue;
    if (seen.has(onlyName)) continue;
    seen.add(onlyName);
    normalized.push(onlyName);
  }
  return normalized;
}

const CANDIDATE_FILES = [...DEFAULT_PRIMARY_FILES];
for (const file of parseFallbackFiles()) {
  if (!CANDIDATE_FILES.includes(file)) CANDIDATE_FILES.push(file);
}

function pickInstructionFile(dir) {
  for (const name of CANDIDATE_FILES) {
    const path = join(dir, name);
    if (existsSync(path)) return path;
  }
  return null;
}

function walk(dir) {
  const entries = readdirSync(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    if (IGNORED.has(entry.name)) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) files.push(...walk(full));
    else files.push(full);
  }
  return files;
}

function listInstructionFiles() {
  const fileSet = new Set(CANDIDATE_FILES);
  return walk(ROOT)
    .filter((file) => fileSet.has(basename(file)))
    .map((file) => resolve(file));
}

function chainBytesForDir(targetDir) {
  const targetAbs = resolve(targetDir);
  const rel = relative(ROOT, targetAbs);
  const segments = rel ? rel.split("/").filter(Boolean) : [];
  const chainFiles = [];
  for (let i = 0; i <= segments.length; i += 1) {
    const dir = join(ROOT, ...segments.slice(0, i));
    const selected = pickInstructionFile(dir);
    if (selected) chainFiles.push(selected);
  }
  const bytes = chainFiles.reduce((sum, file) => sum + Buffer.byteLength(readFileSync(file, "utf8"), "utf8"), 0);
  return { bytes, chainFiles };
}

const errors = [];
const warnings = [];

const rootAgentsPath = join(ROOT, "AGENTS.md");
if (!existsSync(rootAgentsPath)) {
  errors.push("Missing root AGENTS.md");
} else {
  const rootLines = readFileSync(rootAgentsPath, "utf8").split("\n").length;
  if (rootLines < ROOT_MIN || rootLines > ROOT_MAX) {
    errors.push(`Root AGENTS.md line count is ${rootLines}; expected ${ROOT_MIN}-${ROOT_MAX}.`);
  }
}

const requiredDocs = ["docs/index.md", "docs/architecture.md", "docs/api-contracts.md", "docs/conventions.md", "docs/maintenance.md", "docs/skills.md"];
for (const file of requiredDocs) {
  if (!existsSync(join(ROOT, file))) errors.push(`Missing required doc: ${file}`);
}

const claudePath = join(ROOT, "CLAUDE.md");
if (existsSync(claudePath)) {
  const content = readFileSync(claudePath, "utf8");
  if (!content.includes("@AGENTS.md")) errors.push("CLAUDE.md must import @AGENTS.md.");
}

const fragmentDir = join(ROOT, ".agents/fragments/root");
if (existsSync(fragmentDir)) {
  const fragmentFiles = readdirSync(fragmentDir).filter((name) => name.endsWith(".md")).sort();
  if (!fragmentFiles.length) {
    errors.push("No fragment files found under .agents/fragments/root.");
  } else if (existsSync(rootAgentsPath)) {
    const composed = fragmentFiles
      .map((file) => readFileSync(join(fragmentDir, file), "utf8").trimEnd())
      .join("\n\n")
      .trimEnd() + "\n";
    const current = readFileSync(rootAgentsPath, "utf8");
    if (composed !== current) {
      errors.push("AGENTS.md is not synchronized with fragments. Run node scripts/compose-agents.mjs --write");
    }
  }
}

const instructionFiles = listInstructionFiles();
for (const file of instructionFiles) {
  const dir = resolve(file, "..");
  const { bytes, chainFiles } = chainBytesForDir(dir);
  if (bytes > MAX_CHAIN_BYTES) {
    errors.push(
      `Instruction chain exceeds 32 KiB for ${relative(ROOT, dir) || "."}: ${bytes} bytes. Chain: ${chainFiles.map((path) => relative(ROOT, path)).join(" -> ")}`
    );
  } else if (bytes > MAX_CHAIN_BYTES * 0.8) {
    warnings.push(`Instruction chain near budget for ${relative(ROOT, dir) || "."}: ${bytes} bytes.`);
  }
}

if (warnings.length) {
  for (const warning of warnings) console.warn(`[warn] ${warning}`);
}

if (errors.length) {
  for (const error of errors) console.error(`[error] ${error}`);
  process.exit(1);
}

console.log(`Agent context checks passed. Candidate instruction files: ${CANDIDATE_FILES.join(", ")}`);
