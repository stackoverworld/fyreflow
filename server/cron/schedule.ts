interface CronFieldSpec {
  min: number;
  max: number;
  normalize?: (value: number) => number;
}

interface ParsedCronField {
  values: Set<number>;
  wildcard: boolean;
}

type CronFieldKey = "minute" | "hour" | "dayOfMonth" | "month" | "dayOfWeek";

interface CronFieldDefinition {
  key: CronFieldKey;
  label: string;
  spec: CronFieldSpec;
}

type CronFieldParseResult = { ok: true; field: ParsedCronField } | { ok: false; error: string };
type CronFieldsParseResult =
  | { ok: true; fields: ParsedCronFields }
  | { ok: false; error: string };

interface ParsedCronFields {
  minute: ParsedCronField;
  hour: ParsedCronField;
  dayOfMonth: ParsedCronField;
  month: ParsedCronField;
  dayOfWeek: ParsedCronField;
}

import { getFormatter } from "./serialization.js";

export interface CronExpression {
  raw: string;
  minute: ParsedCronField;
  hour: ParsedCronField;
  dayOfMonth: ParsedCronField;
  month: ParsedCronField;
  dayOfWeek: ParsedCronField;
}

export type CronParseResult =
  | {
      ok: true;
      expression: CronExpression;
    }
  | {
      ok: false;
      error: string;
    };

const minuteSpec: CronFieldSpec = { min: 0, max: 59 };
const hourSpec: CronFieldSpec = { min: 0, max: 23 };
const dayOfMonthSpec: CronFieldSpec = { min: 1, max: 31 };
const monthSpec: CronFieldSpec = { min: 1, max: 12 };
const dayOfWeekSpec: CronFieldSpec = {
  min: 0,
  max: 7,
  normalize: (value) => (value === 7 ? 0 : value)
};

const cronFieldDefinitions: readonly CronFieldDefinition[] = [
  { key: "minute", label: "minute", spec: minuteSpec },
  { key: "hour", label: "hour", spec: hourSpec },
  { key: "dayOfMonth", label: "day-of-month", spec: dayOfMonthSpec },
  { key: "month", label: "month", spec: monthSpec },
  { key: "dayOfWeek", label: "day-of-week", spec: dayOfWeekSpec }
];

function parseIntToken(value: string): number | null {
  if (!/^\d+$/.test(value)) {
    return null;
  }

  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : null;
}

function buildAllValues(spec: CronFieldSpec): Set<number> {
  const values = new Set<number>();
  for (let current = spec.min; current <= spec.max; current += 1) {
    values.add(spec.normalize ? spec.normalize(current) : current);
  }
  return values;
}

function addRangeValues(
  output: Set<number>,
  start: number,
  end: number,
  step: number,
  spec: CronFieldSpec
): string | null {
  if (start < spec.min || start > spec.max || end < spec.min || end > spec.max) {
    return `out of range (${spec.min}-${spec.max})`;
  }
  if (start > end) {
    return "range start must be <= range end";
  }
  if (!Number.isFinite(step) || step <= 0) {
    return "step must be a positive integer";
  }

  for (let value = start; value <= end; value += step) {
    output.add(spec.normalize ? spec.normalize(value) : value);
  }

  return null;
}

function parseField(value: string, spec: CronFieldSpec): CronFieldParseResult {
  const token = value.trim();
  if (token.length === 0) {
    return { ok: false, error: "field is empty" };
  }

  const allValues = buildAllValues(spec);
  const values = new Set<number>();
  const segments = token.split(",");

  for (const rawSegment of segments) {
    const segment = rawSegment.trim();
    if (segment.length === 0) {
      return { ok: false, error: "contains an empty list segment" };
    }

    const slashParts = segment.split("/");
    if (slashParts.length > 2) {
      return { ok: false, error: `invalid step syntax "${segment}"` };
    }

    const rangeToken = slashParts[0].trim();
    const step = slashParts.length === 2 ? parseIntToken(slashParts[1].trim()) : 1;
    if (step === null || step <= 0) {
      return { ok: false, error: `invalid step "${slashParts[1] ?? ""}"` };
    }

    if (rangeToken === "*") {
      const rangeError = addRangeValues(values, spec.min, spec.max, step, spec);
      if (rangeError) {
        return { ok: false, error: rangeError };
      }
      continue;
    }

    if (rangeToken.includes("-")) {
      const [startToken, endToken, ...extra] = rangeToken.split("-");
      if (extra.length > 0) {
        return { ok: false, error: `invalid range "${rangeToken}"` };
      }

      const start = parseIntToken(startToken.trim());
      const end = parseIntToken(endToken.trim());
      if (start === null || end === null) {
        return { ok: false, error: `invalid range "${rangeToken}"` };
      }

      const rangeError = addRangeValues(values, start, end, step, spec);
      if (rangeError) {
        return { ok: false, error: rangeError };
      }
      continue;
    }

    const point = parseIntToken(rangeToken);
    if (point === null) {
      return { ok: false, error: `invalid token "${rangeToken}"` };
    }

    const pointError = addRangeValues(values, point, point, step, spec);
    if (pointError) {
      return { ok: false, error: pointError };
    }
  }

  if (values.size === 0) {
    return { ok: false, error: "field produced no values" };
  }

  const wildcard = allValues.size === values.size && [...allValues].every((entry) => values.has(entry));
  return {
    ok: true,
    field: {
      values,
      wildcard
    }
  };
}

function parseCronFields(rawFields: string): CronFieldsParseResult {
  const fieldValues = rawFields.split(/\s+/).filter((entry) => entry.length > 0);
  if (fieldValues.length !== cronFieldDefinitions.length) {
    return { ok: false, error: "Cron must have exactly 5 fields: minute hour day-of-month month day-of-week" };
  }

  const parsed: Partial<ParsedCronFields> = {};

  for (const [index, definition] of cronFieldDefinitions.entries()) {
    const parsedField = parseField(fieldValues[index], definition.spec);
    if (!parsedField.ok) {
      return { ok: false, error: `Invalid ${definition.label} field: ${parsedField.error}` };
    }
    parsed[definition.key] = parsedField.field;
  }

  if (!parsed.minute || !parsed.hour || !parsed.dayOfMonth || !parsed.month || !parsed.dayOfWeek) {
    return { ok: false, error: "Cron must have exactly 5 fields: minute hour day-of-month month day-of-week" };
  }

  return {
    ok: true,
    fields: {
      minute: parsed.minute,
      hour: parsed.hour,
      dayOfMonth: parsed.dayOfMonth,
      month: parsed.month,
      dayOfWeek: parsed.dayOfWeek
    }
  };
}

export function parseCronExpression(input: string): CronParseResult {
  const normalized = input.trim();
  const parsedFields = parseCronFields(normalized);
  if (!parsedFields.ok) {
    return { ok: false, error: parsedFields.error };
  }

  return {
    ok: true,
    expression: {
      raw: normalized,
      minute: parsedFields.fields.minute,
      hour: parsedFields.fields.hour,
      dayOfMonth: parsedFields.fields.dayOfMonth,
      month: parsedFields.fields.month,
      dayOfWeek: parsedFields.fields.dayOfWeek
    }
  };
}

export function isValidTimeZone(timeZone: string): boolean {
  return getFormatter(timeZone) !== null;
}
