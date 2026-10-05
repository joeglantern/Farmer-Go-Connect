/**
 * ISO date helpers. The API speaks ISO 8601 date-times in UTC; the app shows Nairobi time
 * (UTC+3, no daylight saving).
 */

export type DateLike = Date | string | number;

export const NAIROBI_OFFSET_MINUTES = 3 * 60;
const DAY_MS = 86_400_000;

/** Parse a Date, ISO string or epoch millis. Returns null for invalid input. */
export function fromIso(value: DateLike | null | undefined): Date | null {
  if (value === null || value === undefined) return null;
  const d = value instanceof Date ? new Date(value.getTime()) : new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** Full ISO date-time string (UTC), e.g. `2026-09-26T08:00:00.000Z`. */
export function toIso(value: DateLike): string {
  const d = fromIso(value);
  if (!d) throw new RangeError(`Invalid date: ${String(value)}`);
  return d.toISOString();
}

export const isoNow = (): string => new Date().toISOString();

/** Shift a date so its UTC fields read as Nairobi wall-clock time. */
function toNairobi(d: Date): Date {
  return new Date(d.getTime() + NAIROBI_OFFSET_MINUTES * 60_000);
}

/** Calendar day `YYYY-MM-DD` in Nairobi time (what a farmer or buyer means by "today"). */
export function toIsoDay(value: DateLike, tz: 'nairobi' | 'utc' = 'nairobi'): string {
  const d = fromIso(value);
  if (!d) throw new RangeError(`Invalid date: ${String(value)}`);
  return (tz === 'nairobi' ? toNairobi(d) : d).toISOString().slice(0, 10);
}

/** Midnight Nairobi of the given day, as an instant. */
export function startOfDay(value: DateLike, tz: 'nairobi' | 'utc' = 'nairobi'): Date {
  const day = toIsoDay(value, tz);
  const utcMidnight = new Date(`${day}T00:00:00.000Z`).getTime();
  return new Date(tz === 'nairobi' ? utcMidnight - NAIROBI_OFFSET_MINUTES * 60_000 : utcMidnight);
}

export function addDays(value: DateLike, days: number): Date {
  const d = fromIso(value);
  if (!d) throw new RangeError(`Invalid date: ${String(value)}`);
  return new Date(d.getTime() + days * DAY_MS);
}

export function isSameDay(a: DateLike, b: DateLike, tz: 'nairobi' | 'utc' = 'nairobi'): boolean {
  return toIsoDay(a, tz) === toIsoDay(b, tz);
}

/** Whole calendar days from `from` to `to` in Nairobi time (negative when `to` is earlier). */
export function daysBetween(from: DateLike, to: DateLike, tz: 'nairobi' | 'utc' = 'nairobi'): number {
  return Math.round((startOfDay(to, tz).getTime() - startOfDay(from, tz).getTime()) / DAY_MS);
}

export function isPast(value: DateLike, now: DateLike = new Date()): boolean {
  const d = fromIso(value);
  const n = fromIso(now);
  return !!d && !!n && d.getTime() < n.getTime();
}

/** Monday 00:00 UTC of the week containing `value` (how the API keys weekly prices and demand). */
export function weekStart(value: DateLike): Date {
  const d = fromIso(value);
  if (!d) throw new RangeError(`Invalid date: ${String(value)}`);
  const day = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const dow = (day.getUTCDay() + 6) % 7; // Monday = 0
  day.setUTCDate(day.getUTCDate() - dow);
  return day;
}

/**
 * Short relative label for lists: `today`, `tomorrow`, `yesterday`, `in 3 days`, `4 days ago`,
 * in English or Kiswahili. Beyond 30 days returns the ISO day.
 */
export function relativeDay(
  value: DateLike,
  opts: { lang?: 'en' | 'sw' | string; now?: DateLike } = {},
): string {
  const lang = opts.lang === 'sw' ? 'sw' : 'en';
  const diff = daysBetween(opts.now ?? new Date(), value);
  if (diff === 0) return lang === 'sw' ? 'leo' : 'today';
  if (diff === 1) return lang === 'sw' ? 'kesho' : 'tomorrow';
  if (diff === -1) return lang === 'sw' ? 'jana' : 'yesterday';
  if (Math.abs(diff) > 30) return toIsoDay(value);
  if (diff > 0) return lang === 'sw' ? `baada ya siku ${diff}` : `in ${diff} days`;
  return lang === 'sw' ? `siku ${-diff} zilizopita` : `${-diff} days ago`;
}
