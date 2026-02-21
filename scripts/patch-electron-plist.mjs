import { execFileSync } from "node:child_process";
import { copyFileSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, rmSync, unlinkSync } from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = join(__dirname, "..");
const electronAppPath = join(rootDir, "node_modules", "electron", "dist", "Electron.app");
const electronAppContents = join(electronAppPath, "Contents");
const plist = join(electronAppContents, "Info.plist");
const macOSDir = join(electronAppContents, "MacOS");
const electronExecutable = join(macOSDir, "Electron");
const fyreFlowExecutable = join(macOSDir, "FyreFlow");
const resourcesDir = join(electronAppContents, "Resources");
const electronIcns = join(resourcesDir, "electron.icns");
const appIconIcns = join(resourcesDir, "AppIcon.icns");
const customIcns = join(rootDir, "electron", "icon.icns");
const customPng = join(rootDir, "electron", "icon.png");
const APP_NAME = "FyreFlow";
const APP_BUNDLE_IDENTIFIER = "com.fyreflow.desktop.dev";
const APP_EXECUTABLE = "FyreFlow";

if (process.platform !== "darwin" || !existsSync(plist)) {
  process.exit(0);
}

function plistUpsertString(key, value, plistPath = plist) {
  try {
    execFileSync("/usr/libexec/PlistBuddy", ["-c", `Set :${key} ${value}`, plistPath], { stdio: "ignore" });
  } catch {
    execFileSync("/usr/libexec/PlistBuddy", ["-c", `Add :${key} string ${value}`, plistPath], { stdio: "ignore" });
  }
}

function plistDelete(key, plistPath = plist) {
  try {
    execFileSync("/usr/libexec/PlistBuddy", ["-c", `Delete :${key}`, plistPath], { stdio: "ignore" });
  } catch {}
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

function removeLegacyAppBundleAlias() {
  const legacyAliasPath = join(rootDir, "node_modules", "electron", "dist", "FyreFlow.app");
  if (existsSync(legacyAliasPath) && lstatSync(legacyAliasPath).isSymbolicLink()) {
    unlinkSync(legacyAliasPath);
  }
}

function patchHelperBundles(iconSourcePath) {
  if (!iconSourcePath) {
    return;
  }

  const frameworksDir = join(electronAppContents, "Frameworks");
  if (!existsSync(frameworksDir)) {
    return;
  }

  const helperEntries = readdirSync(frameworksDir, { withFileTypes: true }).filter((entry) => {
    return entry.isDirectory() && /^Electron Helper(?: \((?:Renderer|GPU|Plugin)\))?\.app$/.test(entry.name);
  });

  for (const entry of helperEntries) {
    const helperAppPath = join(frameworksDir, entry.name);
    const helperContentsPath = join(helperAppPath, "Contents");
    const helperPlistPath = join(helperContentsPath, "Info.plist");
    const helperResourcesPath = join(helperContentsPath, "Resources");
    const helperDisplayName = entry.name.replace(/\.app$/, "");

    mkdirSync(helperResourcesPath, { recursive: true });
    copyFileSync(iconSourcePath, join(helperResourcesPath, "AppIcon.icns"));
    copyFileSync(iconSourcePath, join(helperResourcesPath, "electron.icns"));

    plistUpsertString("CFBundleIdentifier", "com.github.Electron.helper", helperPlistPath);
    plistUpsertString("CFBundleName", helperDisplayName, helperPlistPath);
    plistUpsertString("CFBundleDisplayName", helperDisplayName, helperPlistPath);
    plistDelete("CFBundleIconName", helperPlistPath);
    plistUpsertString("CFBundleIconFile", "AppIcon", helperPlistPath);
  }
}

function generateIcnsFromPng(pngPath) {
  if (!existsSync(pngPath)) {
    return null;
  }

  const tempRoot = mkdtempSync(join(tmpdir(), "fyreflow-icon-"));
  const iconsetDir = join(tempRoot, "FyreFlow.iconset");
  const outputIcnsPath = join(tmpdir(), `fyreflow-icon-${Date.now()}.icns`);

  try {
    mkdirSync(iconsetDir, { recursive: true });
    const iconsetTargets = [
      ["icon_16x16.png", 16],
      ["icon_16x16@2x.png", 32],
      ["icon_32x32.png", 32],
      ["icon_32x32@2x.png", 64],
      ["icon_128x128.png", 128],
      ["icon_128x128@2x.png", 256],
      ["icon_256x256.png", 256],
      ["icon_256x256@2x.png", 512],
      ["icon_512x512.png", 512],
      ["icon_512x512@2x.png", 1024]
    ];

    for (const [name, size] of iconsetTargets) {
      execFileSync("sips", ["-z", String(size), String(size), pngPath, "--out", join(iconsetDir, name)], {
        stdio: "ignore"
      });
    }

    execFileSync("iconutil", ["-c", "icns", iconsetDir, "-o", outputIcnsPath], { stdio: "ignore" });
    return outputIcnsPath;
  } catch {
    return null;
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
}

try {
  const hasAliasExecutable = ensureExecutableAlias();

  plistUpsertString("CFBundleName", APP_NAME);
  plistUpsertString("CFBundleDisplayName", APP_NAME);
  plistUpsertString("CFBundleIdentifier", APP_BUNDLE_IDENTIFIER);
  plistUpsertString("CFBundleExecutable", hasAliasExecutable ? APP_EXECUTABLE : "Electron");

  const generatedIcns = generateIcnsFromPng(customPng);
  const iconSourcePath = generatedIcns && existsSync(generatedIcns) ? generatedIcns : (existsSync(customIcns) ? customIcns : null);

  if (iconSourcePath) {
    copyFileSync(iconSourcePath, electronIcns);
    copyFileSync(iconSourcePath, appIconIcns);
    patchHelperBundles(iconSourcePath);
    if (generatedIcns && generatedIcns === iconSourcePath) {
      rmSync(generatedIcns, { force: true });
    }
  }

  plistDelete("CFBundleIconName");
  plistUpsertString("CFBundleIconFile", "AppIcon");
  removeLegacyAppBundleAlias();

  execFileSync("codesign", ["--force", "--deep", "--sign", "-", electronAppPath], { stdio: "ignore" });
  console.log(`Patched Electron.app plist + icon → "${APP_NAME}"`);
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.warn("Could not patch Electron plist:", message);
}
