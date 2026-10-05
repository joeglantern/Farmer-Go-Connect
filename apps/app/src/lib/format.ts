import i18n from '../i18n';

/** Integer KES cents -> "KES 1,520" (no decimals when whole shillings). */
export function kes(cents: number | null | undefined, opts: { bare?: boolean } = {}): string {
  const v = (cents ?? 0) / 100;
  const whole = Number.isInteger(v);
  const s = v.toLocaleString('en-KE', { minimumFractionDigits: whole ? 0 : 2, maximumFractionDigits: 2 });
  return opts.bare ? s : `KES ${s}`;
}

/** Shillings typed by a person ("150", "1,500.50") -> cents, or null if not a number. */
export function parseKes(text: string): number | null {
  const n = Number(text.replace(/[^\d.]/g, ''));
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.round(n * 100);
}

export function unitLabel(unit: string, count = 1): string {
  const base = i18n.t(`common.units.${unit}`, { defaultValue: unit.toLowerCase() });
  if (i18n.language === 'sw' || count === 1 || base === 'kg') return base;
  return base.endsWith('ch') ? `${base}es` : `${base}s`;
}

export function qty(n: number | null | undefined): string {
  const v = n ?? 0;
  return Number.isInteger(v)
    ? v.toLocaleString('en-KE')
    : v.toLocaleString('en-KE', { maximumFractionDigits: 2 });
}

/** Produce name in the current language. */
export function produceName(p: { name: string; nameSw: string } | null | undefined): string {
  if (!p) return '';
  return i18n.language === 'sw' ? p.nameSw : p.name;
}

const locale = () => (i18n.language === 'sw' ? 'sw-KE' : 'en-KE');

export function dateShort(iso: string | Date): string {
  const d = typeof iso === 'string' ? new Date(iso) : iso;
  return d.toLocaleDateString(locale(), { day: 'numeric', month: 'short' });
}

export function dateLong(iso: string | Date): string {
  const d = typeof iso === 'string' ? new Date(iso) : iso;
  return d.toLocaleDateString(locale(), {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

export function timeShort(iso: string | Date): string {
  const d = typeof iso === 'string' ? new Date(iso) : iso;
  return d.toLocaleTimeString(locale(), { hour: '2-digit', minute: '2-digit', hour12: false });
}

/** "Today", "Tomorrow", or a short date. */
export function relativeDay(iso: string | Date): string {
  const d = typeof iso === 'string' ? new Date(iso) : iso;
  const start = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diff = Math.round((start(d) - start(new Date())) / 86_400_000);
  if (diff === 0) return i18n.t('common.today');
  if (diff === 1) return i18n.t('common.tomorrow');
  return dateShort(d);
}

/** "2 min ago", "3 h ago", "yesterday", else a date. */
export function timeAgo(iso: string | Date): string {
  const d = typeof iso === 'string' ? new Date(iso) : iso;
  const s = Math.max(0, (Date.now() - d.getTime()) / 1000);
  const sw = i18n.language === 'sw';
  if (s < 60) return sw ? 'sasa hivi' : 'just now';
  if (s < 3600) return sw ? `dakika ${Math.floor(s / 60)} zilizopita` : `${Math.floor(s / 60)} min ago`;
  if (s < 86_400) return sw ? `saa ${Math.floor(s / 3600)} zilizopita` : `${Math.floor(s / 3600)} h ago`;
  if (s < 172_800) return sw ? 'jana' : 'yesterday';
  return dateShort(d);
}
