/**
 * Patches Electron.app for local development branding.
 * - App name in menu bar / dock
 * - Custom executable alias so macOS labels the app as FyreFlow
 * - Custom dock icon (legacy electron.icns path)
 * - Ad-hoc re-sign after plist/resources edits
 */

import { execFileSync } from "node:child_process";
import { copyFileSync, existsSync, lstatSync, unlinkSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = join(__dirname, "..");
const electronDistDir = join(rootDir, "node_modules", "electron", "dist");
const electronAppPath = join(rootDir, "node_modules", "electron", "dist", "Electron.app");
const fyreFlowAppAliasPath = join(electronDistDir, "FyreFlow.app");
const electronAppContents = join(electronAppPath, "Contents");
const plist = join(electronAppContents, "Info.plist");
const macOSDir = join(electronAppContents, "MacOS");
const electronExecutable = join(macOSDir, "Electron");
const fyreFlowExecutable = join(macOSDir, "FyreFlow");
const resourcesDir = join(electronAppContents, "Resources");
const electronIcns = join(resourcesDir, "electron.icns");
const customIcns = join(rootDir, "electron", "icon.icns");
const APP_NAME = "FyreFlow";
const APP_BUNDLE_IDENTIFIER = "com.fyreflow.desktop.dev";
const APP_EXECUTABLE = "FyreFlow";

if (process.platform !== "darwin" || !existsSync(plist)) {
  process.exit(0);
}

function plistUpsertString(key, value) {
  try {
    execFileSync("/usr/libexec/PlistBuddy", ["-c", `Set :${key} ${value}`, plist], { stdio: "ignore" });
  } catch {
    execFileSync("/usr/libexec/PlistBuddy", ["-c", `Add :${key} string ${value}`, plist], { stdio: "ignore" });
  }
}

function plistDelete(key) {
  try {
    execFileSync("/usr/libexec/PlistBuddy", ["-c", `Delete :${key}`, plist], { stdio: "ignore" });
  } catch {
    // Key does not exist.
  }
}

function ensureExecutableAlias() {
  if (!existsSync(electronExecutable)) {
    return false;
  }

  if (existsSync(fyreFlowExecutable) && lstatSync(fyreFlowExecutable).isSymbolicLink()) {
    unlinkSync(fyreFlowExecutable);
  }

  copyFileSync(electronExecutable, fyreFlowExecutable);
  return true;
}

function ensureAppBundleAlias() {
  if (!existsSync(electronAppPath)) {
    return;
  }

  if (existsSync(fyreFlowAppAliasPath) && lstatSync(fyreFlowAppAliasPath).isSymbolicLink()) {
    unlinkSync(fyreFlowAppAliasPath);
  }

  if (!existsSync(fyreFlowAppAliasPath)) {
    try {
      execFileSync("ln", ["-s", "Electron.app", fyreFlowAppAliasPath], { stdio: "ignore" });
    } catch {
      // Non-fatal: launcher can still fall back to Electron.app.
    }
  }
}

try {
  const hasAliasExecutable = ensureExecutableAlias();

  plistUpsertString("CFBundleName", APP_NAME);
  plistUpsertString("CFBundleDisplayName", APP_NAME);
  plistUpsertString("CFBundleIdentifier", APP_BUNDLE_IDENTIFIER);
  plistUpsertString("CFBundleExecutable", hasAliasExecutable ? APP_EXECUTABLE : "Electron");

  if (existsSync(customIcns)) {
    copyFileSync(customIcns, electronIcns);
  }

  // Use legacy key for Electron dev bundle and clear modern key that can point at missing assets.
  plistDelete("CFBundleIconName");
  plistUpsertString("CFBundleIconFile", "electron");
  ensureAppBundleAlias();

  execFileSync("codesign", ["--force", "--deep", "--sign", "-", electronAppPath], { stdio: "ignore" });
  console.log(`Patched Electron.app plist + icon → "${APP_NAME}"`);
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.warn("Could not patch Electron plist:", message);
}
