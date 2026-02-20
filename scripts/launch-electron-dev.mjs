import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.join(__dirname, "..");

function resolveElectronBinary() {
  if (process.platform === "darwin") {
    const candidates = [
      path.join(rootDir, "node_modules", "electron", "dist", "FyreFlow.app", "Contents", "MacOS", "FyreFlow"),
      path.join(rootDir, "node_modules", "electron", "dist", "FyreFlow.app", "Contents", "MacOS", "Electron"),
      path.join(rootDir, "node_modules", "electron", "dist", "Electron.app", "Contents", "MacOS", "FyreFlow"),
      path.join(rootDir, "node_modules", "electron", "dist", "Electron.app", "Contents", "MacOS", "Electron")
    ];
    return candidates.find((candidate) => existsSync(candidate)) ?? null;
  }

  const localElectron = path.join(rootDir, "node_modules", ".bin", "electron");
  if (existsSync(localElectron)) {
    return localElectron;
  }
  return null;
}

const binary = resolveElectronBinary();
if (!binary) {
  console.error("Could not locate Electron binary. Run bun install and try again.");
  process.exit(1);
}

console.log(`[electron-launch] Using binary: ${binary}`);

const child = spawn(binary, [rootDir], {
  cwd: rootDir,
  env: process.env,
  stdio: "inherit"
});

child.on("error", (error) => {
  console.error("Failed to launch Electron:", error);
  process.exit(1);
});

child.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }

  process.exit(code ?? 0);
});
