import i18n from '../../i18n';

/** The repeat options the app offers, as RRULEs the API accepts (FREQ=...;BYDAY=...). */
export type Repeat = 'none' | 'weekly' | 'biweekly' | 'monthly';
export const REPEATS: Repeat[] = ['none', 'weekly', 'biweekly', 'monthly'];

const DAYS = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'];

export function toRRule(repeat: Repeat, neededBy: Date): string | undefined {
  const day = DAYS[neededBy.getDay()];
  if (repeat === 'weekly') return `FREQ=WEEKLY;BYDAY=${day}`;
  if (repeat === 'biweekly') return `FREQ=WEEKLY;INTERVAL=2;BYDAY=${day}`;
  if (repeat === 'monthly') return 'FREQ=MONTHLY';
  return undefined;
}

/**
 * The first few delivery dates a repeat rule gives, starting on the chosen date, for a preview
 * before saving. Matches the API's RRULE handling: a monthly date that a month does not have
 * (the 31st) is skipped that month.
 */
export function nextDates(repeat: Repeat, start: Date, count = 4): Date[] {
  if (repeat === 'none') return [];
  const out: Date[] = [];
  if (repeat === 'monthly') {
    for (let m = 0; out.length < count && m < count * 2; m++) {
      const d = new Date(start.getFullYear(), start.getMonth() + m, start.getDate());
      if (d.getDate() === start.getDate()) out.push(d);
    }
    return out;
  }
  const step = repeat === 'biweekly' ? 14 : 7;
  for (let i = 0; i < count; i++) {
    out.push(new Date(start.getFullYear(), start.getMonth(), start.getDate() + i * step));
  }
  return out;
}

export function repeatOf(rule: string | null | undefined): Repeat {
  if (!rule) return 'none';
  if (rule.startsWith('FREQ=MONTHLY')) return 'monthly';
  if (/INTERVAL=2/.test(rule)) return 'biweekly';
  if (rule.startsWith('FREQ=WEEKLY')) return 'weekly';
  return 'weekly';
}

/** "Every Monday", "Every 2 weeks on Monday", "Every month", or null for one-off. */
export function repeatLabel(rule: string | null | undefined, neededBy: string): string | null {
  const r = repeatOf(rule);
  if (r === 'none') return null;
  const weekday = new Date(neededBy).toLocaleDateString(i18n.language === 'sw' ? 'sw-KE' : 'en-KE', {
    weekday: 'long',
  });
  return i18n.t(`requirements.repeatLabel.${r}`, { day: weekday });
}

export const OPEN_STATUSES = ['OPEN', 'PARTIALLY_FILLED'];
