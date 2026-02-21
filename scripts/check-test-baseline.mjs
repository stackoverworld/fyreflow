#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();

const requiredSuites = [
  "tests/api/system-auth.test.ts",
  "tests/api/pipelines.test.ts",
  "tests/api/pipeline-runs.test.ts",
  "tests/api/runs-lifecycle.test.ts",
  "tests/server/secure-inputs.test.ts",
  "tests/e2e/critical-ai-regression.spec.ts"
];

const missing = requiredSuites.filter((relativePath) => {
  const absolutePath = path.resolve(root, relativePath);
  return !fs.existsSync(absolutePath);
});

if (missing.length > 0) {
  console.error("Test baseline check failed. Missing required regression suites:");
  for (const entry of missing) {
    console.error(`- ${entry}`);
  }
  process.exit(1);
}

const allTestFiles = requiredSuites.filter((relativePath) => {
  const absolutePath = path.resolve(root, relativePath);
  return fs.statSync(absolutePath).size > 0;
});

if (allTestFiles.length !== requiredSuites.length) {
  console.error("Test baseline check failed. One or more required suites are empty.");
  process.exit(1);
}

console.log("Test baseline check passed.");
