interface CronFieldSpec {
  min: number;
  max: number;
  normalize?: (value: number) => number;
}

interface ParsedCronField {
  values: Set<number>;
  wildcard: boolean;
}

interface ZonedDateParts {
  year: number;
  month: number;
  dayOfMonth: number;
  hour: number;
  minute: number;
  dayOfWeek: number;
}

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

const weekdayMap: Record<string, number> = {
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6
};

const formatterCache = new Map<string, Intl.DateTimeFormat>();

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

function parseField(value: string, spec: CronFieldSpec): { ok: true; field: ParsedCronField } | { ok: false; error: string } {
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

function getFormatter(timeZone: string): Intl.DateTimeFormat | null {
  const normalized = timeZone.trim();
  if (normalized.length === 0) {
    return null;
  }

  if (formatterCache.has(normalized)) {
    return formatterCache.get(normalized) ?? null;
  }

  try {
    const formatter = new Intl.DateTimeFormat("en-US", {
      timeZone: normalized,
      weekday: "short",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23"
    });
    formatterCache.set(normalized, formatter);
    return formatter;
  } catch {
    return null;
  }
}

function getZonedDateParts(date: Date, timeZone: string): ZonedDateParts | null {
  const formatter = getFormatter(timeZone);
  if (!formatter) {
    return null;
  }

  const parts = formatter.formatToParts(date);
  let year: number | null = null;
  let month: number | null = null;
  let dayOfMonth: number | null = null;
  let hour: number | null = null;
  let minute: number | null = null;
  let dayOfWeek: number | null = null;

  for (const part of parts) {
    if (part.type === "year") {
      year = Number.parseInt(part.value, 10);
    } else if (part.type === "month") {
      month = Number.parseInt(part.value, 10);
    } else if (part.type === "day") {
      dayOfMonth = Number.parseInt(part.value, 10);
    } else if (part.type === "hour") {
      hour = Number.parseInt(part.value, 10);
    } else if (part.type === "minute") {
      minute = Number.parseInt(part.value, 10);
    } else if (part.type === "weekday") {
      dayOfWeek = weekdayMap[part.value] ?? null;
    }
  }

  if (
    year === null ||
    month === null ||
    dayOfMonth === null ||
    hour === null ||
    minute === null ||
    dayOfWeek === null ||
    !Number.isFinite(year) ||
    !Number.isFinite(month) ||
    !Number.isFinite(dayOfMonth) ||
    !Number.isFinite(hour) ||
    !Number.isFinite(minute)
  ) {
    return null;
  }

  return {
    year,
    month,
    dayOfMonth,
    hour,
    minute,
    dayOfWeek
  };
}

function pad2(value: number): string {
  return String(value).padStart(2, "0");
}

export function parseCronExpression(input: string): CronParseResult {
  const normalized = input.trim();
  const fields = normalized.split(/\s+/).filter((entry) => entry.length > 0);
  if (fields.length !== 5) {
    return {
      ok: false,
      error: "Cron must have exactly 5 fields: minute hour day-of-month month day-of-week"
    };
  }

  const minute = parseField(fields[0], minuteSpec);
  if (!minute.ok) {
    return { ok: false, error: `Invalid minute field: ${minute.error}` };
  }

  const hour = parseField(fields[1], hourSpec);
  if (!hour.ok) {
    return { ok: false, error: `Invalid hour field: ${hour.error}` };
  }

  const dayOfMonth = parseField(fields[2], dayOfMonthSpec);
  if (!dayOfMonth.ok) {
    return { ok: false, error: `Invalid day-of-month field: ${dayOfMonth.error}` };
  }

  const month = parseField(fields[3], monthSpec);
  if (!month.ok) {
    return { ok: false, error: `Invalid month field: ${month.error}` };
  }

  const dayOfWeek = parseField(fields[4], dayOfWeekSpec);
  if (!dayOfWeek.ok) {
    return { ok: false, error: `Invalid day-of-week field: ${dayOfWeek.error}` };
  }

  return {
    ok: true,
    expression: {
      raw: normalized,
      minute: minute.field,
      hour: hour.field,
      dayOfMonth: dayOfMonth.field,
      month: month.field,
      dayOfWeek: dayOfWeek.field
    }
  };
}

export function isValidTimeZone(timeZone: string): boolean {
  return getFormatter(timeZone) !== null;
}

export function getZonedMinuteKey(date: Date, timeZone: string): string | null {
  const parts = getZonedDateParts(date, timeZone);
  if (!parts) {
    return null;
  }

  return `${parts.year}-${pad2(parts.month)}-${pad2(parts.dayOfMonth)}T${pad2(parts.hour)}:${pad2(parts.minute)}`;
}

export function matchesCronExpression(expression: CronExpression, date: Date, timeZone: string): boolean | null {
  const parts = getZonedDateParts(date, timeZone);
  if (!parts) {
    return null;
  }

  const minuteMatches = expression.minute.values.has(parts.minute);
  const hourMatches = expression.hour.values.has(parts.hour);
  const monthMatches = expression.month.values.has(parts.month);
  const dayOfMonthMatches = expression.dayOfMonth.values.has(parts.dayOfMonth);
  const dayOfWeekMatches = expression.dayOfWeek.values.has(parts.dayOfWeek);

  const dayMatches =
    expression.dayOfMonth.wildcard && expression.dayOfWeek.wildcard
      ? true
      : expression.dayOfMonth.wildcard
        ? dayOfWeekMatches
        : expression.dayOfWeek.wildcard
          ? dayOfMonthMatches
          : dayOfMonthMatches || dayOfWeekMatches;

  return minuteMatches && hourMatches && monthMatches && dayMatches;
}
