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
import { checkStkStatus, drainAll, generateInvoices } from './settlement-helpers.js';

/**
 * QA regression tests for bugs filed in docs/qa/BUGS.md (ticket 001).
 * Each test is marked `it.fails` while the bug is open: it documents the expected behaviour and
 * fails today. When the Backend team fixes a bug, flip `it.fails` to `it` and the test guards it.
 * Ids match the BUGS.md table.
 */

async function onboardBuyer(app: FastifyInstance, s: Session, name: string, phone?: string) {
  const r = await call(app, s, 'POST', '/v1/onboarding/buyer', {
    businessName: name,
    buyerCategory: 'HOTEL',
    county: 'Nairobi',
    lat: -1.2921,
    lng: 36.8219,
    ...(phone ? { phone } : {}),
  });
  expect(r.status).toBe(201);
  return r.body.organization.id as string;
}

async function onboardFarmerWithListing(app: FastifyInstance, s: Session, slug = 'potatoes', price = 5500) {
  await call(app, s, 'POST', '/v1/onboarding/farmer', {
    name: 'John Kariuki',
    county: 'Kiambu',
    farm: { name: 'Kariuki Farm', county: 'Kiambu', lat: -1.05, lng: 36.9 },
  });
  const farm = (await call(app, s, 'GET', '/v1/farms')).body[0];
  const listing = await call(app, s, 'POST', '/v1/supply', {
    farmId: farm.id,
    produceId: await produceId(app, slug),
    quantity: 1000,
    grade: 'A',
    pricePerUnit: price,
    availableFrom: days(0),
    availableTo: days(7),
  });
  expect(listing.status).toBe(201);
  return listing.body.id as string;
}

/** A new prepaid buyer per money test: /pay is limited to 5 per minute per user even in tests. */
async function freshBuyer(app: FastifyInstance, name: string) {
  const b = await emailUser(app, undefined, name);
  await onboardBuyer(app, b, `${name} Ltd`);
  return b;
}

/** Order, farmer confirms, buyer pays by mock M-Pesa. */
async function paidOrder(
  app: FastifyInstance,
  buyer: Session,
  farmer: Session,
  listingId: string,
  quantity: number,
) {
  const order = (await call(app, buyer, 'POST', '/v1/orders', { listingId, quantity })).body;
  expect((await call(app, farmer, 'POST', `/v1/orders/${order.id}/confirm`)).status).toBe(200);
  const pay = await call(app, buyer, 'POST', `/v1/orders/${order.id}/pay`, { phoneNumber: '0722111222' });
  expect(pay.status).toBe(202);
  await checkStkStatus(app.prisma, pay.body.paymentId);
  const paid = await app.prisma.order.findUniqueOrThrow({ where: { id: order.id } });
  expect(paid.paymentStatus).toBe('PAID');
  return paid;
}

async function adminWalk(app: FastifyInstance, admin: Session, orderId: string, statuses: string[]) {
  for (const to of statuses) {
    const r = await call(app, admin, 'POST', `/v1/orders/${orderId}/transition`, { to });
    expect(r.status).toBe(200);
  }
}

const ussd = (app: FastifyInstance, phoneNumber: string, text: string, sessionId = 'qa-ussd') =>
  app
    .inject({
      method: 'POST',
      url: '/webhooks/ussd?token=test-ussd-token',
      payload: { sessionId, phoneNumber, text },
    })
    .then((r) => r.body);

describe('QA regressions (ticket 001)', () => {
  let app: FastifyInstance;
  let admin: Session;
  let buyer: Session;
  let farmer: Session;
  let qa: Session;
  let listingId: string;
  let buyerOrg: string;

  beforeAll(async () => {
    app = await makeApp();
    admin = await emailUser(app, 'admin');
    buyer = await emailUser(app, undefined, 'Grace Hotel');
    farmer = await phoneUser(app, nextPhone());
    qa = await emailUser(app, 'qa_officer');
    buyerOrg = await onboardBuyer(app, buyer, 'Regression Hotel');
    listingId = await onboardFarmerWithListing(app, farmer);
  });
  afterAll(async () => closeApp(app));

  it('QA-001 USSD webhook: registering an existing buyer phone must not turn the account into a farmer', async () => {
    const phone = nextPhone();
    const hotel = await emailUser(app, undefined, 'Phone Hotel');
    await app.prisma.user.update({ where: { id: hotel.userId }, data: { phoneNumber: phone } });
    await onboardBuyer(app, hotel, 'Phone Hotel Ltd');
    // Fixed: the number belongs to a buyer, so USSD refuses instead of registering a farmer.
    expect(await ussd(app, phone, '1*Evil Name*nairobi')).toMatch(/^END .*(isiyo ya mkulima|not a farmer)/);
    const after = await app.prisma.user.findUniqueOrThrow({ where: { id: hotel.userId } });
    expect(after.role).toBe('buyer');
    expect(after.name).toBe('Phone Hotel');
  });

  it('QA-001b USSD webhook rejects requests that do not carry the shared secret', async () => {
    const r = await app.inject({
      method: 'POST',
      url: '/webhooks/ussd',
      payload: { sessionId: 's', phoneNumber: '+254711000001', text: '' },
    });
    expect([401, 403]).toContain(r.statusCode);
  });

  it('QA-002 buyer cannot move an order to DISPUTED through /transition without a dispute record', async () => {
    const b = await freshBuyer(app, 'Dispute Hotel');
    const order = await paidOrder(app, b, farmer, listingId, 5);
    await adminWalk(app, admin, order.id, ['READY_FOR_QA', 'QA_PASSED', 'IN_TRANSIT', 'DELIVERED']);
    const r = await call(app, b, 'POST', `/v1/orders/${order.id}/transition`, { to: 'DISPUTED' });
    expect(r.status).toBe(409);
    expect((await app.prisma.order.findUniqueOrThrow({ where: { id: order.id } })).status).toBe('DELIVERED');
  });

  it('QA-003 QA officer cannot pass or reject an order through /transition without recording an inspection', async () => {
    const order = (await call(app, buyer, 'POST', '/v1/orders', { listingId, quantity: 5 })).body;
    await call(app, farmer, 'POST', `/v1/orders/${order.id}/confirm`);
    await call(app, farmer, 'POST', `/v1/orders/${order.id}/ready`);
    const r = await call(app, qa, 'POST', `/v1/orders/${order.id}/transition`, { to: 'QA_PASSED' });
    expect(r.status).toBe(409);
    const after = await app.prisma.order.findUniqueOrThrow({ where: { id: order.id } });
    expect(after.status).toBe('READY_FOR_QA');
  });

  it('QA-004 cancelling a prepaid order the buyer already paid refunds the buyer', async () => {
    const b = await freshBuyer(app, 'Cancel Hotel');
    const order = await paidOrder(app, b, farmer, listingId, 5);
    const r = await call(app, farmer, 'POST', `/v1/orders/${order.id}/cancel`, {
      reason: 'Cannot supply this week',
    });
    expect(r.status).toBe(200);
    await drainAll(app);
    const after = await app.prisma.order.findUniqueOrThrow({
      where: { id: order.id },
      include: { payments: true },
    });
    const refunds = after.payments.filter((p) => p.direction === 'OUT');
    expect(refunds.length).toBeGreaterThan(0);
    expect(refunds.reduce((s, p) => s + p.amount, 0)).toBe(order.total);
    expect(after.paymentStatus).toBe('REFUNDED');
  });

  it('QA-004b a paid order that fails QA refunds the buyer', async () => {
    const b = await freshBuyer(app, 'Reject Hotel');
    const order = await paidOrder(app, b, farmer, listingId, 5);
    await call(app, farmer, 'POST', `/v1/orders/${order.id}/ready`);
    const item = await app.prisma.orderItem.findFirstOrThrow({ where: { orderId: order.id } });
    const insp = await call(app, qa, 'POST', '/v1/qa/inspections', {
      orderItemId: item.id,
      grade: 'C',
      passed: false,
      acceptedQty: 0,
      rejectReason: 'Rotten',
    });
    expect(insp.status).toBe(201);
    await drainAll(app);
    const after = await app.prisma.order.findUniqueOrThrow({
      where: { id: order.id },
      include: { payments: true },
    });
    expect(after.status).toBe('QA_REJECTED');
    expect(after.payments.some((p) => p.direction === 'OUT')).toBe(true);
    expect(after.paymentStatus).toBe('REFUNDED');
  });

  it('QA-005 prepaid buyer is only charged for the quantity QA accepted', async () => {
    const b = await freshBuyer(app, 'Partial Hotel');
    const order = await paidOrder(app, b, farmer, listingId, 40); // 40 x 5500 + 30000 fee
    await call(app, farmer, 'POST', `/v1/orders/${order.id}/ready`);
    const item = await app.prisma.orderItem.findFirstOrThrow({ where: { orderId: order.id } });
    await call(app, qa, 'POST', '/v1/qa/inspections', {
      orderItemId: item.id,
      grade: 'A',
      passed: true,
      acceptedQty: 30,
      rejectedQty: 10,
    });
    await adminWalk(app, admin, order.id, ['IN_TRANSIT', 'DELIVERED']);
    await call(app, b, 'POST', `/v1/orders/${order.id}/confirm-receipt`);
    await drainAll(app);
    const after = await app.prisma.order.findUniqueOrThrow({
      where: { id: order.id },
      include: { payments: true },
    });
    const paidIn = after.payments
      .filter((p) => p.direction === 'IN' && p.status === 'SUCCESS')
      .reduce((s, p) => s + p.amount, 0);
    const refunded = after.payments
      .filter((p) => p.direction === 'OUT' && p.status !== 'FAILED')
      .reduce((s, p) => s + p.amount, 0);
    expect(after.acceptedSubtotal).toBe(30 * 5500);
    // What the buyer keeps paying must reconcile to accepted produce + delivery fee, to the cent.
    expect(paidIn - refunded).toBe(30 * 5500 + after.deliveryFee);
  });

  it('QA-006 weekly invoice bills the accepted quantity, not the ordered quantity', async () => {
    const restaurant = await emailUser(app, undefined, 'Credit Restaurant');
    const org = await onboardBuyer(app, restaurant, 'Credit Restaurant Ltd');
    await call(app, admin, 'POST', `/v1/admin/orgs/${org}/verify`, {
      verified: true,
      paymentTerms: 'NET_14',
      creditLimit: 10_000_000,
    });
    const order = (await call(app, restaurant, 'POST', '/v1/orders', { listingId, quantity: 100 })).body;
    await call(app, farmer, 'POST', `/v1/orders/${order.id}/confirm`);
    await call(app, farmer, 'POST', `/v1/orders/${order.id}/ready`);
    const item = await app.prisma.orderItem.findFirstOrThrow({ where: { orderId: order.id } });
    await call(app, qa, 'POST', '/v1/qa/inspections', {
      orderItemId: item.id,
      grade: 'A',
      passed: true,
      acceptedQty: 80,
      rejectedQty: 20,
    });
    await adminWalk(app, admin, order.id, ['IN_TRANSIT', 'DELIVERED']);
    await call(app, restaurant, 'POST', `/v1/orders/${order.id}/confirm-receipt`);
    expect(await generateInvoices(app.prisma)).toBeGreaterThanOrEqual(1);
    const inv = (await call(app, restaurant, 'GET', '/v1/invoices')).body.items.find(
      (i: { id: string }) => i.id === (order as { invoiceId?: string }).invoiceId || true,
    );
    const after = await app.prisma.order.findUniqueOrThrow({
      where: { id: order.id },
      include: { invoice: true },
    });
    expect(after.invoice?.total).toBe(80 * 5500 + after.deliveryFee);
    void inv;
  });

  it('QA-007 onboarding as a buyer twice does not create a second organization', async () => {
    const twice = await emailUser(app, undefined, 'Retry Hotel');
    await onboardBuyer(app, twice, 'Retry Hotel');
    const again = await call(app, twice, 'POST', '/v1/onboarding/buyer', {
      businessName: 'Retry Hotel',
      buyerCategory: 'HOTEL',
      county: 'Nairobi',
    });
    // A retried request (dropped connection, no idempotency key) must not duplicate the business.
    expect([200, 409]).toContain(again.status);
    expect(await app.prisma.member.count({ where: { userId: twice.userId } })).toBe(1);
    // and a fresh session (no active org) still works everywhere
    const fresh = await app.inject({
      method: 'POST',
      url: '/api/auth/sign-in/email',
      headers: { origin: 'http://localhost:3000' },
      payload: {
        email: (await app.prisma.user.findUniqueOrThrow({ where: { id: twice.userId } })).email,
        password: 'correct-horse-battery',
      },
    });
    const token = (fresh.json() as { token: string }).token;
    const r = await app.inject({
      method: 'GET',
      url: '/v1/demand',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(r.statusCode).toBe(200);
  });

  it('QA-008 a farmer who registers a green-input enterprise can list products', async () => {
    const f = await phoneUser(app, nextPhone());
    await call(app, f, 'POST', '/v1/onboarding/farmer', { name: 'Amina Hassan', county: 'Kiambu' });
    const sup = await call(app, f, 'POST', '/v1/onboarding/supplier', {
      businessName: 'Amina Compost',
      county: 'Kiambu',
    });
    expect(sup.status).toBe(201);
    const p = await call(app, f, 'POST', '/v1/inputs', {
      name: 'Goat manure 50kg',
      category: 'COMPOST',
      unit: 'BAG',
      pricePerUnit: 50_000,
      stock: 10,
      county: 'Kiambu',
    });
    expect(p.status).toBe(201);
    expect((await call(app, f, 'GET', '/v1/orgs/current')).status).toBe(200);
  });

  it('QA-009 creating an organization through Better Auth does not lock a buyer out of their business', async () => {
    const b = await emailUser(app, undefined, 'Side Org Hotel');
    await onboardBuyer(app, b, 'Side Org Hotel');
    const created = await app.inject({
      method: 'POST',
      url: '/api/auth/organization/create',
      headers: { ...b.headers },
      payload: { name: 'Shadow', slug: `shadow-${Date.now()}` },
    });
    // Either the platform refuses raw organization creation, or it does not switch the active org.
    if (created.statusCode === 200) {
      expect((await call(app, b, 'GET', '/v1/demand')).status).toBe(200);
    } else {
      expect([400, 403]).toContain(created.statusCode);
    }
  });

  it('QA-010 phone OTP accepts the local 07XX format the rest of the API accepts', async () => {
    const r = await app.inject({
      method: 'POST',
      url: '/api/auth/phone-number/send-otp',
      headers: { origin: 'http://localhost:3000' },
      payload: { phoneNumber: '0711000001' },
    });
    expect(r.statusCode).toBe(200);
  });

  it('QA-011 guard: platform settings are validated (a non-numeric commission must be rejected)', async () => {
    const r = await call(app, admin, 'PUT', '/v1/admin/settings/commissionBps', { value: 'abc' });
    expect(r.status).toBe(400);
    const neg = await call(app, admin, 'PUT', '/v1/admin/settings/deliveryFeeCents', { value: -1 });
    expect(neg.status).toBe(400);
  });

  it('QA-012 an STK callback for less than the requested amount does not mark the order paid', async () => {
    const order = (await call(app, buyer, 'POST', '/v1/orders', { listingId, quantity: 2 })).body;
    const pay = await call(app, buyer, 'POST', `/v1/orders/${order.id}/pay`, { phoneNumber: '0712000111' });
    const payment = await app.prisma.payment.findUniqueOrThrow({ where: { id: pay.body.paymentId } });
    await app.inject({
      method: 'POST',
      url: '/webhooks/mpesa/stk?token=test-callback-token',
      payload: {
        Body: {
          stkCallback: {
            MerchantRequestID: payment.merchantRequestId,
            CheckoutRequestID: payment.checkoutRequestId,
            ResultCode: 0,
            ResultDesc: 'ok',
            CallbackMetadata: {
              Item: [
                { Name: 'Amount', Value: 1 },
                { Name: 'MpesaReceiptNumber', Value: `UNDER${Date.now()}` },
              ],
            },
          },
        },
      },
    });
    const after = await app.prisma.order.findUniqueOrThrow({ where: { id: order.id } });
    expect(after.paymentStatus).not.toBe('PAID');
  });

  it('QA-013 an idempotency key is scoped to the route it was first used on', async () => {
    const headers = { 'idempotency-key': `qa-scope-${Date.now()}` };
    const order = await call(app, buyer, 'POST', '/v1/orders', { listingId, quantity: 1 }, headers);
    expect(order.status).toBe(201);
    const demand = await call(
      app,
      buyer,
      'POST',
      '/v1/demand',
      { produceId: await produceId(app, 'kale'), quantity: 5, neededBy: days(3) },
      headers,
    );
    // Today the order's stored response is replayed for a completely different endpoint.
    expect(demand.body.code).toBeUndefined();
    expect([201, 409, 422]).toContain(demand.status);
  });

  it('QA-014 money fields that do not fit a 32-bit integer are rejected with 400, not 500', async () => {
    const farm = (await call(app, farmer, 'GET', '/v1/farms')).body[0];
    const r = await call(app, farmer, 'POST', '/v1/supply', {
      farmId: farm.id,
      produceId: await produceId(app, 'kale'),
      quantity: 10,
      pricePerUnit: 3_000_000_000,
      availableFrom: days(0),
      availableTo: days(5),
    });
    expect(r.status).toBe(400);
    const d = await call(app, buyer, 'POST', '/v1/demand', {
      produceId: await produceId(app, 'kale'),
      quantity: 1,
      neededBy: days(2),
      maxPricePerUnit: 5_000_000_000,
    });
    expect(d.status).toBe(400);
  });

  it('QA-015 a listing quantity below the stored precision is rejected instead of creating an empty listing', async () => {
    const farm = (await call(app, farmer, 'GET', '/v1/farms')).body[0];
    const r = await call(app, farmer, 'POST', '/v1/supply', {
      farmId: farm.id,
      produceId: await produceId(app, 'kale'),
      quantity: 0.001,
      pricePerUnit: 1000,
      availableFrom: days(0),
      availableTo: days(5),
    });
    expect(r.status).toBe(400);
  });

  it('QA-016 /v1/admin/audit rejects a non-numeric cursor with 400', async () => {
    const r = await call(app, admin, 'GET', '/v1/admin/audit?cursor=abc');
    expect(r.status).toBe(400);
  });

  it('QA-017 supply search honours the from date and combines upcoming with to', async () => {
    const all = await call(app, buyer, 'GET', '/v1/supply');
    const future = await call(app, buyer, 'GET', `/v1/supply?from=${days(60)}`);
    expect(all.body.items.length).toBeGreaterThan(0);
    expect(future.body.items).toHaveLength(0);
  });

  it("QA-018 drivers and agents cannot fetch other people's KYC documents", async () => {
    const driver = await emailUser(app, 'driver');
    const r = await call(app, driver, 'POST', '/v1/uploads/url', { key: `kyc/${farmer.userId}/id.pdf` });
    expect(r.status).toBe(403);
  });

  it('QA-019 guard: a partial refund reduces the farmer payout and no payout is sent while the dispute window is open', async () => {
    // Passes on current code. The stale dev worker paid farmers before settlement and ignored refunds;
    // this guards the escrow rule end to end through HTTP and the outbox.
    const b = await freshBuyer(app, 'Escrow Hotel');
    const order = await paidOrder(app, b, farmer, listingId, 20); // 110000 + 30000
    await adminWalk(app, admin, order.id, ['READY_FOR_QA', 'QA_PASSED', 'IN_TRANSIT', 'DELIVERED']);
    await drainAll(app);
    expect(await app.prisma.payout.findUnique({ where: { orderId: order.id } })).toBeNull();
    const d = await call(app, b, 'POST', `/v1/orders/${order.id}/dispute`, {
      reason: 'QUANTITY',
      description: 'Only 15 of 20 kg arrived, rest missing',
    });
    expect(d.status).toBe(201);
    const res = await call(app, admin, 'POST', `/v1/admin/disputes/${d.body.id}/resolve`, {
      outcome: 'REFUND',
      refundAmount: 5 * 5500,
      resolution: '5 kg missing refunded',
    });
    expect(res.status).toBe(200);
    await drainAll(app);
    const payout = await app.prisma.payout.findUniqueOrThrow({ where: { orderId: order.id } });
    expect(payout.grossAmount).toBe(20 * 5500 - 5 * 5500);
    expect(payout.grossAmount + 5 * 5500 + order.deliveryFee).toBe(order.total);
    void buyerOrg;
  });

  it('QA-026b a supplier cannot give its own profile a buyer category', async () => {
    const supplier = await emailUser(app, undefined, 'Category Supplier');
    await call(app, supplier, 'POST', '/v1/onboarding/supplier', {
      businessName: 'Category Compost',
      county: 'Kiambu',
    });
    const r = await call(app, supplier, 'PATCH', '/v1/orgs/current', { buyerCategory: 'HOTEL' });
    expect(r.status).toBe(400);
    const profile = await app.prisma.orgProfile.findFirstOrThrow({
      where: { organization: { members: { some: { userId: supplier.userId } } } },
    });
    expect(profile.buyerCategory).toBeNull();
  });
});
