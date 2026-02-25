const MAX_FRAME_PAYLOAD_BYTES = 1024 * 1024;

export interface ParsedSocketFrame {
  opcode: number;
  fin: boolean;
  payload: Buffer;
  byteLength: number;
}

export function encodeSocketFrame(payload: Buffer, opcode = 0x1): Buffer {
  const length = payload.length;

  if (length < 126) {
    const frame = Buffer.allocUnsafe(2 + length);
    frame[0] = 0x80 | (opcode & 0x0f);
    frame[1] = length;
    payload.copy(frame, 2);
    return frame;
  }

  if (length <= 0xffff) {
    const frame = Buffer.allocUnsafe(4 + length);
    frame[0] = 0x80 | (opcode & 0x0f);
    frame[1] = 126;
    frame.writeUInt16BE(length, 2);
    payload.copy(frame, 4);
    return frame;
  }

  const frame = Buffer.allocUnsafe(10 + length);
  frame[0] = 0x80 | (opcode & 0x0f);
  frame[1] = 127;
  frame.writeUInt32BE(0, 2);
  frame.writeUInt32BE(length, 6);
  payload.copy(frame, 10);
  return frame;
}

export function tryDecodeSocketFrame(buffer: Buffer): ParsedSocketFrame | null {
  if (buffer.length < 2) {
    return null;
  }

  const firstByte = buffer[0];
  const secondByte = buffer[1];
  const fin = (firstByte & 0x80) !== 0;
  const opcode = firstByte & 0x0f;
  const masked = (secondByte & 0x80) !== 0;
  let payloadLength = secondByte & 0x7f;
  let offset = 2;

  if (payloadLength === 126) {
    if (buffer.length < offset + 2) {
      return null;
    }
    payloadLength = buffer.readUInt16BE(offset);
    offset += 2;
  } else if (payloadLength === 127) {
    if (buffer.length < offset + 8) {
      return null;
    }

    const upper = buffer.readUInt32BE(offset);
    const lower = buffer.readUInt32BE(offset + 4);
    if (upper !== 0) {
      throw new Error("WebSocket frame payload exceeds supported range.");
    }
    payloadLength = lower;
    offset += 8;
  }

  if (payloadLength > MAX_FRAME_PAYLOAD_BYTES) {
    throw new Error("WebSocket frame payload too large.");
  }

  const maskOffset = masked ? 4 : 0;
  const fullLength = offset + maskOffset + payloadLength;
  if (buffer.length < fullLength) {
    return null;
  }

  const payload = buffer.subarray(offset + maskOffset, fullLength);
  const decoded = Buffer.allocUnsafe(payloadLength);

  if (masked) {
    const mask = buffer.subarray(offset, offset + 4);
    for (let index = 0; index < payloadLength; index += 1) {
      decoded[index] = payload[index] ^ mask[index % 4];
    }
  } else {
    payload.copy(decoded);
  }

  return {
    opcode,
    fin,
    payload: decoded,
    byteLength: fullLength
  };
}
