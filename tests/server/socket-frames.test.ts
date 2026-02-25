import { describe, expect, it } from "vitest";

import { encodeSocketFrame, tryDecodeSocketFrame } from "../../server/realtime/socketFrames.js";

function maskFrameForClient(frame: Buffer): Buffer {
  const firstByte = frame[0];
  const secondByte = frame[1];
  const payloadLengthFlag = secondByte & 0x7f;
  const headerLength = payloadLengthFlag < 126 ? 2 : payloadLengthFlag === 126 ? 4 : 10;
  const payload = frame.subarray(headerLength);
  const mask = Buffer.from([0x11, 0x22, 0x33, 0x44]);
  const maskedPayload = Buffer.allocUnsafe(payload.length);
  for (let index = 0; index < payload.length; index += 1) {
    maskedPayload[index] = payload[index] ^ mask[index % 4];
  }

  const secondMaskedByte = secondByte | 0x80;
  if (payloadLengthFlag < 126) {
    return Buffer.concat([Buffer.from([firstByte, secondMaskedByte]), mask, maskedPayload]);
  }
  if (payloadLengthFlag === 126) {
    const rebuilt = Buffer.concat([frame.subarray(0, 2), frame.subarray(2, 4), mask, maskedPayload]);
    rebuilt[1] = secondMaskedByte;
    return rebuilt;
  }

  const rebuilt = Buffer.concat([frame.subarray(0, 2), frame.subarray(2, 10), mask, maskedPayload]);
  rebuilt[1] = secondMaskedByte;
  return rebuilt;
}

describe("socket frames", () => {
  it("encodes and decodes text payloads", () => {
    const payload = Buffer.from(JSON.stringify({ type: "ping" }), "utf8");
    const serverFrame = encodeSocketFrame(payload, 0x1);
    const clientFrame = maskFrameForClient(serverFrame);
    const decoded = tryDecodeSocketFrame(clientFrame);

    expect(decoded).not.toBeNull();
    expect(decoded?.opcode).toBe(0x1);
    expect(decoded?.fin).toBe(true);
    expect(decoded?.payload.toString("utf8")).toBe(payload.toString("utf8"));
  });

  it("returns null for incomplete frames", () => {
    const payload = Buffer.from("partial", "utf8");
    const frame = maskFrameForClient(encodeSocketFrame(payload));
    const partial = frame.subarray(0, frame.length - 2);
    expect(tryDecodeSocketFrame(partial)).toBeNull();
  });
});
