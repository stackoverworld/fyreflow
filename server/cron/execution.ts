import { getZonedDateParts } from "./serialization.js";
import type { CronExpression } from "./schedule.js";

export function matchesCronExpression(
  expression: CronExpression,
  date: Date,
  timeZone: string
): boolean | null {
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
