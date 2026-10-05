/**
 * Money helpers. The API stores integer KES cents (KES 15.20 = 1520). Nothing here uses floats
 * for arithmetic; formatting splits the integer into shillings and cents.
 */

export type Lang = 'en' | 'sw';

export interface FormatKesOptions {
  lang?: Lang | string;
  /** `always` shows .00, `never` drops cents (rounding to the shilling), `auto` (default) shows them only when non-zero. */
  cents?: 'auto' | 'always' | 'never';
  /** Currency label. Default `KES`. Pass `''` for a bare number, or `KSh`. */
  symbol?: string;
  /** Put the sign before the symbol (`-KES 500`, default) or after (`KES -500`). */
  signFirst?: boolean;
}

/** Group an unsigned integer string with commas: 1520000 -> "1,520,000". */
function group(intStr: string): string {
  let out = '';
  for (let i = 0; i < intStr.length; i++) {
    const fromEnd = intStr.length - i;
    out += intStr[i];
    if (fromEnd > 1 && fromEnd % 3 === 1) out += ',';
  }
  return out;
}

/**
 * Format cents as `KES 1,520` (whole) or `KES 1,520.50` (with cents).
 * Non-finite input formats as `KES 0`. Kiswahili uses the same digits and separators.
 */
export function formatKes(cents: number, opts: FormatKesOptions = {}): string {
  const symbol = opts.symbol ?? 'KES';
  const mode = opts.cents ?? 'auto';
  let value = Number.isFinite(cents) ? Math.trunc(cents) : 0;
  const negative = value < 0;
  value = Math.abs(value);
  if (mode === 'never') value = Math.round(value / 100) * 100;
  const shillings = Math.floor(value / 100);
  const rem = value % 100;
  let text = group(String(shillings));
  if (mode === 'always' || (mode === 'auto' && rem !== 0)) text += `.${String(rem).padStart(2, '0')}`;
  const sign = negative ? '-' : '';
  if (!symbol) return `${sign}${text}`;
  return opts.signFirst === false ? `${symbol} ${sign}${text}` : `${sign}${symbol} ${text}`;
}

/**
 * Parse what a person typed into cents: "1,520", "1520.5", "KES 1,520.50", "Ksh 200", "-40".
 * Returns null for empty or unreadable input. Rounds to the nearest cent.
 */
export function parseKesInput(text: string | null | undefined): number | null {
  if (text === null || text === undefined) return null;
  let s = String(text).trim();
  if (!s) return null;
  s = s.replace(/(kes|ksh|sh|kshs|shs)\.?/gi, '').replace(/[\s,_']/g, '');
  // Accept a decimal comma when there is no dot: "1520,50".
  if (!s.includes('.') && /^-?\d+,\d{1,2}$/.test(String(text).replace(/\s/g, ''))) {
    s = String(text).replace(/\s/g, '').replace(',', '.');
  }
  const m = /^(-)?(\d*)(?:\.(\d*))?$/.exec(s);
  if (!m || (!m[2] && !m[3])) return null;
  const whole = m[2] ? Number.parseInt(m[2], 10) : 0;
  const frac = (m[3] ?? '').padEnd(3, '0');
  // Third decimal decides rounding of the cent.
  const centsPart =
    Number.parseInt(frac.slice(0, 2), 10) + (Number.parseInt(frac[2] ?? '0', 10) >= 5 ? 1 : 0);
  const total = whole * 100 + centsPart;
  return m[1] ? -total : total;
}

/** Whole shillings to cents (integers only; fractions of a shilling are rounded to the cent). */
export const shillingsToCents = (shillings: number): number => Math.round(shillings * 100);
/** Cents to shillings as a number (use only for display maths, never for storage). */
export const centsToShillings = (cents: number): number => cents / 100;

/** Percentage of `cents` at `bps` basis points (800 = 8%), rounded to the cent. */
export const applyBps = (cents: number, bps: number): number => Math.round((cents * bps) / 10_000);

/** Line total for a quantity at a unit price in cents, rounded to the cent. */
export const lineTotalCents = (quantity: number, pricePerUnitCents: number): number =>
  Math.round(quantity * pricePerUnitCents);

/** Sum cents safely (ignores non-finite values). */
export const sumCents = (values: Iterable<number>): number => {
  let total = 0;
  for (const v of values) if (Number.isFinite(v)) total += Math.trunc(v);
  return total;
};
