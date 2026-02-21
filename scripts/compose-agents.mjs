import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const root = process.cwd();
const fragmentsDir = resolve(root, ".agents/fragments/root");
const outputPath = resolve(root, "AGENTS.md");
const args = new Set(process.argv.slice(2));
const checkOnly = args.has("--check");
const writeMode = args.has("--write") || !checkOnly;

const files = readdirSync(fragmentsDir)
  .filter((name) => name.endsWith(".md"))
  .sort((a, b) => a.localeCompare(b));

if (!files.length) {
  console.error("No AGENTS fragments found in .agents/fragments/root");
  process.exit(1);
}

const composed = files.map((file) => readFileSync(join(fragmentsDir, file), "utf8").trimEnd()).join("\n\n").trimEnd() + "\n";
const current = readFileSync(outputPath, "utf8");

if (checkOnly) {
  if (current !== composed) {
    console.error("AGENTS.md is out of sync with fragments. Run: node scripts/compose-agents.mjs --write");
    process.exit(1);
  }
  console.log("AGENTS.md composition check passed.");
  process.exit(0);
}

if (writeMode) {
  writeFileSync(outputPath, composed, "utf8");
  console.log("AGENTS.md composed from fragments.");
}
