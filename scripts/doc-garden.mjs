import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve, relative } from "node:path";

const ROOT = process.cwd();
const DOCS_DIR = resolve(ROOT, "docs");
const apply = process.argv.includes("--apply");
const today = new Date().toISOString().slice(0, 10);
const reviewedPattern = /Last reviewed:\s*(\d{4}-\d{2}-\d{2})/i;
const startMarker = "<!-- primer-ai:docs-index:start -->";
const endMarker = "<!-- primer-ai:docs-index:end -->";

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

function ensureReviewedTag(content) {
  if (reviewedPattern.test(content)) return content;
  const lines = content.split("\n");
  if (lines[0]?.startsWith("# ")) {
    lines.splice(1, 0, "", `- Last reviewed: ${today}`);
    return lines.join("\n");
  }
  return `- Last reviewed: ${today}\n\n${content}`;
}

const docs = walk(DOCS_DIR).map((path) => relative(DOCS_DIR, path).replaceAll("\\", "/")).sort();

let changed = false;
for (const relPath of docs) {
  const absolute = join(DOCS_DIR, relPath);
  const before = readFileSync(absolute, "utf8");
  const after = ensureReviewedTag(before);
  if (after !== before) {
    changed = true;
    if (apply) writeFileSync(absolute, after.trimEnd() + "\n", "utf8");
  }
}

const indexPath = join(DOCS_DIR, "index.md");
const indexBefore = readFileSync(indexPath, "utf8");
const inventory = docs.filter((path) => path !== "index.md").map((path) => `- \`${path}\``).join("\n");
let indexAfter = indexBefore;

if (indexBefore.includes(startMarker) && indexBefore.includes(endMarker)) {
  indexAfter = indexBefore.replace(new RegExp(`${startMarker}[\\s\\S]*?${endMarker}`), `${startMarker}\n${inventory}\n${endMarker}`);
} else {
  indexAfter = indexBefore.trimEnd() + `\n\n## Document Inventory\n${startMarker}\n${inventory}\n${endMarker}\n`;
}

if (indexAfter !== indexBefore) {
  changed = true;
  if (apply) writeFileSync(indexPath, indexAfter.trimEnd() + "\n", "utf8");
}

if (!apply) {
  if (changed) {
    console.error("Doc-garden check found drift. Run: node scripts/doc-garden.mjs --apply");
    process.exit(1);
  }
  console.log("Doc-garden check passed.");
  process.exit(0);
}

if (changed) {
  console.log("Doc-garden applied updates.");
} else {
  console.log("Doc-garden found nothing to update.");
}
