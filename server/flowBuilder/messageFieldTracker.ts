type TrackerState = "scanning" | "awaiting_value_quote" | "in_value" | "done";

export class MessageFieldTracker {
  private state: TrackerState = "scanning";
  private depth = 0;
  private inString = false;
  private stringEscape = false;
  private currentString = "";
  private lastKeyAtDepth1 = "";
  private expectingValue = false;
  private valueEscapeNext = false;
  private readonly onDelta: (delta: string) => void;

  constructor(onDelta: (delta: string) => void) {
    this.onDelta = onDelta;
  }

  push(delta: string): void {
    let i = 0;
    while (i < delta.length) {
      if (this.state === "done") {
        return;
      }

      if (this.state === "in_value") {
        i = this.consumeValue(delta, i);
        continue;
      }

      this.processScanChar(delta[i]);
      i++;
    }
  }

  private processScanChar(ch: string): void {
    if (this.state === "awaiting_value_quote") {
      if (ch === " " || ch === "\t" || ch === "\n" || ch === "\r") {
        return;
      }
      if (ch === '"') {
        this.state = "in_value";
        return;
      }
      this.state = "scanning";
    }

    if (this.inString) {
      if (this.stringEscape) {
        this.stringEscape = false;
        this.currentString += ch;
        return;
      }
      if (ch === "\\") {
        this.stringEscape = true;
        return;
      }
      if (ch === '"') {
        this.inString = false;
        if (this.depth === 1 && !this.expectingValue) {
          this.lastKeyAtDepth1 = this.currentString;
        }
        this.currentString = "";
        return;
      }
      this.currentString += ch;
      return;
    }

    if (ch === '"') {
      this.inString = true;
      this.currentString = "";
      this.stringEscape = false;
      return;
    }

    if (ch === ":" && this.depth === 1) {
      this.expectingValue = true;
      if (this.lastKeyAtDepth1 === "message") {
        this.state = "awaiting_value_quote";
      }
      return;
    }

    if (ch === "," && this.depth === 1) {
      this.expectingValue = false;
      this.lastKeyAtDepth1 = "";
      return;
    }

    if (ch === "{" || ch === "[") {
      this.depth++;
      return;
    }

    if (ch === "}" || ch === "]") {
      if (this.depth === 1) {
        this.expectingValue = false;
        this.lastKeyAtDepth1 = "";
      }
      this.depth--;
    }
  }

  private consumeValue(chunk: string, startIndex: number): number {
    let emitted = "";
    let i = startIndex;

    for (; i < chunk.length; i++) {
      if (this.state === "done") {
        break;
      }

      const ch = chunk[i];

      if (this.valueEscapeNext) {
        this.valueEscapeNext = false;
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
          const hex = chunk.slice(i + 1, i + 5);
          if (hex.length === 4 && /^[0-9a-fA-F]{4}$/.test(hex)) {
            emitted += String.fromCharCode(parseInt(hex, 16));
            i += 4;
          } else {
            emitted += "\\u";
          }
        } else {
          emitted += ch;
        }
        continue;
      }

      if (ch === "\\") {
        this.valueEscapeNext = true;
        continue;
      }

      if (ch === '"') {
        this.state = "done";
        i++;
        break;
      }

      emitted += ch;
    }

    if (emitted.length > 0) {
      this.onDelta(emitted);
    }

    return i;
  }

  get isDone(): boolean {
    return this.state === "done";
  }

  reset(): void {
    this.state = "scanning";
    this.depth = 0;
    this.inString = false;
    this.stringEscape = false;
    this.currentString = "";
    this.lastKeyAtDepth1 = "";
    this.expectingValue = false;
    this.valueEscapeNext = false;
  }
}
