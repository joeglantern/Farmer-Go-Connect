import { handleEventNotification } from '@farmgo/core';
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

/** Every new listing passes a QA check at the farm before buyers can see it. */
describe('listing QA check', () => {
  let app: FastifyInstance;
  let farmer: Session;
  let buyer: Session;
  let qa: Session;
  let farmId: string;
  let kale: string;

  const create = (extra: Record<string, unknown> = {}) =>
    call(app, farmer, 'POST', '/v1/supply', {
      farmId,
      produceId: kale,
      quantity: 120,
      pricePerUnit: 2_800,
      availableFrom: days(0),
      availableTo: days(8),
      ...extra,
    });
  const check = (id: string, body: Record<string, unknown>, as: Session = qa) =>
    call(app, as, 'POST', `/v1/qa/listings/${id}/check`, { photos: [], ...body });
  const browseIds = async () =>
    (
      (await call(app, buyer, 'GET', `/v1/supply?produceId=${kale}&limit=100`)).body.items as { id: string }[]
    ).map((l) => l.id);
  const lastEvent = (listingId: string, type: string) =>
    app.prisma.outboxEvent.findFirst({ where: { aggregateId: listingId, type }, orderBy: { id: 'desc' } });

  beforeAll(async () => {
    app = await makeApp();
    farmer = await phoneUser(app, nextPhone());
    await call(app, farmer, 'POST', '/v1/onboarding/farmer', {
      name: 'Check Farmer',
      county: 'Nyeri',
      farm: { name: 'Check Farm', county: 'Nyeri' },
    });
    await app.prisma.user.update({ where: { id: farmer.userId }, data: { preferredLanguage: 'en' } });
    farmId = (await call(app, farmer, 'GET', '/v1/farms')).body[0].id;
    kale = await produceId(app, 'kale');
    buyer = await emailUser(app, undefined, 'Check Buyer');
    await call(app, buyer, 'POST', '/v1/onboarding/buyer', {
      businessName: 'Check Hotel',
      buyerCategory: 'HOTEL',
      county: 'Nairobi',
    });
    qa = await emailUser(app, 'qa_officer', 'Check Officer');
    await app.prisma.user.update({ where: { id: qa.userId }, data: { county: 'Nyeri' } });
  });
  afterAll(async () => closeApp(app));

  it('a new listing waits for QA and buyers cannot see it', async () => {
    const r = await create();
    expect(r.status).toBe(201);
    expect(r.body).toMatchObject({ status: 'PENDING_QA', qaApprovedAt: null, qaPhotos: [], qaPhotoUrls: [] });
    const id = r.body.id as string;
    expect(await lastEvent(id, 'supply.qa_requested')).toBeTruthy();
    expect(await lastEvent(id, 'supply.created')).toBeNull();

    expect(await browseIds()).not.toContain(id);
    expect((await call(app, buyer, 'GET', `/v1/supply/${id}`)).status).toBe(404);
    const order = await call(app, buyer, 'POST', '/v1/orders', { listingId: id, quantity: 1 });
    expect(order.status).toBeGreaterThanOrEqual(400);

    // The farmer still sees it in their own list, and the officer in the county queue and by id.
    const mine = await call(app, farmer, 'GET', '/v1/supply?mine=true&limit=100');
    expect(mine.body.items.find((l: { id: string }) => l.id === id)?.status).toBe('PENDING_QA');
    const queue = await call(app, qa, 'GET', '/v1/qa/listings');
    expect(queue.status).toBe(200);
    const task = queue.body.find((l: { id: string }) => l.id === id);
    expect(task).toMatchObject({ produce: { id: kale }, farm: { id: farmId, county: 'Nyeri' } });
    expect(task.farm.farmer.user.name).toBe('Check Farmer');
    expect(
      (await call(app, qa, 'GET', '/v1/qa/listings?county=Kiambu')).body.map((l: any) => l.id),
    ).not.toContain(id);
    expect((await call(app, qa, 'GET', `/v1/supply/${id}`)).status).toBe(200);
    expect((await call(app, buyer, 'GET', '/v1/qa/listings')).status).toBe(403);
  });

  it('approval makes it visible with the grade the officer set', async () => {
    const id = (await create()).body.id as string;
    expect((await check(id, { passed: true }, buyer)).status).toBe(403);
    const badGrade = await check(id, { passed: true, grade: 'Z' });
    expect(badGrade.status).toBe(400);
    expect(badGrade.body.error.code).toBe('INVALID_GRADE');

    const ok = await check(id, { passed: true, grade: 'B', note: 'Fresh and clean' });
    expect(ok.status).toBe(200);
    expect(ok.body).toMatchObject({ status: 'OPEN', grade: 'B', qaNote: 'Fresh and clean' });
    expect(ok.body.qaApprovedAt).toBeTruthy();
    expect(await lastEvent(id, 'supply.created')).toBeTruthy();
    const checked = await lastEvent(id, 'supply.qa_checked');
    expect(checked?.payload).toMatchObject({ passed: true, farmerUserId: farmer.userId });
    expect(
      await app.prisma.auditLog.count({
        where: { entityId: id, action: 'listing.qa_approve', actorId: qa.userId },
      }),
    ).toBe(1);

    expect(await browseIds()).toContain(id);
    expect((await call(app, buyer, 'GET', `/v1/supply/${id}`)).body.grade).toBe('B');
    const again = await check(id, { passed: true });
    expect(again.status).toBe(409);
    expect(again.body.error.code).toBe('LISTING_NOT_PENDING');
    expect(
      (await call(app, qa, 'POST', '/v1/qa/listings/nope/check', { passed: true, photos: [] })).status,
    ).toBe(404);

    await handleEventNotification(app.prisma, app.redis, 'supply.qa_checked', checked!.payload as never);
    const note = await app.prisma.notification.findFirst({
      where: { userId: farmer.userId, type: 'supply.qa_checked' },
      orderBy: { createdAt: 'desc' },
    });
    expect(note?.body).toBe('Your Kale (sukuma wiki) listing is approved and buyers can now see it.');
    expect(note?.data).toMatchObject({ route: 'listing', params: { id } });
  });

  it('a rejected listing goes back to QA when the farmer sends it again', async () => {
    const id = (await create()).body.id as string;
    const noReason = await check(id, { passed: false });
    expect(noReason.status).toBe(400);
    const no = await check(id, { passed: false, note: 'Leaves are yellowing' });
    expect(no.status).toBe(200);
    expect(no.body).toMatchObject({
      status: 'QA_REJECTED',
      qaNote: 'Leaves are yellowing',
      qaApprovedAt: null,
    });
    expect((await lastEvent(id, 'supply.qa_checked'))?.payload).toMatchObject({ passed: false });
    expect(await browseIds()).not.toContain(id);
    expect((await call(app, buyer, 'GET', `/v1/supply/${id}`)).status).toBe(404);
    expect((await call(app, farmer, 'GET', `/v1/supply/${id}`)).body.qaNote).toBe('Leaves are yellowing');

    await handleEventNotification(app.prisma, app.redis, 'supply.qa_checked', {
      listingId: id,
      farmerUserId: farmer.userId,
      passed: false,
      produceName: 'Kale (sukuma wiki)',
    });
    const note = await app.prisma.notification.findFirst({
      where: { userId: farmer.userId, type: 'supply.qa_checked' },
      orderBy: { createdAt: 'desc' },
    });
    expect(note?.body).toBe(
      'Your Kale (sukuma wiki) listing was not approved. Open it to see why and send it again.',
    );

    // An edit alone keeps it rejected; sending it again puts it back in the queue.
    const edited = await call(app, farmer, 'PATCH', `/v1/supply/${id}`, { pricePerUnit: 2_500 });
    expect(edited.body.status).toBe('QA_REJECTED');
    const before = await app.prisma.outboxEvent.count({
      where: { aggregateId: id, type: 'supply.qa_requested' },
    });
    const again = await call(app, farmer, 'PATCH', `/v1/supply/${id}`, { status: 'OPEN' });
    expect(again.status).toBe(200);
    expect(again.body).toMatchObject({ status: 'PENDING_QA', qaNote: null });
    expect(
      await app.prisma.outboxEvent.count({ where: { aggregateId: id, type: 'supply.qa_requested' } }),
    ).toBe(before + 1);
    // Edits while waiting keep it waiting.
    const waiting = await call(app, farmer, 'PATCH', `/v1/supply/${id}`, { quantity: 150 });
    expect(waiting.body.status).toBe('PENDING_QA');
    expect((await check(id, { passed: true })).body.status).toBe('OPEN');
  });

  it('a draft that is published goes to QA, not straight to buyers', async () => {
    const draft = await create({ status: 'DRAFT' });
    expect(draft.body.status).toBe('DRAFT');
    expect(await lastEvent(draft.body.id, 'supply.qa_requested')).toBeNull();
    const published = await call(app, farmer, 'PATCH', `/v1/supply/${draft.body.id}`, { status: 'OPEN' });
    expect(published.body.status).toBe('PENDING_QA');
    expect(await lastEvent(draft.body.id, 'supply.qa_requested')).toBeTruthy();
    // Pausing a listing that waits for QA is allowed; resuming sends it back to the queue.
    const paused = await call(app, farmer, 'PATCH', `/v1/supply/${draft.body.id}`, { status: 'DRAFT' });
    expect(paused.body.status).toBe('DRAFT');
    const resumed = await call(app, farmer, 'PATCH', `/v1/supply/${draft.body.id}`, { status: 'OPEN' });
    expect(resumed.body.status).toBe('PENDING_QA');
  });

  it('pausing and resuming an approved listing needs no new check', async () => {
    const id = (await create()).body.id as string;
    const approved = (await check(id, { passed: true })).body;
    const paused = await call(app, farmer, 'PATCH', `/v1/supply/${id}`, { status: 'DRAFT' });
    expect(paused.body.status).toBe('DRAFT');
    expect(await browseIds()).not.toContain(id);
    const requests = await app.prisma.outboxEvent.count({
      where: { aggregateId: id, type: 'supply.qa_requested' },
    });
    const resumed = await call(app, farmer, 'PATCH', `/v1/supply/${id}`, { status: 'OPEN' });
    expect(resumed.body).toMatchObject({ status: 'OPEN', qaApprovedAt: approved.qaApprovedAt });
    expect(
      await app.prisma.outboxEvent.count({ where: { aggregateId: id, type: 'supply.qa_requested' } }),
    ).toBe(requests);
    expect(await browseIds()).toContain(id);
    const edited = await call(app, farmer, 'PATCH', `/v1/supply/${id}`, { pricePerUnit: 3_000 });
    expect(edited.body.status).toBe('OPEN');
  });

  it('refuses harvest ready before approval', async () => {
    const id = (await create()).body.id as string;
    const r = await call(app, farmer, 'POST', `/v1/supply/${id}/harvest-ready`);
    expect(r.status).toBe(409);
    expect(r.body.error.code).toBe('LISTING_NOT_APPROVED');
    await check(id, { passed: true });
    expect((await call(app, farmer, 'POST', `/v1/supply/${id}/harvest-ready`)).status).toBe(200);
  });
});
