import type { SmartRunFieldType } from "../types.js";

export interface MutableField {
  key: string;
  required: boolean;
  type?: SmartRunFieldType;
  description?: string;
  placeholder?: string;
  sources: Set<string>;
}
