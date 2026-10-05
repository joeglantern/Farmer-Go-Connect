import type { Dispute, PrismaClient } from '@farmgo/db';
import { AppError, Errors } from '../errors.js';
import { emit } from '../outbox.js';
import { enqueue } from '../queues.js';
import { audit } from './audit.js';
import { refundInputOrder, requestInputPayout } from './input-orders.js';
import { settleOrderIfComplete, transitionOrder } from './order-machine.js';
import { refundOrder } from './refunds.js';
import { getSetting } from './settings.js';

export async function raiseDispute(
  prisma: PrismaClient,
  a: {
    orderId: string;
    buyerOrgId: string;
    userId: string;
    reason: string;
    description: string;
    photos: string[];
  },
): Promise<Dispute> {
  return prisma.$transaction(async (tx) => {
    const order = await tx.order.findUnique({ where: { id: a.orderId }, include: { payout: true } });
    if (!order || order.buyerOrgId !== a.buyerOrgId) throw Errors.notFound('Order');
    if (order.status !== 'DELIVERED') {
      throw new AppError(
        'ORDER_NOT_DISPUTABLE',
        'You can only raise a dispute on a delivered order that is not yet settled',
        409,
      );
    }
    if (order.receiptConfirmedAt) {
      throw new AppError(
        'DISPUTE_WINDOW_CLOSED',
        'You confirmed this delivery was fine, so it can no longer be disputed',
        409,
      );
    }
    const windowHours = await getSetting(tx, 'disputeWindowHours');
    const deliveredAt = order.deliveredAt ?? order.updatedAt;
    if (Date.now() - deliveredAt.getTime() > windowHours * 3600_000) {
      throw new AppError(
        'DISPUTE_WINDOW_CLOSED',
        `Disputes must be raised within ${windowHours} hours of delivery`,
        409,
      );
    }
    const dispute = await tx.dispute.create({
      data: {
        orderId: order.id,
        raisedById: a.userId,
        reason: a.reason,
        description: a.description,
        photos: a.photos,
      },
    });
    await transitionOrder(tx, {
      orderId: order.id,
      to: 'DISPUTED',
      actor: 'buyer',
      actorId: a.userId,
      note: a.reason,
    });
    await emit(
      tx,
      'dispute.opened',
      { disputeId: dispute.id, orderId: order.id, buyerOrgId: order.buyerOrgId, farmerId: order.farmerId },
      dispute.id,
    );
    return dispute;
  });
}

/**
 * Admin resolves a dispute. REFUND returns money to the buyer (and reduces the farmer's
 * payout by the same amount); NO_REFUND puts the order back on the normal settlement path.
 */
export async function resolveDispute(
  prisma: PrismaClient,
  a: {
    disputeId: string;
    outcome: 'REFUND' | 'NO_REFUND';
    refundAmount?: number;
    resolution: string;
    adminId: string;
  },
): Promise<Dispute> {
  const head = await prisma.dispute.findUnique({ where: { id: a.disputeId } });
  if (!head) throw Errors.notFound('Dispute');
  if (head.inputOrderId) return resolveInputDispute(prisma, a, head.inputOrderId);
  const result = await prisma.$transaction(async (tx) => {
    const dispute = await tx.dispute.findUnique({ where: { id: a.disputeId }, include: { order: true } });
    if (!dispute) throw Errors.notFound('Dispute');
    if (!['OPEN', 'UNDER_REVIEW'].includes(dispute.status))
      throw Errors.conflict('DISPUTE_CLOSED', 'This dispute is already resolved');
    const order = dispute.order;
    if (!order) throw Errors.notFound('Order');
    let refundId: string | null = null;

    if (a.outcome === 'REFUND') {
      if (!a.refundAmount) throw Errors.badRequest('REFUND_AMOUNT_REQUIRED', 'Enter the refund amount');
      if (order.paymentStatus === 'PAID' || order.paymentStatus === 'PARTIALLY_REFUNDED') {
        const refund = await refundOrder(tx, {
          orderId: order.id,
          amount: a.refundAmount,
          adminId: a.adminId,
          reason: a.resolution,
        });
        refundId = refund.id;
      } else {
        // Not yet paid (invoice buyer): reduce what they owe instead of sending money back.
        await tx.order.update({
          where: { id: order.id },
          data: { total: Math.max(0, order.total - a.refundAmount) },
        });
      }
      const fullRefund = a.refundAmount >= order.total;
      await transitionOrder(tx, {
        orderId: order.id,
        to: fullRefund ? 'REFUNDED' : 'DELIVERED',
        actor: 'admin',
        actorId: a.adminId,
        note: `Dispute resolved with refund: ${a.resolution}`,
      });
    } else {
      await transitionOrder(tx, {
        orderId: order.id,
        to: 'DELIVERED',
        actor: 'admin',
        actorId: a.adminId,
        note: `Dispute closed: ${a.resolution}`,
      });
    }
    // A resolved dispute closes the buyer's window: settle now if the buyer has paid.
    await tx.order.update({ where: { id: order.id }, data: { receiptConfirmedAt: new Date() } });
    await settleOrderIfComplete(tx, order.id, a.adminId);

    const updated = await tx.dispute.update({
      where: { id: dispute.id },
      data: {
        status: a.outcome === 'REFUND' ? 'RESOLVED_REFUND' : 'RESOLVED_NO_REFUND',
        refundAmount: a.refundAmount,
        resolution: a.resolution,
        resolvedById: a.adminId,
        resolvedAt: new Date(),
      },
    });
    await audit(tx, {
      actorId: a.adminId,
      action: 'dispute.resolve',
      entity: 'Dispute',
      entityId: dispute.id,
      after: a,
    });
    await emit(
      tx,
      'dispute.resolved',
      {
        disputeId: dispute.id,
        orderId: order.id,
        buyerOrgId: order.buyerOrgId,
        farmerId: order.farmerId,
        outcome: a.outcome,
      },
      dispute.id,
    );
    if (order.paymentTerms !== 'PREPAID') await emit(tx, 'payout.requested', { orderId: order.id }, order.id);
    return { dispute: updated, refundId };
  });
  if (result.refundId)
    await enqueue(
      'payments',
      'refund',
      { paymentId: result.refundId },
      { jobId: `refund-${result.refundId}` },
    );
  return result.dispute;
}

/**
 * Resolve a problem reported on a green-input order: refund the buyer (any amount up to what they
 * paid) or not, then release the supplier's payout for what remains.
 */
async function resolveInputDispute(
  prisma: PrismaClient,
  a: {
    disputeId: string;
    outcome: 'REFUND' | 'NO_REFUND';
    refundAmount?: number;
    resolution: string;
    adminId: string;
  },
  inputOrderId: string,
): Promise<Dispute> {
  const result = await prisma.$transaction(async (tx) => {
    const dispute = await tx.dispute.findUniqueOrThrow({ where: { id: a.disputeId } });
    if (!['OPEN', 'UNDER_REVIEW'].includes(dispute.status))
      throw Errors.conflict('DISPUTE_CLOSED', 'This dispute is already resolved');
    let refundId: string | null = null;
    if (a.outcome === 'REFUND') {
      if (!a.refundAmount) throw Errors.badRequest('REFUND_AMOUNT_REQUIRED', 'Enter the refund amount');
      refundId = (
        await refundInputOrder(tx, {
          inputOrderId,
          amount: a.refundAmount,
          adminId: a.adminId,
          reason: a.resolution,
        })
      ).id;
    }
    // Resolving closes the buyer's window, so the supplier can be paid what remains.
    await tx.inputOrder.update({
      where: { id: inputOrderId },
      data: { receiptConfirmedAt: new Date(), status: 'DELIVERED', deliveredAt: new Date() },
    });
    const updated = await tx.dispute.update({
      where: { id: dispute.id },
      data: {
        status: a.outcome === 'REFUND' ? 'RESOLVED_REFUND' : 'RESOLVED_NO_REFUND',
        refundAmount: a.refundAmount,
        resolution: a.resolution,
        resolvedById: a.adminId,
        resolvedAt: new Date(),
      },
    });
    await audit(tx, {
      actorId: a.adminId,
      action: 'dispute.resolve',
      entity: 'Dispute',
      entityId: dispute.id,
      after: a,
    });
    return { dispute: updated, refundId };
  });
  if (result.refundId)
    await enqueue(
      'payments',
      'refund',
      { paymentId: result.refundId },
      { jobId: `refund-${result.refundId}` },
    );
  await requestInputPayout(prisma, inputOrderId);
  return result.dispute;
}
