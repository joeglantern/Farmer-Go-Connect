import { DeepLink } from '@farmgo/contracts';
import { checkStkStatus, handleEventNotification, matchDemand } from '@farmgo/core';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  call,
  closeApp,
  days,
  emailUser,
  makeApp,
  nextPhone,
  phoneUser,
  produceId,
  type Session,
} from './helpers.js';

/** B14: every notification opens a screen in the app ({ route, params } in its data). */
describe('notification deep links', () => {
  let app: FastifyInstance;
  let buyer: Session;
  let farmer: Session;
  let since: bigint;

  beforeAll(async () => {
    app = await makeApp();
    since = (await app.prisma.outboxEvent.aggregate({ _max: { id: true } }))._max.id ?? 0n;
    buyer = await emailUser(app, undefined, 'Link Buyer');
    await call(app, buyer, 'POST', '/v1/onboarding/buyer', {
      businessName: 'Link Hotel',
      buyerCategory: 'HOTEL',
      county: 'Nairobi',
      lat: -1.29,
      lng: 36.82,
    });
    farmer = await phoneUser(app, nextPhone());
    await call(app, farmer, 'POST', '/v1/onboarding/farmer', {
      name: 'Link Farmer',
      county: 'Kiambu',
      farm: { name: 'Link Farm', county: 'Kiambu', lat: -1.17, lng: 36.83 },
    });
  });
  afterAll(async () => closeApp(app));

  it('gives every notification a valid link', async () => {
    const farmId = (await call(app, farmer, 'GET', '/v1/farms')).body[0].id;
    const garlic = await produceId(app, 'garlic');
    const listingId = (
      await call(app, farmer, 'POST', '/v1/supply', {
        farmId,
        produceId: garlic,
        quantity: 200,
        pricePerUnit: 20_000,
        availableFrom: days(0),
        availableTo: days(9),
      })
    ).body.id;
    // A direct order through its whole early life, a chat, a cancellation and a payment.
    const o = (await call(app, buyer, 'POST', '/v1/orders', { listingId, quantity: 2 })).body;
    await call(app, farmer, 'POST', `/v1/orders/${o.id}/confirm`);
    await call(app, buyer, 'POST', `/v1/orders/${o.id}/messages`, { body: 'Habari' });
    const pay = await call(app, buyer, 'POST', `/v1/orders/${o.id}/pay`, { phoneNumber: '0712345678' });
    await checkStkStatus(app.prisma, pay.body.paymentId);
    const c = (await call(app, buyer, 'POST', '/v1/orders', { listingId, quantity: 1 })).body;
    await call(app, buyer, 'POST', `/v1/orders/${c.id}/cancel`, { reason: 'Menu changed' });
    // A match proposal.
    const demand = (
      await call(app, buyer, 'POST', '/v1/demand', { produceId: garlic, quantity: 5, neededBy: days(3) })
    ).body;
    await matchDemand(app.prisma, demand.id);

    // What the worker does: turn each event into notifications.
    const events = await app.prisma.outboxEvent.findMany({
      where: { id: { gt: since } },
      orderBy: { id: 'asc' },
    });
    for (const e of events) {
      await handleEventNotification(
        app.prisma,
        app.redis,
        e.type as never,
        e.payload as Record<string, unknown>,
      );
    }
    const notes = await app.prisma.notification.findMany({
      where: { userId: { in: [buyer.userId, farmer.userId] } },
    });
    const types = new Set(notes.map((n) => n.type));
    expect([...types].sort()).toEqual(
      expect.arrayContaining(['match.proposed', 'order.message', 'order.status_changed', 'payment.updated']),
    );
    for (const n of notes) {
      const link = DeepLink.safeParse(n.data);
      expect({ type: n.type, ok: link.success }).toEqual({ type: n.type, ok: true });
    }
    const orderLink = notes.find((n) => n.type === 'order.message')!.data as {
      route: string;
      params: Record<string, string>;
    };
    expect(orderLink).toMatchObject({ route: 'order', params: { id: o.id, section: 'messages' } });
    const matchLink = notes.find((n) => n.type === 'match.proposed')!.data as { route: string };
    expect(matchLink.route).toBe('match');

    const inbox = await call(app, farmer, 'GET', '/v1/notifications');
    expect(inbox.status).toBe(200);
    expect(inbox.body.items.every((n: any) => n.link && typeof n.link.route === 'string')).toBe(true);
  });
});
