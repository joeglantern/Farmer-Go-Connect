import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  call,
  closeApp,
  days,
  drainOutbox,
  emailUser,
  makeApp,
  nextPhone,
  phoneUser,
  produceId,
  type Session,
} from './helpers.js';
import { checkStkStatus, drainAll, executePayout, generateInvoices } from './settlement-helpers.js';

/** Walks an order to DELIVERED using admin actions (QA and logistics are covered in flow.test.ts). */
async function deliver(app: FastifyInstance, admin: Session, orderId: string) {
  for (const to of ['READY_FOR_QA', 'QA_PASSED', 'IN_TRANSIT', 'DELIVERED']) {
    const r = await call(app, admin, 'POST', `/v1/orders/${orderId}/transition`, { to });
    expect(r.status).toBe(200);
  }
}

describe('settlement: disputes, refunds, invoices and the dispute window', () => {
  let app: FastifyInstance;
  let admin: Session;
  let hotel: Session;
  let restaurant: Session;
  let farmer: Session;
  let listingId: string;
  let restaurantOrg: string;

  beforeAll(async () => {
    app = await makeApp();
    admin = await emailUser(app, 'admin');
    hotel = await emailUser(app);
    restaurant = await emailUser(app);
    farmer = await phoneUser(app, nextPhone());
    await call(app, hotel, 'POST', '/v1/onboarding/buyer', {
      businessName: 'Prepaid Hotel',
      buyerCategory: 'HOTEL',
      county: 'Nairobi',
    });
    restaurantOrg = (
      await call(app, restaurant, 'POST', '/v1/onboarding/buyer', {
        businessName: 'Credit Restaurant',
        buyerCategory: 'RESTAURANT',
        county: 'Nairobi',
      })
    ).body.organization.id;
    await call(app, admin, 'POST', `/v1/admin/orgs/${restaurantOrg}/verify`, {
      verified: true,
      paymentTerms: 'NET_14',
      creditLimit: 10_000_000,
    });
    await call(app, farmer, 'POST', '/v1/onboarding/farmer', {
      name: 'Faith Achieng',
      county: "Murang'a",
      farm: { name: 'Achieng Agri', county: "Murang'a" },
    });
    const farm = (await call(app, farmer, 'GET', '/v1/farms')).body[0];
    listingId = (
      await call(app, farmer, 'POST', '/v1/supply', {
        farmId: farm.id,
        produceId: await produceId(app, 'avocados'),
        quantity: 5000,
        pricePerUnit: 1500,
        availableFrom: days(0),
        availableTo: days(10),
      })
    ).body.id;
  });
  afterAll(async () => closeApp(app));

  it('a buyer disputes a delivered prepaid order and gets a partial refund', async () => {
    const order = (await call(app, hotel, 'POST', '/v1/orders', { listingId, quantity: 400 })).body;
    await call(app, farmer, 'POST', `/v1/orders/${order.id}/confirm`);
    const pay = await call(app, hotel, 'POST', `/v1/orders/${order.id}/pay`, { phoneNumber: '0722111222' });
    await checkStkStatus(app.prisma, pay.body.paymentId);
    await deliver(app, admin, order.id);

    const d = await call(app, hotel, 'POST', `/v1/orders/${order.id}/dispute`, {
      reason: 'QUALITY',
      description: '40 avocados were overripe and bruised on arrival',
    });
    expect(d.status).toBe(201);
    await drainOutbox(app);
    expect(await app.prisma.payout.findUnique({ where: { orderId: order.id } })).toBeNull(); // payout held

    const refund = 40 * 1500;
    const res = await call(app, admin, 'POST', `/v1/admin/disputes/${d.body.id}/resolve`, {
      outcome: 'REFUND',
      refundAmount: refund,
      resolution: 'Refund for 40 bruised avocados',
    });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('RESOLVED_REFUND');

    const after = await app.prisma.order.findUniqueOrThrow({ where: { id: order.id } });
    expect(after.status).toBe('PAID');
    expect(after.paymentStatus).toBe('PARTIALLY_REFUNDED');
    await drainAll(app);
    const payout = await app.prisma.payout.findUniqueOrThrow({ where: { orderId: order.id } });
    expect(payout.grossAmount).toBe(400 * 1500 - refund); // the farmer bears the quality refund
  });

  it('closes the dispute window once the buyer confirms receipt', async () => {
    const order = (await call(app, hotel, 'POST', '/v1/orders', { listingId, quantity: 10 })).body;
    await call(app, farmer, 'POST', `/v1/orders/${order.id}/confirm`);
    await deliver(app, admin, order.id);
    await call(app, hotel, 'POST', `/v1/orders/${order.id}/confirm-receipt`);
    const late = await call(app, hotel, 'POST', `/v1/orders/${order.id}/dispute`, {
      reason: 'LATE',
      description: 'Trying to dispute after confirming',
    });
    expect(late.status).toBe(409);
    expect(late.body.error.code).toBe('DISPUTE_WINDOW_CLOSED');
    // Not paid yet, so it stays DELIVERED until payment arrives.
    expect((await app.prisma.order.findUniqueOrThrow({ where: { id: order.id } })).status).toBe('DELIVERED');
  });

  it('settles automatically after the dispute window without buyer action', async () => {
    const order = (await call(app, hotel, 'POST', '/v1/orders', { listingId, quantity: 10 })).body;
    await call(app, farmer, 'POST', `/v1/orders/${order.id}/confirm`);
    const pay = await call(app, hotel, 'POST', `/v1/orders/${order.id}/pay`, { phoneNumber: '0722111333' });
    await checkStkStatus(app.prisma, pay.body.paymentId);
    await deliver(app, admin, order.id);
    await app.prisma.order.update({
      where: { id: order.id },
      data: { deliveredAt: new Date(Date.now() - 49 * 3600_000) },
    });
    const { settleDeliveredOrders } = await import('@farmgo/core');
    expect(await settleDeliveredOrders(app.prisma)).toBeGreaterThanOrEqual(1);
    expect((await app.prisma.order.findUniqueOrThrow({ where: { id: order.id } })).status).toBe('PAID');
  });

  it('bills a credit-terms buyer on a weekly invoice and settles when it is paid', async () => {
    const order = (await call(app, restaurant, 'POST', '/v1/orders', { listingId, quantity: 100 })).body;
    expect(order.paymentTerms).toBe('NET_14');
    const payNow = await call(app, restaurant, 'POST', `/v1/orders/${order.id}/pay`, {});
    expect(payNow.body.error.code).toBe('ORDER_ON_INVOICE');
    await call(app, farmer, 'POST', `/v1/orders/${order.id}/confirm`);
    await deliver(app, admin, order.id);
    await call(app, restaurant, 'POST', `/v1/orders/${order.id}/confirm-receipt`);

    expect(await generateInvoices(app.prisma)).toBeGreaterThanOrEqual(1);
    const invoices = await call(app, restaurant, 'GET', '/v1/invoices');
    const inv = invoices.body.items[0];
    expect(inv.status).toBe('ISSUED');
    expect(inv.total).toBe(100 * 1500 + 30_000);
    expect(new Date(inv.dueAt).getTime() - new Date(inv.issuedAt).getTime()).toBe(14 * 86_400_000);

    const pay = await call(app, restaurant, 'POST', `/v1/invoices/${inv.id}/pay`, {
      phoneNumber: '0733444555',
    });
    expect(pay.status).toBe(202);
    await checkStkStatus(app.prisma, pay.body.paymentId);
    expect((await app.prisma.invoice.findUniqueOrThrow({ where: { id: inv.id } })).status).toBe('PAID');
    expect((await app.prisma.order.findUniqueOrThrow({ where: { id: order.id } })).status).toBe('PAID');
    await drainAll(app);
    await executePayout(app.prisma, order.id);
    expect((await app.prisma.payout.findUniqueOrThrow({ where: { orderId: order.id } })).status).toBe(
      'SUCCESS',
    );
  });

  it('QA rejection sends the demand back to matching', async () => {
    // A produce only this test lists, so no other test file's listing can win the match
    // (the USSD test lists the first catalog item, avocados, which made this test flaky).
    const crop = (
      await call(app, admin, 'POST', '/v1/produce', {
        slug: `settlement-crop-${Date.now()}`,
        name: `Settlement crop ${Date.now()}`,
        nameSw: 'Zao la majaribio',
        category: 'FRUIT',
        unit: 'KG',
      })
    ).body;
    const farmId = (await call(app, farmer, 'GET', '/v1/farms')).body[0].id;
    await call(app, farmer, 'POST', '/v1/supply', {
      farmId,
      produceId: crop.id,
      quantity: 500,
      pricePerUnit: 1500,
      availableFrom: days(0),
      availableTo: days(10),
    });
    const demand = (
      await call(app, hotel, 'POST', '/v1/demand', {
        produceId: crop.id,
        quantity: 50,
        neededBy: days(3),
      })
    ).body;
    await drainOutbox(app);
    const { matchDemand, recordInspection } = await import('@farmgo/core');
    const [match] = await matchDemand(app.prisma, demand.id);
    await call(app, hotel, 'POST', `/v1/matches/${match!.id}/accept`);
    const { orderId } = (await call(app, farmer, 'POST', `/v1/matches/${match!.id}/accept`)).body;
    expect((await app.prisma.demandRequest.findUniqueOrThrow({ where: { id: demand.id } })).status).toBe(
      'FILLED',
    );
    await call(app, farmer, 'POST', `/v1/orders/${orderId}/ready`);
    const item = await app.prisma.orderItem.findFirstOrThrow({ where: { orderId } });
    const qa = await emailUser(app, 'qa_officer');
    await app.prisma.$transaction((tx) =>
      recordInspection(
        tx,
        {
          orderItemId: item.id,
          grade: 'C',
          passed: false,
          acceptedQty: 0,
          rejectedQty: 50,
          rejectReason: 'Anthracnose spots',
          photos: [],
          location: 'FARM_GATE',
        },
        qa.userId,
      ),
    );
    expect((await app.prisma.order.findUniqueOrThrow({ where: { id: orderId } })).status).toBe('QA_REJECTED');
    expect((await app.prisma.demandRequest.findUniqueOrThrow({ where: { id: demand.id } })).status).toBe(
      'OPEN',
    );
  });
});
