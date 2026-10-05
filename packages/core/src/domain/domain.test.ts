import { describe, expect, it } from 'vitest';
import { render } from '../notifications/templates.js';
import {
  centsToShillings,
  darajaTimestamp,
  parseB2CResult,
  parseStkCallback,
  toMsisdn,
} from '../providers/mpesa.js';
import { CRATE_ACTIONS } from './crates.js';
import { occurrences, weekStart } from './demand.js';
import { haversineKm } from './geo.js';
import { nearestNeighbour } from './logistics.js';
import { gradeMeets, isYouth, scoreCandidate } from './matching.js';
import { commissionFor, lineTotal, orderTotals, payoutFor } from './money.js';
import { seasonalForecast } from './pricing.js';
import { SETTING_DEFAULTS } from './settings.js';

const W = SETTING_DEFAULTS.matchWeights;
const base = {
  distanceKm: 10,
  radiusKm: 80,
  pricePerUnit: 8000,
  referencePrice: 8000,
  qaPassRate: 1,
  onTimeRate: 1,
  availableFrom: new Date('2026-10-10'),
  neededBy: new Date('2026-10-10'),
  isYouth: false,
  isWoman: false,
  ordersCompleted: 10,
};

describe('matching score', () => {
  it('prefers closer farms', () => {
    expect(scoreCandidate({ ...base, distanceKm: 5 }, W).total).toBeGreaterThan(
      scoreCandidate({ ...base, distanceKm: 60 }, W).total,
    );
  });
  it('prefers cheaper supply relative to the price index', () => {
    const cheap = scoreCandidate({ ...base, pricePerUnit: 5600 }, W); // 30% below the index
    const dear = scoreCandidate({ ...base, pricePerUnit: 10000 }, W);
    expect(cheap.price).toBe(1);
    expect(dear.price).toBeLessThan(0.5);
  });
  it('boosts youth, women and first-time farmers', () => {
    const boosted = scoreCandidate({ ...base, isYouth: true, isWoman: true, ordersCompleted: 0 }, W);
    expect(boosted.inclusion).toBe(1);
    expect(boosted.total).toBeGreaterThan(scoreCandidate(base, W).total);
  });
  it('penalises harvests far from the needed date', () => {
    const far = scoreCandidate({ ...base, availableFrom: new Date('2026-10-01') }, W);
    expect(far.freshness).toBe(0);
  });
  it('treats unknown distance as neutral', () => {
    expect(scoreCandidate({ ...base, distanceKm: null }, W).distance).toBe(0.5);
  });
  it('keeps totals between 0 and 1', () => {
    const s = scoreCandidate({ ...base, distanceKm: 500, pricePerUnit: 1, referencePrice: 1e9 }, W);
    expect(s.total).toBeGreaterThanOrEqual(0);
    expect(s.total).toBeLessThanOrEqual(1);
  });
});

describe('grades and youth', () => {
  it('compares grades best-first', () => {
    expect(gradeMeets(['A', 'B', 'C'], 'A', 'B')).toBe(true);
    expect(gradeMeets(['A', 'B', 'C'], 'C', 'B')).toBe(false);
    expect(gradeMeets(['A', 'B', 'C'], null, 'B')).toBe(false);
    expect(gradeMeets(['A', 'B', 'C'], null, null)).toBe(true);
  });
  it('counts 18 to 35 year olds as youth', () => {
    const now = new Date('2026-09-26');
    expect(isYouth(new Date('2000-01-01'), now)).toBe(true);
    expect(isYouth(new Date('1980-01-01'), now)).toBe(false);
    expect(isYouth(new Date('2012-01-01'), now)).toBe(false);
    expect(isYouth(null, now)).toBe(false);
  });
});

describe('money', () => {
  it('computes totals in cents without floats leaking', () => {
    expect(lineTotal(12.5, 8000)).toBe(100_000);
    expect(commissionFor(100_000, 800)).toBe(8_000);
    expect(orderTotals(100_000, 30_000, 800)).toEqual({
      subtotal: 100_000,
      deliveryFee: 30_000,
      commission: 8_000,
      total: 130_000,
      farmerNet: 92_000,
    });
    expect(payoutFor(0, 800).net).toBe(0);
  });
});

describe('demand helpers', () => {
  it('expands weekly recurrences', () => {
    const dates = occurrences(
      'FREQ=WEEKLY;BYDAY=MO',
      new Date('2026-09-28T06:00:00Z'),
      new Date('2026-09-28'),
      new Date('2026-10-20'),
    );
    expect(dates.map((d) => d.toISOString().slice(0, 10))).toEqual([
      '2026-09-28',
      '2026-10-05',
      '2026-10-12',
      '2026-10-19',
    ]);
  });
  it('finds the Monday of a week', () => {
    expect(weekStart(new Date('2026-10-01T12:00:00Z')).toISOString().slice(0, 10)).toBe('2026-09-28');
    expect(weekStart(new Date('2026-09-28T00:00:00Z')).toISOString().slice(0, 10)).toBe('2026-09-28');
  });
  it('forecasts with a moving average blended with last year', () => {
    expect(seasonalForecast([100, 100, 100, 100], null)).toBe(100);
    expect(seasonalForecast([100, 100, 100, 100], 200)).toBe(140);
    expect(seasonalForecast([], null)).toBe(0);
  });
});

describe('routing', () => {
  it('orders stops by nearest neighbour and puts unknown locations last', () => {
    const start = { lat: -1.28, lng: 36.82 };
    const { ordered, distanceKm } = nearestNeighbour(start, [
      { key: 'far', point: { lat: -0.42, lng: 36.95 } },
      { key: 'none', point: null },
      { key: 'near', point: { lat: -1.17, lng: 36.84 } },
    ]);
    expect(ordered.map((s) => s.key)).toEqual(['near', 'far', 'none']);
    expect(distanceKm).toBeGreaterThan(80);
  });
  it('measures distance', () => {
    expect(
      Math.round(haversineKm({ lat: -1.2864, lng: 36.8172 }, { lat: -0.0917, lng: 34.768 })),
    ).toBeGreaterThan(260);
  });
});

describe('crates', () => {
  it('only allows valid lifecycle moves', () => {
    expect(CRATE_ACTIONS.DELIVER_TO_BUYER.from).toEqual(['IN_TRANSIT']);
    expect(CRATE_ACTIONS.RETURN.to).toBe('IN_STOCK');
    expect(CRATE_ACTIONS.RETIRE.from).not.toContain('WITH_BUYER');
  });
});

describe('notification templates', () => {
  it('fills variables in both languages and keeps SMS within 160 characters', () => {
    const en = render('payout_success', 'en', { amount: '1,520', code: 'FG-26-001000' });
    const sw = render('payout_success', 'sw', { amount: '1,520', code: 'FG-26-001000' });
    expect(en.body).toContain('KES 1,520');
    expect(sw.body).toContain('M-Pesa');
    expect(sw.title).toBe('Umelipwa');
    const long = render('match_proposed_farmer', 'sw', {
      qty: 1000,
      unit: 'kg',
      produce: 'Nyanya'.repeat(10),
      price: 80,
      date: '2026-10-10',
      ussd: '*384*123#',
    });
    expect(long.sms.length).toBeLessThanOrEqual(160);
  });
});

describe('m-pesa', () => {
  it('rounds collections up and formats numbers', () => {
    expect(centsToShillings(10_050)).toBe(101);
    expect(toMsisdn('+254712345678')).toBe('254712345678');
    expect(darajaTimestamp(new Date('2026-09-26T09:00:00Z'))).toBe('20260926120000');
  });
  it('parses STK and B2C callbacks', () => {
    const stk = parseStkCallback({
      Body: {
        stkCallback: {
          MerchantRequestID: 'm1',
          CheckoutRequestID: 'ws_1',
          ResultCode: 0,
          ResultDesc: 'ok',
          CallbackMetadata: {
            Item: [
              { Name: 'Amount', Value: 1300 },
              { Name: 'MpesaReceiptNumber', Value: 'QAB12' },
              { Name: 'PhoneNumber', Value: 254712345678 },
            ],
          },
        },
      },
    });
    expect(stk).toMatchObject({
      checkoutRequestId: 'ws_1',
      resultCode: '0',
      amount: 1300,
      receipt: 'QAB12',
      phoneNumber: '+254712345678',
    });
    expect(parseStkCallback({})).toBeNull();
    expect(
      parseB2CResult({
        Result: {
          ConversationID: 'c1',
          OriginatorConversationID: 'o1',
          ResultCode: 0,
          ResultDesc: 'ok',
          TransactionID: 'T1',
        },
      }),
    ).toMatchObject({ conversationId: 'c1', resultCode: '0', receipt: 'T1' });
  });
});
