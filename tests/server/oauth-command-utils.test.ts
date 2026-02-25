import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { isCommandAvailable, launchDetachedAndCapture } from "../../server/oauth/commandUtils.js";
import { extractFirstAuthUrl } from "../../server/oauth/loginOutputParser.js";

const tempDirs: string[] = [];
const LOGIN_URL_PATTERN = /\/login(?:\/|\?|#|$)/i;

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

describe("OAuth command capture", () => {
  it(
    "keeps polling until a non-login auth url is captured",
    async () => {
      const script = [
        "console.log('Start here: https://claude.ai/login');",
        "setTimeout(() => console.log('Authorize app: https://claude.ai/oauth/authorize?client_id=test-client'), 1200);",
        "setTimeout(() => process.exit(0), 1800);"
      ].join(" ");

      const captureResult = await launchDetachedAndCapture(process.execPath, ["-e", script], {
        captureTimeoutMs: 6_000,
        pollIntervalMs: 80,
        settleTimeMs: 300,
        isOutputSufficient: (capturedOutput) => {
          const authUrl = extractFirstAuthUrl(capturedOutput);
          return typeof authUrl === "string" && !LOGIN_URL_PATTERN.test(authUrl);
        }
      });

      expect(extractFirstAuthUrl(captureResult.capturedOutput)).toBe(
        "https://claude.ai/oauth/authorize?client_id=test-client"
      );
    },
    15_000
  );
});
