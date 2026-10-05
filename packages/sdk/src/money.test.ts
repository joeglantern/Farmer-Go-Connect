import { describe, expect, it } from 'vitest';
import {
  applyBps,
  centsToShillings,
  formatKes,
  lineTotalCents,
  parseKesInput,
  shillingsToCents,
  sumCents,
} from './money.js';

describe('formatKes', () => {
  it('formats whole shillings without decimals and groups thousands', () => {
    expect(formatKes(152_000)).toBe('KES 1,520');
    expect(formatKes(0)).toBe('KES 0');
    expect(formatKes(100)).toBe('KES 1');
    expect(formatKes(99_999_900)).toBe('KES 999,999');
    expect(formatKes(1_234_567_800)).toBe('KES 12,345,678');
  });

  it('shows cents only when they are not zero by default', () => {
    expect(formatKes(152_050)).toBe('KES 1,520.50');
    expect(formatKes(5)).toBe('KES 0.05');
    expect(formatKes(152_000, { cents: 'always' })).toBe('KES 1,520.00');
    expect(formatKes(152_050, { cents: 'never' })).toBe('KES 1,521');
    expect(formatKes(152_049, { cents: 'never' })).toBe('KES 1,520');
  });

  it('handles negatives, symbols and languages', () => {
    expect(formatKes(-50_000)).toBe('-KES 500');
    expect(formatKes(-50_000, { signFirst: false })).toBe('KES -500');
    expect(formatKes(50_000, { symbol: 'KSh' })).toBe('KSh 500');
    expect(formatKes(50_000, { symbol: '' })).toBe('500');
    expect(formatKes(152_000, { lang: 'sw' })).toBe('KES 1,520');
  });

  it('never prints floats or NaN', () => {
    expect(formatKes(Number.NaN)).toBe('KES 0');
    expect(formatKes(Number.POSITIVE_INFINITY)).toBe('KES 0');
    expect(formatKes(1520.7)).toBe('KES 15.20');
  });
});

describe('parseKesInput', () => {
  it('reads what people type', () => {
    expect(parseKesInput('1,520')).toBe(152_000);
    expect(parseKesInput('1520')).toBe(152_000);
    expect(parseKesInput('1520.5')).toBe(152_050);
    expect(parseKesInput('1,520.50')).toBe(152_050);
    expect(parseKesInput('KES 1,520.50')).toBe(152_050);
    expect(parseKesInput('Ksh 200')).toBe(20_000);
    expect(parseKesInput('ksh. 200')).toBe(20_000);
    expect(parseKesInput(' 40 ')).toBe(4_000);
    expect(parseKesInput('.5')).toBe(50);
    expect(parseKesInput('-40')).toBe(-4_000);
    expect(parseKesInput('1520,50')).toBe(152_050);
  });

  it('rounds to the cent and rejects rubbish', () => {
    expect(parseKesInput('1.005')).toBe(101);
    expect(parseKesInput('1.004')).toBe(100);
    expect(parseKesInput('')).toBeNull();
    expect(parseKesInput('   ')).toBeNull();
    expect(parseKesInput(null)).toBeNull();
    expect(parseKesInput(undefined)).toBeNull();
    expect(parseKesInput('abc')).toBeNull();
    expect(parseKesInput('12abc')).toBeNull();
    expect(parseKesInput('1.2.3')).toBeNull();
    expect(parseKesInput('KES')).toBeNull();
  });

  it('round-trips with formatKes', () => {
    for (const cents of [0, 5, 100, 152_050, 99_999_999, 1_234_567_800]) {
      expect(parseKesInput(formatKes(cents))).toBe(cents);
    }
  });
});

describe('integer arithmetic helpers', () => {
  it('converts and sums without float drift', () => {
    expect(shillingsToCents(15.2)).toBe(1520);
    expect(shillingsToCents(0.1 + 0.2)).toBe(30);
    expect(centsToShillings(1520)).toBe(15.2);
    expect(applyBps(100_000, 800)).toBe(8_000);
    expect(applyBps(12_345, 800)).toBe(988);
    expect(lineTotalCents(190, 8000)).toBe(1_520_000);
    expect(lineTotalCents(2.5, 333)).toBe(833);
    expect(sumCents([100, 200, Number.NaN, 300.9])).toBe(600);
  });
});
