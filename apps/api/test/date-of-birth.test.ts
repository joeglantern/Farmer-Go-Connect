import { ageOn } from '@farmgo/contracts';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { call, closeApp, emailUser, makeApp, nextPhone, phoneUser } from './helpers.js';

/** Dates of birth must give an age from 18 to 100 on today's Nairobi calendar day. */

const yearsAgo = (n: number, dayShift = 0) => {
  const today = new Date(Date.now() + 3 * 3_600_000); // Nairobi calendar day
  const d = new Date(
    Date.UTC(today.getUTCFullYear() - n, today.getUTCMonth(), today.getUTCDate() + dayShift),
  );
  return d.toISOString().slice(0, 10);
};

const dobIssue = (body: any) =>
  body.error?.code === 'VALIDATION_ERROR' &&
  body.error.details.issues.some((i: { path: string }) => String(i.path).includes('dateOfBirth'));

describe('age on a Nairobi calendar day', () => {
  it('counts a birthday that is today, and not one that is tomorrow', () => {
    expect(ageOn(new Date(yearsAgo(18)))).toBe(18);
    expect(ageOn(new Date(yearsAgo(18, 1)))).toBe(17);
    expect(ageOn(new Date(yearsAgo(100)))).toBe(100);
    expect(ageOn(new Date(yearsAgo(101)))).toBe(101);
  });
  it('uses the Nairobi date late at night UTC', () => {
    // 22:00 UTC on 31 Dec is already 1 Jan in Nairobi.
    const now = new Date(Date.UTC(2026, 11, 31, 22));
    expect(ageOn(new Date('2009-01-01'), now)).toBe(18);
    expect(ageOn(new Date('2009-01-02'), now)).toBe(17);
  });
});

describe('date of birth on farmer endpoints', () => {
  let app: FastifyInstance;
  beforeAll(async () => {
    app = await makeApp();
  });
  afterAll(async () => closeApp(app));

  it('onboarding refuses under 18 and over 100', async () => {
    const f = await phoneUser(app, nextPhone());
    const young = await call(app, f, 'POST', '/v1/onboarding/farmer', {
      name: 'Too Young',
      county: 'Kiambu',
      dateOfBirth: yearsAgo(16),
    });
    expect(young.status).toBe(400);
    expect(dobIssue(young.body)).toBe(true);
    const old = await call(app, f, 'POST', '/v1/onboarding/farmer', {
      name: 'Too Old',
      county: 'Kiambu',
      dateOfBirth: yearsAgo(101),
    });
    expect(old.status).toBe(400);
    expect(dobIssue(old.body)).toBe(true);
    const ok = await call(app, f, 'POST', '/v1/onboarding/farmer', {
      name: 'Just Eighteen',
      county: 'Kiambu',
      dateOfBirth: yearsAgo(18),
    });
    expect(ok.status).toBe(201);

    const update = await call(app, f, 'PATCH', '/v1/me/farmer-profile', { dateOfBirth: yearsAgo(17) });
    expect(update.status).toBe(400);
    expect(dobIssue(update.body)).toBe(true);
  });

  it('agent registration refuses under 18 and over 100', async () => {
    const agent = await emailUser(app, 'agent');
    for (const dob of [yearsAgo(15), yearsAgo(120)]) {
      const r = await call(app, agent, 'POST', '/v1/agent/farmers', {
        name: 'Agent Farmer',
        county: 'Kiambu',
        phoneNumber: nextPhone(),
        dateOfBirth: dob,
      });
      expect(r.status).toBe(400);
      expect(dobIssue(r.body)).toBe(true);
    }
  });
});
