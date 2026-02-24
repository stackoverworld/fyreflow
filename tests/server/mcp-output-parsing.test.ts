import { describe, expect, it } from "vitest";

import { parseMcpCallsFromOutput } from "../../server/runner/mcpOutput.js";

describe("parseMcpCallsFromOutput", () => {
  it("parses strict top-level JSON payload", () => {
    const calls = parseMcpCallsFromOutput(
      JSON.stringify({
        mcp_calls: [
          {
            server_id: "figma",
            tool: "export_frames",
            arguments: { fileKey: "abc" }
          }
        ]
      })
    );

    expect(calls).toHaveLength(1);
    expect(calls[0]).toEqual({
      serverId: "figma",
      tool: "export_frames",
      arguments: { fileKey: "abc" }
    });
  });

  it("rejects fenced JSON payloads", () => {
    const calls = parseMcpCallsFromOutput(
      [
        "```json",
        '{"mcp_calls":[{"server_id":"figma","tool":"export_frames","arguments":{}}]}',
        "```"
      ].join("\n")
    );

    expect(calls).toEqual([]);
  });

  it("rejects prose with embedded JSON object", () => {
    const calls = parseMcpCallsFromOutput(
      'Run this now: {"mcp_calls":[{"server_id":"figma","tool":"export_frames","arguments":{}}]}'
    );

    expect(calls).toEqual([]);
  });
});
