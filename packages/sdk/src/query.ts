export type QueryValue = string | number | boolean | Date | null | undefined;
export type QueryParams = Record<string, QueryValue | QueryValue[]>;

/** Encode query parameters. Undefined and null are skipped, Dates become ISO strings. */
export function toQueryString(params?: QueryParams | object): string {
  if (!params) return '';
  const parts: string[] = [];
  for (const [key, raw] of Object.entries(params as QueryParams)) {
    const values = Array.isArray(raw) ? raw : [raw];
    for (const v of values) {
      if (v === undefined || v === null) continue;
      const s = v instanceof Date ? v.toISOString() : String(v);
      parts.push(`${encodeURIComponent(key)}=${encodeURIComponent(s)}`);
    }
  }
  return parts.length ? `?${parts.join('&')}` : '';
}

/** Join a base URL and a path without doubling or dropping the slash. */
export function joinUrl(baseUrl: string, path: string): string {
  if (/^https?:\/\//i.test(path)) return path;
  const base = baseUrl.replace(/\/+$/, '');
  const p = path.startsWith('/') ? path : `/${path}`;
  return `${base}${p}`;
}

/** Encode one path segment (ids, QR codes, device tokens). */
export const seg = (value: string | number): string => encodeURIComponent(String(value));
