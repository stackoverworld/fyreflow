import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { isCommandAvailable } from "../../server/oauth/commandUtils.js";

const tempDirs: string[] = [];

afterEach(async () => {
  while (tempDirs.length > 0) {
    const target = tempDirs.pop();
    if (!target) {
      continue;
    }
    await fs.rm(target, { recursive: true, force: true });
  }
});

describe("OAuth Command Utils", () => {
  it("detects a binary available in PATH", async () => {
    const shellCommand = process.platform === "win32" ? "cmd" : "sh";
    await expect(isCommandAvailable(shellCommand)).resolves.toBe(true);
  });

  it("detects an executable absolute path", async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "oauth-command-utils-"));
    tempDirs.push(tempDir);
    const scriptPath = path.join(tempDir, "mock-command.sh");
    await fs.writeFile(scriptPath, "#!/bin/sh\necho ok\n", "utf8");
    await fs.chmod(scriptPath, 0o755);

    await expect(isCommandAvailable(scriptPath)).resolves.toBe(true);
  });

  it("returns false for a non-executable path", async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "oauth-command-utils-"));
    tempDirs.push(tempDir);
    const scriptPath = path.join(tempDir, "not-executable.sh");
    await fs.writeFile(scriptPath, "#!/bin/sh\necho ok\n", "utf8");
    await fs.chmod(scriptPath, 0o644);

    await expect(isCommandAvailable(scriptPath)).resolves.toBe(false);
  });

  it("returns false for an unknown command", async () => {
    await expect(isCommandAvailable("command-that-should-not-exist-987654321")).resolves.toBe(false);
  });
});
