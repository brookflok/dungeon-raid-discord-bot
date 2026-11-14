import { DateTime } from 'luxon';

const PATTERN = /^(?:(today|tomorrow)|(\d{4})-(\d{1,2})-(\d{1,2}))\s+(\d{1,2}):(\d{2})$/i;

export function parseTime(input: string, now: Date, timezone: string): Date | null {
  const m = PATTERN.exec(input.trim().replace(/\s+/g, ' '));
  if (!m) return null;
  const [, word, year, month, day, hour, minute] = m;
  let date: { year: number; month: number; day: number };
  if (word) {
    const today = DateTime.fromJSDate(now, { zone: timezone });
    const target = word.toLowerCase() === 'today' ? today : today.plus({ days: 1 });
    date = { year: target.year, month: target.month, day: target.day };
  } else {
    date = { year: Number(year), month: Number(month), day: Number(day) };
  }
  const result = DateTime.fromObject(
    { ...date, hour: Number(hour), minute: Number(minute) },
    { zone: timezone },
  );
  return result.isValid ? result.toJSDate() : null;
}
