import { checkStkStatus, executeInputPayout, settleInputOrders } from '@farmgo/core';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { call, closeApp, emailUser, makeApp, nextPhone, phoneUser, type Session } from './helpers.js';

/** QA-024: green-input orders are paid up front, held, and paid out to the supplier like produce. */
describe('green-input order escrow', () => {
  let app: FastifyInstance;
  let admin: Session;
  let supplier: Session;
  let productId: string;
  let n = 0;

  /** A farmer who pays by M-Pesa (their own number, so each test has its own rate limit). */
  const buyer = async () => {
    const f = await phoneUser(app, nextPhone());
    await call(app, f, 'POST', '/v1/onboarding/farmer', { name: `Input Buyer ${++n}`, county: 'Kiambu' });
    return f;
  };
  const order = async (b: Session, quantity = 2) => {
    const r = await call(app, b, 'POST', `/v1/inputs/${productId}/order`, {
      quantity,
      phoneNumber: '0712345678',
    });
    expect(r.status).toBe(201);
    return r.body;
  };
  const pay = async (o: { payment: { paymentId: string } }) =>
    checkStkStatus(app.prisma, o.payment.paymentId);
  const move = (s: Session, id: string, to: string) =>
    call(app, s, 'POST', `/v1/input-orders/${id}/transition`, { to });

  beforeAll(async () => {
    app = await makeApp();
    admin = await emailUser(app, 'admin');
    supplier = await emailUser(app, undefined, 'Compost Youth');
    await call(app, supplier, 'POST', '/v1/onboarding/supplier', {
      businessName: 'Escrow Compost',
      county: 'Kiambu',
      phone: '0722333444',
    });
    productId = (
      await call(app, supplier, 'POST', '/v1/inputs', {
        name: 'Vermicompost 25kg',
        category: 'COMPOST',
        unit: 'BAG',
        pricePerUnit: 60_000,
        stock: 100,
        county: 'Kiambu',
      })
    ).body.id;
  });
  afterAll(async () => closeApp(app));

  it('charges the buyer by M-Pesa when ordering and refuses self-orders', async () => {
    const b = await buyer();
    const o = await order(b);
    expect(o.payment.status).toBe('PENDING');
    expect(o.paymentStatus).toBe('PENDING');
    await pay(o);
    const after = await app.prisma.inputOrder.findUniqueOrThrow({ where: { id: o.id } });
    expect(after.paymentStatus).toBe('PAID');

    const self = await call(app, supplier, 'POST', `/v1/inputs/${productId}/order`, { quantity: 1 });
    expect(self.body.error.code).toBe('SELF_ORDER');
  });

  it('does not let the supplier dispatch before the buyer has paid', async () => {
    const b = await buyer();
    const r = await call(app, b, 'POST', `/v1/inputs/${productId}/order`, {
      quantity: 1,
      phoneNumber: '0712000999',
    });
    await checkStkStatus(app.prisma, r.body.payment.paymentId); // 999 fails in the mock
    await move(supplier, r.body.id, 'ACCEPTED');
    const d = await move(supplier, r.body.id, 'DISPATCHED');
    expect(d.body.error.code).toBe('INPUT_ORDER_UNPAID');
    const retry = await call(app, b, 'POST', `/v1/input-orders/${r.body.id}/pay`, {
      phoneNumber: '0712345678',
    });
    expect(retry.status).toBe(202);
    await checkStkStatus(app.prisma, retry.body.paymentId);
    expect((await move(supplier, r.body.id, 'DISPATCHED')).status).toBe(200);
  });

  it('refunds the buyer when the supplier declines a paid order, and restores stock', async () => {
    const b = await buyer();
    const before = Number(
      (await app.prisma.inputProduct.findUniqueOrThrow({ where: { id: productId } })).stock,
    );
    const o = await order(b, 3);
    await pay(o);
    expect((await move(supplier, o.id, 'REJECTED')).status).toBe(200);
    const after = await app.prisma.inputOrder.findUniqueOrThrow({
      where: { id: o.id },
      include: { payments: true },
    });
    expect(after.paymentStatus).toBe('REFUNDED');
    expect(after.payments.filter((p) => p.direction === 'OUT').reduce((s, p) => s + p.amount, 0)).toBe(
      3 * 60_000,
    );
    const stock = Number(
      (await app.prisma.inputProduct.findUniqueOrThrow({ where: { id: productId } })).stock,
    );
    expect(stock).toBe(before);
  });

  it('pays the supplier (minus commission) once the buyer confirms delivery', async () => {
    const b = await buyer();
    const o = await order(b, 2);
    await pay(o);
    await move(supplier, o.id, 'ACCEPTED');
    await move(supplier, o.id, 'DISPATCHED');
    expect(await settleInputOrders(app.prisma)).toBe(0); // window still open, not confirmed
    expect((await move(b, o.id, 'DELIVERED')).body.receiptConfirmedAt).toBeTruthy();
    await settleInputOrders(app.prisma);
    const payout = await app.prisma.payout.findUniqueOrThrow({ where: { inputOrderId: o.id } });
    expect(payout.grossAmount).toBe(120_000);
    expect(payout.commission).toBe(Math.round(120_000 * 0.08));
    expect(payout.phoneNumber).toBe('+254722333444');
    expect(payout.farmerId).toBe(supplier.userId);
    await executeInputPayout(app.prisma, o.id);
    expect((await app.prisma.payout.findUniqueOrThrow({ where: { inputOrderId: o.id } })).status).toBe(
      'SUCCESS',
    );
  });

  it('completes on its own when the window after dispatch closes', async () => {
    const b = await buyer();
    const o = await order(b, 1);
    await pay(o);
    await move(supplier, o.id, 'ACCEPTED');
    await move(supplier, o.id, 'DISPATCHED');
    await app.prisma.inputOrder.update({
      where: { id: o.id },
      data: { dispatchedAt: new Date(Date.now() - 49 * 3600_000) },
    });
    await settleInputOrders(app.prisma);
    const after = await app.prisma.inputOrder.findUniqueOrThrow({
      where: { id: o.id },
      include: { payout: true },
    });
    expect(after.status).toBe('DELIVERED');
    expect(after.payout?.grossAmount).toBe(60_000);
  });

  it('holds the payout while a reported problem is open, then pays what is left after a refund', async () => {
    const b = await buyer();
    const o = await order(b, 2);
    await pay(o);
    await move(supplier, o.id, 'ACCEPTED');
    await move(supplier, o.id, 'DISPATCHED');
    const dispute = await call(app, b, 'POST', `/v1/input-orders/${o.id}/dispute`, {
      reason: 'QUANTITY',
      description: 'Only one of the two bags arrived',
      photos: [`chat/${b.userId}/one-bag.jpg`],
    });
    expect(dispute.status).toBe(201);
    // Evidence in the private chat bucket: the supplier can open it, other buyers cannot.
    const evidence = `/v1/files/chat/${b.userId}/one-bag.jpg`;
    expect((await call(app, supplier, 'GET', evidence)).status).toBe(302);
    expect((await call(app, await buyer(), 'GET', evidence)).status).toBe(403);
    expect(dispute.body).toMatchObject({ inputOrderId: o.id, orderId: null, status: 'OPEN' });
    await app.prisma.inputOrder.update({
      where: { id: o.id },
      data: { dispatchedAt: new Date(Date.now() - 49 * 3600_000) },
    });
    await settleInputOrders(app.prisma);
    expect(await app.prisma.payout.findUnique({ where: { inputOrderId: o.id } })).toBeNull();

    const listed = await call(app, admin, 'GET', '/v1/admin/disputes?open=true');
    expect(listed.body.items.find((d: any) => d.id === dispute.body.id).inputOrder.product.name).toBe(
      'Vermicompost 25kg',
    );
    const resolved = await call(app, admin, 'POST', `/v1/admin/disputes/${dispute.body.id}/resolve`, {
      outcome: 'REFUND',
      refundAmount: 60_000,
      resolution: 'Refunded the missing bag',
    });
    expect(resolved.status).toBe(200);
    const after = await app.prisma.inputOrder.findUniqueOrThrow({
      where: { id: o.id },
      include: { payout: true },
    });
    expect(after.paymentStatus).toBe('PARTIALLY_REFUNDED');
    expect(after.payout?.grossAmount).toBe(60_000);
  });

  it('closes the problem window once the buyer confirms receipt', async () => {
    const b = await buyer();
    const o = await order(b, 1);
    await pay(o);
    await move(supplier, o.id, 'ACCEPTED');
    await move(supplier, o.id, 'DISPATCHED');
    await move(b, o.id, 'DELIVERED');
    const late = await call(app, b, 'POST', `/v1/input-orders/${o.id}/dispute`, {
      reason: 'QUALITY',
      description: 'Changed my mind about the quality',
      photos: [],
    });
    expect(late.status).toBe(409);
  });
});
