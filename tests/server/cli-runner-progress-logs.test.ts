import { describe, expect, it } from "vitest";
import {
  compactProcessSnapshot,
  extractStreamJsonCommandHints,
  extractStreamJsonSummaryHints,
  formatCliCommandStartLog,
  formatCliRunningLog
} from "../../server/providers/clientFactory/cliRunner.js";

describe("CLI runner progress logging", () => {
  it("compacts process snapshot output for single-line logs", () => {
    const raw = '  1234   1   S   00:10   12.5   3.1   1024   2048   "/usr/local/bin/claude"  \n';
    const compact = compactProcessSnapshot(raw);
    expect(compact).toBe("1234 1 S 00:10 12.5 3.1 1024 2048 '/usr/local/bin/claude'");
  });

  it("formats running log with idle and process details", () => {
    const logLine = formatCliRunningLog({
      command: "/usr/local/bin/claude",
      elapsedMs: 30_000,
      stdoutChars: 0,
      stderrChars: 0,
      idleMs: 30_000,
      pid: 1234,
      processSnapshot: "1234 1 S 00:30 98.0 4.2 20000 120000 claude"
    });

    expect(logLine).toContain("CLI command running: /usr/local/bin/claude");
    expect(logLine).toContain("idle=30000ms");
    expect(logLine).toContain("pid=1234");
    expect(logLine).toContain('process="1234 1 S 00:30 98.0 4.2 20000 120000 claude"');
  });

  it("formats start log with command preview, cwd, and timeout", () => {
    const logLine = formatCliCommandStartLog({
      command: "/usr/local/bin/claude",
      args: [
        "--print",
        "--output-format",
        "stream-json",
        "--json-schema",
        "{\"type\":\"object\",\"properties\":{\"workflow_status\":{\"type\":\"string\"}}}",
        "very long prompt that should be hidden"
      ],
      cwd: "/Users/moiseencov/Downloads/Projects/agents-dashboard",
      timeoutMs: 420000
    });

    expect(logLine).toContain("CLI command started: /usr/local/bin/claude");
    expect(logLine).toContain("<prompt>");
    expect(logLine).toContain("cwd=/Users/moiseencov/Downloads/Projects/agents-dashboard");
    expect(logLine).toContain("timeout=420000ms");
  });

  it("extracts model tool commands from stream-json payload lines", () => {
    const line = JSON.stringify({
      type: "tool_use",
      name: "Bash",
      arguments: {
        command: "cd pdf-folder && ls -la",
        cwd: "/Users/moiseencov/Downloads/Projects/agents-dashboard"
      }
    });

    const hints = extractStreamJsonCommandHints(line);
    expect(hints).toHaveLength(1);
    expect(hints[0]).toMatchObject({
      tool: "Bash",
      command: "cd pdf-folder && ls -la",
      cwd: "/Users/moiseencov/Downloads/Projects/agents-dashboard"
    });
  });

  it("extracts file actions for read/write style tools", () => {
    const line = JSON.stringify({
      type: "tool_use",
      name: "Write",
      arguments: {
        file_path: "/tmp/investor-deck.html"
      }
    });

    const hints = extractStreamJsonCommandHints(line);
    expect(hints).toHaveLength(1);
    expect(hints[0]).toMatchObject({
      tool: "Write",
      command: "write /tmp/investor-deck.html"
    });
  });

  it("extracts bash command from xml-like tool payload text", () => {
    const line = JSON.stringify({
      result:
        "<tool_call><tool_name>Bash</tool_name><parameter name=\"command\">cd pdf-folder && ls -la</parameter></tool_call>"
    });

    const hints = extractStreamJsonCommandHints(line);
    expect(hints).toHaveLength(1);
    expect(hints[0]).toMatchObject({
      tool: "Bash",
      command: "cd pdf-folder && ls -la"
    });
  });

  it("extracts command from stringified tool input payload", () => {
    const line = JSON.stringify({
      type: "tool_use",
      name: "Bash",
      tool_input: '{"command":"cd output && ls -la","cwd":"/tmp/workdir"}'
    });

    const hints = extractStreamJsonCommandHints(line);
    expect(hints).toHaveLength(1);
    expect(hints[0]).toMatchObject({
      tool: "Bash",
      command: "cd output && ls -la",
      cwd: "/tmp/workdir"
    });
  });

  it("extracts model summary hints from structured payload", () => {
    const line = JSON.stringify({
      type: "result",
      structured_output: {
        workflow_status: "PASS",
        next_action: "continue",
        summary: "Updated all deck slides with source.pdf content and preserved UIKit design."
      }
    });

    const hints = extractStreamJsonSummaryHints(line);
    expect(hints.some((entry) => entry.summary.includes("Updated all deck slides"))).toBe(true);
    expect(hints.some((entry) => entry.summary.includes("workflow=PASS"))).toBe(true);
  });
});
