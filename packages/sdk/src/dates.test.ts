import { describe, expect, it } from 'vitest';
import {
  addDays,
  daysBetween,
  fromIso,
  isPast,
  isSameDay,
  relativeDay,
  startOfDay,
  toIso,
  toIsoDay,
  weekStart,
} from './dates.js';

describe('ISO helpers', () => {
  it('parses and serializes', () => {
    expect(fromIso('2026-09-26T08:00:00.000Z')?.getTime()).toBe(Date.UTC(2026, 8, 26, 8));
    expect(fromIso('not a date')).toBeNull();
    expect(fromIso(null)).toBeNull();
    expect(toIso(Date.UTC(2026, 0, 2))).toBe('2026-01-02T00:00:00.000Z');
    expect(() => toIso('nope')).toThrow(RangeError);
  });

  it('uses Nairobi time (UTC+3) for calendar days', () => {
    // 22:30 UTC on the 26th is 01:30 on the 27th in Nairobi.
    expect(toIsoDay('2026-09-26T22:30:00.000Z')).toBe('2026-09-27');
    expect(toIsoDay('2026-09-26T22:30:00.000Z', 'utc')).toBe('2026-09-26');
    expect(startOfDay('2026-09-26T22:30:00.000Z').toISOString()).toBe('2026-09-26T21:00:00.000Z');
    expect(isSameDay('2026-09-26T22:30:00.000Z', '2026-09-27T10:00:00.000Z')).toBe(true);
    expect(isSameDay('2026-09-26T20:00:00.000Z', '2026-09-27T10:00:00.000Z')).toBe(false);
  });

  it('adds days and counts calendar days between dates', () => {
    expect(addDays('2026-02-27T12:00:00.000Z', 2).toISOString()).toBe('2026-03-01T12:00:00.000Z');
    expect(daysBetween('2026-09-26T10:00:00.000Z', '2026-09-28T09:00:00.000Z')).toBe(2);
    expect(daysBetween('2026-09-28T09:00:00.000Z', '2026-09-26T10:00:00.000Z')).toBe(-2);
    // Late evening UTC is already the next Nairobi day.
    expect(daysBetween('2026-09-26T12:00:00.000Z', '2026-09-26T22:00:00.000Z')).toBe(1);
    expect(isPast('2026-01-01T00:00:00.000Z', '2026-01-02T00:00:00.000Z')).toBe(true);
    expect(isPast('2026-01-03T00:00:00.000Z', '2026-01-02T00:00:00.000Z')).toBe(false);
  });

  it('finds the Monday of the week like the API', () => {
    expect(weekStart('2026-09-26T10:00:00.000Z').toISOString()).toBe('2026-09-21T00:00:00.000Z'); // Saturday
    expect(weekStart('2026-09-21T10:00:00.000Z').toISOString()).toBe('2026-09-21T00:00:00.000Z'); // Monday
    expect(weekStart('2026-09-27T23:00:00.000Z').toISOString()).toBe('2026-09-21T00:00:00.000Z'); // Sunday
  });

  it('labels days relative to now in both languages', () => {
    const now = '2026-09-26T09:00:00.000Z';
    expect(relativeDay('2026-09-26T15:00:00.000Z', { now })).toBe('today');
    expect(relativeDay('2026-09-27T05:00:00.000Z', { now, lang: 'sw' })).toBe('kesho');
    expect(relativeDay('2026-09-25T05:00:00.000Z', { now })).toBe('yesterday');
    expect(relativeDay('2026-09-29T05:00:00.000Z', { now })).toBe('in 3 days');
    expect(relativeDay('2026-09-29T05:00:00.000Z', { now, lang: 'sw' })).toBe('baada ya siku 3');
    expect(relativeDay('2026-09-22T05:00:00.000Z', { now, lang: 'sw' })).toBe('siku 4 zilizopita');
    expect(relativeDay('2026-12-25T05:00:00.000Z', { now })).toBe('2026-12-25');
  });
});
