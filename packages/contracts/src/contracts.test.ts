import { describe, expect, it } from 'vitest';
import { BoolParam, KenyanPhone, normalizeKenyanPhone } from './common.js';
import {
  CreateListingInput,
  DemandQuery,
  InspectionInput,
  ListingQuery,
  NotificationQuery,
} from './inputs.js';
import {
  allowedTransitions,
  canTransition,
  ORDER_TRANSITIONS,
  TERMINAL_ORDER_STATUSES,
} from './order-state.js';
import { ClientMessage } from './realtime.js';

describe('phone numbers', () => {
  it.each([
    ['0712345678', '+254712345678'],
    ['712345678', '+254712345678'],
    ['254712345678', '+254712345678'],
    ['+254 712 345 678', '+254712345678'],
    ['0110123456', '+254110123456'],
  ])('normalises %s', (input, out) => expect(normalizeKenyanPhone(input)).toBe(out));

  it('rejects non-Kenyan numbers', () => {
    expect(normalizeKenyanPhone('+14155552671')).toBeNull();
    expect(KenyanPhone.safeParse('12345').success).toBe(false);
  });
});

describe('order state machine', () => {
  it('follows the demand-led happy path', () => {
    const path = [
      ['PENDING', 'CONFIRMED', 'farmer'],
      ['CONFIRMED', 'READY_FOR_QA', 'farmer'],
      ['READY_FOR_QA', 'QA_PASSED', 'qa'],
      ['QA_PASSED', 'IN_TRANSIT', 'driver'],
      ['IN_TRANSIT', 'DELIVERED', 'driver'],
      ['DELIVERED', 'PAID', 'system'],
    ] as const;
    for (const [from, to, actor] of path) expect(canTransition(from, to, actor)).toBe(true);
  });
  it('stops actors from skipping steps or acting for others', () => {
    expect(canTransition('PENDING', 'DELIVERED', 'admin')).toBe(false);
    expect(canTransition('PENDING', 'CONFIRMED', 'buyer')).toBe(false);
    expect(canTransition('READY_FOR_QA', 'QA_PASSED', 'farmer')).toBe(false);
    expect(canTransition('DELIVERED', 'PAID', 'buyer')).toBe(false);
  });
  it('has no way out of terminal states', () => {
    for (const s of TERMINAL_ORDER_STATUSES) expect(ORDER_TRANSITIONS[s]).toHaveLength(0);
  });
  it('lists actions available to each side', () => {
    expect(allowedTransitions('PENDING', 'buyer')).toEqual(['CANCELLED']);
    expect(allowedTransitions('DELIVERED', 'buyer')).toEqual(['DISPUTED']);
  });
});

describe('input validation', () => {
  it('rejects listings whose window ends before it starts', () => {
    const r = CreateListingInput.safeParse({
      farmId: 'f',
      produceId: 'p',
      quantity: 10,
      pricePerUnit: 100,
      availableFrom: '2026-10-10',
      availableTo: '2026-10-01',
    });
    expect(r.success).toBe(false);
  });
  it('requires a reason when an inspection fails', () => {
    expect(
      InspectionInput.safeParse({ orderItemId: 'i', grade: 'C', passed: false, acceptedQty: 0 }).success,
    ).toBe(false);
    expect(
      InspectionInput.safeParse({
        orderItemId: 'i',
        grade: 'C',
        passed: false,
        acceptedQty: 0,
        rejectReason: 'Bruised',
      }).success,
    ).toBe(true);
  });
  it('validates realtime messages', () => {
    expect(ClientMessage.safeParse({ op: 'subscribe', channel: 'order:abc123' }).success).toBe(true);
    expect(ClientMessage.safeParse({ op: 'subscribe', channel: 'secrets:all' }).success).toBe(false);
    expect(ClientMessage.safeParse({ op: 'location', routeId: 'r', lat: -1.2, lng: 36.8 }).success).toBe(
      true,
    );
  });
});

describe('query-string flags', () => {
  it('reads "false" and "0" as false (z.coerce.boolean would say true)', () => {
    expect(BoolParam.parse('false')).toBe(false);
    expect(BoolParam.parse('0')).toBe(false);
    expect(BoolParam.parse('true')).toBe(true);
    expect(BoolParam.safeParse('maybe').success).toBe(false);
    expect(NotificationQuery.parse({ unreadOnly: 'false' }).unreadOnly).toBe(false);
    expect(DemandQuery.parse({ recurringOnly: 'false' }).recurringOnly).toBe(false);
    expect(ListingQuery.parse({ mine: 'false', organic: 'false' })).toMatchObject({
      mine: false,
      organic: false,
    });
  });
});
