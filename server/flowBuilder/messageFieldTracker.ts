/**
 * State machine that extracts the `"message"` field value from a partial JSON stream.
 *
 * The model outputs structured JSON like `{"action":"answer","message":"...","draft":...}`.
 * This tracker watches the raw text deltas and emits only the unescaped content of the
 * `"message"` string value as it arrives, without waiting for the complete JSON.
 *
 * States: scanning -> in_value -> done
 */

type TrackerState = "scanning" | "in_value" | "done";

const MESSAGE_KEY_PATTERN = /"message"\s*:\s*"/;

export class MessageFieldTracker {
  private state: TrackerState = "scanning";
  private buffer = "";
  private escapeNext = false;
  private readonly onDelta: (delta: string) => void;

  constructor(onDelta: (delta: string) => void) {
    this.onDelta = onDelta;
  }

  push(delta: string): void {
    if (this.state === "done") {
      return;
    }

    if (this.state === "scanning") {
      this.buffer += delta;
      const match = MESSAGE_KEY_PATTERN.exec(this.buffer);
      if (!match) {
        // Keep only the tail that could still partially match
        if (this.buffer.length > 200) {
          this.buffer = this.buffer.slice(-50);
        }
        return;
      }

      // Found the start of the message value — switch to in_value
      const valueStart = match.index + match[0].length;
      const remainder = this.buffer.slice(valueStart);
      this.buffer = "";
      this.state = "in_value";

      if (remainder.length > 0) {
        this.consumeValue(remainder);
      }
      return;
    }

    // state === "in_value"
    this.consumeValue(delta);
  }

  private consumeValue(chunk: string): void {
    let emitted = "";

    for (let i = 0; i < chunk.length; i++) {
      if (this.state === "done") {
        break;
      }

      const ch = chunk[i];

      if (this.escapeNext) {
        this.escapeNext = false;
        if (ch === "n") {
          emitted += "\n";
        } else if (ch === "t") {
          emitted += "\t";
        } else if (ch === "r") {
          emitted += "\r";
        } else if (ch === '"') {
          emitted += '"';
        } else if (ch === "\\") {
          emitted += "\\";
        } else if (ch === "/") {
          emitted += "/";
        } else if (ch === "u") {
          // Unicode escape: \uXXXX
          const hex = chunk.slice(i + 1, i + 5);
          if (hex.length === 4 && /^[0-9a-fA-F]{4}$/.test(hex)) {
            emitted += String.fromCharCode(parseInt(hex, 16));
            i += 4;
          } else {
            emitted += "\\u";
          }
        } else {
          // Unknown escape — pass through
          emitted += ch;
        }
        continue;
      }

      if (ch === "\\") {
        this.escapeNext = true;
        continue;
      }

      if (ch === '"') {
        // Closing quote — value is complete
        this.state = "done";
        break;
      }

      emitted += ch;
    }

    if (emitted.length > 0) {
      this.onDelta(emitted);
    }
  }

  get isDone(): boolean {
    return this.state === "done";
  }

  reset(): void {
    this.state = "scanning";
    this.buffer = "";
    this.escapeNext = false;
  }
}
