interface ZonedDateParts {
  year: number;
  month: number;
  dayOfMonth: number;
  hour: number;
  minute: number;
  dayOfWeek: number;
}

const formatterCache = new Map<string, Intl.DateTimeFormat>();
const weekdayMap: Record<string, number> = {
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6
};

export function getFormatter(timeZone: string): Intl.DateTimeFormat | null {
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

export function getZonedDateParts(date: Date, timeZone: string): ZonedDateParts | null {
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

export function getZonedMinuteKey(date: Date, timeZone: string): string | null {
  const parts = getZonedDateParts(date, timeZone);
  if (!parts) {
    return null;
  }

  return `${parts.year}-${pad2(parts.month)}-${pad2(parts.dayOfMonth)}T${pad2(parts.hour)}:${pad2(parts.minute)}`;
}

function pad2(value: number): string {
  return String(value).padStart(2, "0");
}
