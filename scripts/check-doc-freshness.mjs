import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";

const ROOT = process.cwd();
const DOCS_DIR = resolve(ROOT, "docs");
const MAX_AGE_DAYS = Number(process.env.DOC_MAX_AGE_DAYS || 90);
const NOW = new Date();
const DATE_PATTERN = /Last reviewed:\s*(\d{4}-\d{2}-\d{2})/i;
const INVENTORY_START = "<!-- primer-ai:docs-index:start -->";
const INVENTORY_END = "<!-- primer-ai:docs-index:end -->";
const INVENTORY_ITEM_PATTERN = /-\s+`([^`]+\.md)`/g;

function walk(dir) {
  const entries = readdirSync(dir, { withFileTypes: true });
  const out = [];
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full));
    else if (entry.name.endsWith(".md")) out.push(full);
  }
  return out;
}

function collectDocsFromIndexInventory() {
  const indexPath = join(DOCS_DIR, "index.md");
  const content = readFileSync(indexPath, "utf8");
  const start = content.indexOf(INVENTORY_START);
  const end = content.indexOf(INVENTORY_END);

  if (start === -1 || end === -1 || end <= start) {
    return null;
  }

  const block = content.slice(start + INVENTORY_START.length, end);
  const docs = new Set([indexPath]);
  for (const match of block.matchAll(INVENTORY_ITEM_PATTERN)) {
    const rel = match[1]?.trim();
    if (!rel) {
      continue;
    }
    docs.add(join(DOCS_DIR, rel));
  }

  return [...docs];
}

const docs = collectDocsFromIndexInventory() ?? walk(DOCS_DIR);
const stale = [];
const missingReviewed = [];
const missingFiles = [];

for (const file of docs) {
  if (!existsSync(file)) {
    missingFiles.push(file);
    continue;
  }
  const content = readFileSync(file, "utf8");
  const match = content.match(DATE_PATTERN);
  if (!match?.[1]) {
    missingReviewed.push(file);
    continue;
  }
  const reviewedDate = new Date(`${match[1]}T00:00:00Z`);
  const ageDays = Math.floor((NOW.getTime() - reviewedDate.getTime()) / 86400000);
  if (Number.isNaN(ageDays) || ageDays > MAX_AGE_DAYS) {
    stale.push({ file, ageDays });
  }
}

if (missingFiles.length) {
  for (const file of missingFiles) console.error(`[error] Indexed doc does not exist: ${file}`);
}
if (missingReviewed.length) {
  for (const file of missingReviewed) console.error(`[error] Missing 'Last reviewed' in ${file}`);
}
if (stale.length) {
  for (const entry of stale) console.error(`[error] Stale doc (${entry.ageDays} days): ${entry.file}`);
}

if (missingFiles.length || missingReviewed.length || stale.length) {
  process.exit(1);
}

console.log(`Doc freshness checks passed (${docs.length} files).`);
