import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { syncAuthUser } from '../src/lib/auth-sync.js';
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

/** B11: the Messages tab lists one thread per order with per-user unread counts. */
describe('conversations inbox', () => {
  let app: FastifyInstance;
  let buyer: Session;
  let colleague: Session;
  let farmer: Session;
  let orgId: string;
  let orderA: string;
  let orderB: string;

  beforeAll(async () => {
    app = await makeApp();
    buyer = await emailUser(app, undefined, 'Inbox Buyer');
    colleague = await emailUser(app, 'buyer', 'Inbox Chef');
    farmer = await phoneUser(app, nextPhone());
    orgId = (
      await call(app, buyer, 'POST', '/v1/onboarding/buyer', {
        businessName: 'Inbox Hotel',
        buyerCategory: 'HOTEL',
        county: 'Nairobi',
      })
    ).body.organization.id;
    // A second member of the same buyer organization reads on their own.
    await app.prisma.member.create({
      data: { id: randomUUID(), organizationId: orgId, userId: colleague.userId, role: 'member' },
    });
    await syncAuthUser(app, colleague.userId);
    await call(app, farmer, 'POST', '/v1/onboarding/farmer', {
      name: 'Grace Wanjiru',
      county: 'Kiambu',
      farm: { name: 'Wanjiru Farm', county: 'Kiambu' },
    });
    const farmId = (await call(app, farmer, 'GET', '/v1/farms')).body[0].id;
    const listing = (
      await call(app, farmer, 'POST', '/v1/supply', {
        farmId,
        produceId: await produceId(app, 'cabbage'),
        quantity: 100,
        pricePerUnit: 4000,
        availableFrom: days(0),
        availableTo: days(6),
      })
    ).body.id;
    orderA = (await call(app, buyer, 'POST', '/v1/orders', { listingId: listing, quantity: 5 })).body.id;
    orderB = (await call(app, buyer, 'POST', '/v1/orders', { listingId: listing, quantity: 6 })).body.id;
  });
  afterAll(async () => closeApp(app));

  it('lists threads with the other side, last message and unread counts', async () => {
    await call(app, buyer, 'POST', `/v1/orders/${orderA}/messages`, { body: 'Habari! Delivery at 8?' });
    await call(app, farmer, 'POST', `/v1/orders/${orderA}/messages`, { body: 'Ndiyo, 8 sharp.' });
    await call(app, farmer, 'POST', `/v1/orders/${orderA}/messages`, {
      body: 'Here is the crop',
      photos: [`chat/${farmer.userId}/crop.jpg`],
    });

    const asBuyer = await call(app, buyer, 'GET', '/v1/conversations');
    expect(asBuyer.status).toBe(200);
    const a = asBuyer.body.find((c: any) => c.orderId === orderA);
    expect(a.other).toMatchObject({ name: 'Grace Wanjiru', role: 'farmer' });
    expect(a.lastMessage).toMatchObject({
      body: 'Here is the crop',
      authorId: farmer.userId,
      hasPhotos: true,
    });
    expect(a.unreadCount).toBe(2); // the buyer's own message is never unread
    expect(asBuyer.body[0].orderId).toBe(orderA); // newest activity first
    const b = asBuyer.body.find((c: any) => c.orderId === orderB);
    expect(b).toMatchObject({ lastMessage: null, unreadCount: 0 });

    const asFarmer = await call(app, farmer, 'GET', '/v1/conversations');
    const fa = asFarmer.body.find((c: any) => c.orderId === orderA);
    expect(fa.other).toMatchObject({ id: orgId, name: 'Inbox Hotel', role: 'buyer' });
    expect(fa.unreadCount).toBe(1);
  });

  it('marks a thread read per user, and badges add up across threads', async () => {
    expect((await call(app, buyer, 'GET', '/v1/me/badges')).body.messagesUnread).toBe(2);
    const read = await call(app, buyer, 'POST', `/v1/orders/${orderA}/messages/read`);
    expect(read.status).toBe(204);
    const after = await call(app, buyer, 'GET', '/v1/conversations');
    expect(after.body.find((c: any) => c.orderId === orderA).unreadCount).toBe(0);
    expect((await call(app, buyer, 'GET', '/v1/me/badges')).body.messagesUnread).toBe(0);
    // The colleague has not opened it yet: the farmer's two messages are unread for them, but
    // their teammate's message is not (same buyer organization counts as "us").
    const chef = await call(app, colleague, 'GET', '/v1/conversations', undefined, { 'x-org-id': orgId });
    expect(chef.body.find((c: any) => c.orderId === orderA).unreadCount).toBe(2);

    await call(app, farmer, 'POST', `/v1/orders/${orderB}/messages`, { body: 'Order B is ready' });
    const badges = await call(app, buyer, 'GET', '/v1/me/badges');
    expect(badges.body).toMatchObject({ messagesUnread: 1 });
    expect(typeof badges.body.notificationsUnread).toBe('number');
  });

  it("keeps other people's threads private", async () => {
    const stranger = await emailUser(app, undefined, 'Stranger');
    await call(app, stranger, 'POST', '/v1/onboarding/buyer', {
      businessName: 'Stranger Cafe',
      buyerCategory: 'RESTAURANT',
      county: 'Nairobi',
    });
    const list = await call(app, stranger, 'GET', '/v1/conversations');
    expect(list.body).toEqual([]);
    expect((await call(app, stranger, 'POST', `/v1/orders/${orderA}/messages/read`)).status).toBe(404);
    const fresh = await emailUser(app);
    expect((await call(app, fresh, 'GET', '/v1/me/badges')).body.messagesUnread).toBe(0);
  });
});
