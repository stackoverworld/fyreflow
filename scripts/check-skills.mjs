import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";

const ROOT = process.cwd();
const SKILLS_DIR = resolve(ROOT, "skills");
const REQUIRED_FILES = ["SKILL.md", "tests/trigger-cases.md"];

if (!existsSync(SKILLS_DIR)) {
  console.error("Missing skills directory.");
  process.exit(1);
}

const skillDirs = readdirSync(SKILLS_DIR, { withFileTypes: true })
  .filter((entry) => entry.isDirectory() && !entry.name.startsWith("."))
  .map((entry) => entry.name);

const errors = [];
const warnings = [];

function countBullets(section) {
  return section
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.startsWith("- ")).length;
}

for (const skill of skillDirs) {
  const skillPath = join(SKILLS_DIR, skill);
  for (const required of REQUIRED_FILES) {
    const full = join(skillPath, required);
    if (!existsSync(full)) errors.push(`Skill '${skill}' missing ${required}`);
  }

  const skillFile = join(skillPath, "SKILL.md");
  const triggerFile = join(skillPath, "tests/trigger-cases.md");

  if (existsSync(skillFile)) {
    const content = readFileSync(skillFile, "utf8");
    if (!/##\s*Trigger/i.test(content)) {
      errors.push(`Skill '${skill}' SKILL.md must contain a '## Trigger' section.`);
    }
    if (!/##\s*Workflow/i.test(content)) {
      errors.push(`Skill '${skill}' SKILL.md must contain a '## Workflow' section.`);
    }
    if (!/\n\s*1\.\s+/m.test(content)) {
      warnings.push(`Skill '${skill}' workflow has no numbered steps.`);
    }
    const lineCount = content.split("\n").length;
    if (lineCount > 220) {
      warnings.push(`Skill '${skill}' is long (${lineCount} lines). Consider splitting for progressive disclosure.`);
    }
  }

  if (existsSync(triggerFile)) {
    const content = readFileSync(triggerFile, "utf8");
    const triggerMatch = content.match(/##\s*Should trigger([\s\S]*?)(##\s*Should NOT trigger|$)/i);
    const notTriggerMatch = content.match(/##\s*Should NOT trigger([\s\S]*)$/i);
    if (!triggerMatch) {
      errors.push(`Skill '${skill}' tests/trigger-cases.md missing '## Should trigger' section.`);
    }
    if (!notTriggerMatch) {
      errors.push(`Skill '${skill}' tests/trigger-cases.md missing '## Should NOT trigger' section.`);
    }
    if (triggerMatch && countBullets(triggerMatch[1] || "") < 2) {
      errors.push(`Skill '${skill}' should include at least 2 positive trigger examples.`);
    }
    if (notTriggerMatch && countBullets(notTriggerMatch[1] || "") < 2) {
      errors.push(`Skill '${skill}' should include at least 2 negative trigger examples.`);
    }
  }
}

if (!skillDirs.length) {
  errors.push("No skill directories found. Add at least one curated skill.");
}

if (warnings.length) {
  for (const warning of warnings) console.warn(`[warn] ${warning}`);
}

if (errors.length) {
  for (const error of errors) console.error(`[error] ${error}`);
  process.exit(1);
}

console.log(`Skill checks passed (${skillDirs.length} skills).`);
