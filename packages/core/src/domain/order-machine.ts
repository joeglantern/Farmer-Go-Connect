import { allowedTransitions, canTransition, type OrderStatus, type TransitionActor } from '@farmgo/contracts';
import { type DB, num, type Order } from '@farmgo/db';
import { AppError, Errors } from '../errors.js';
import { emit } from '../outbox.js';
import { audit } from './audit.js';
import { releaseListing, unfillDemand } from './inventory.js';
import { refundExcess } from './refunds.js';
import { getSetting } from './settings.js';

export interface TransitionArgs {
  orderId: string;
  to: OrderStatus;
  actor: TransitionActor;
  actorId?: string | null;
  note?: string;
  /** Optimistic lock: fail if the order changed since the caller read it. */
  expectedVersion?: number;
  /**
   * The one step back: READY_FOR_QA to CONFIRMED when the farmer undoes "harvest ready". Only
   * undoHarvestReady sets it, so no ordinary action (confirm, USSD, transition) can move an order back.
   */
  harvestUndo?: boolean;
}

/**
 * The only way an order's status changes. Validates the transition against the shared state
 * machine, applies it with optimistic locking, records history and an audit entry, runs the
 * inventory side effects, and emits `order.status_changed`. Must run inside a transaction.
 */
export async function transitionOrder(tx: DB, args: TransitionArgs): Promise<Order> {
  const order = await tx.order.findUnique({
    where: { id: args.orderId },
    include: {
      items: { include: { match: true, inspection: { select: { id: true } } } },
      buyerOrg: { include: { profile: true } },
    },
  });
  if (!order) throw Errors.notFound('Order');

  const from = order.status as OrderStatus;
  const stepBack =
    args.harvestUndo === true &&
    from === 'READY_FOR_QA' &&
    args.to === 'CONFIRMED' &&
    (args.actor === 'farmer' || args.actor === 'admin');
  if (!stepBack && !canTransition(from, args.to, args.actor)) {
    throw new AppError(
      'ORDER_INVALID_TRANSITION',
      `Cannot move order ${order.code} from ${from} to ${args.to}`,
      409,
      { from, to: args.to, allowed: allowedTransitions(from, args.actor) },
    );
  }
  if (from === 'READY_FOR_QA' && args.to === 'CONFIRMED' && order.items.some((i) => i.inspection)) {
    throw Errors.conflict(
      'HARVEST_ALREADY_IN_QA',
      `Order ${order.code} has already been inspected and cannot go back to waiting for the harvest`,
    );
  }
  if (args.expectedVersion !== undefined && args.expectedVersion !== order.version) {
    throw Errors.conflict('ORDER_STALE', 'This order was updated by someone else. Refresh and try again.');
  }

  const updated = await tx.order.updateMany({
    where: { id: order.id, version: order.version },
    data: {
      status: args.to,
      version: { increment: 1 },
      ...(args.to === 'CANCELLED' && args.note ? { cancelReason: args.note } : {}),
      ...(args.to === 'DELIVERED' && !order.deliveredAt ? { deliveredAt: new Date() } : {}),
    },
  });
  if (updated.count !== 1) {
    throw Errors.conflict('ORDER_STALE', 'This order was updated by someone else. Refresh and try again.');
  }

  // Inventory side effects.
  if (args.to === 'CANCELLED') {
    for (const item of order.items) {
      await releaseListing(tx, item.listingId, num(item.quantity));
      if (item.match) await unfillDemand(tx, item.match.demandId, num(item.quantity));
    }
  }
  if (args.to === 'QA_REJECTED') {
    // Produce failed inspection: the demand needs another supplier.
    for (const item of order.items) {
      if (item.match) await unfillDemand(tx, item.match.demandId, num(item.quantity));
    }
  }

  // The buyer owes nothing for produce that never reaches them: refund whatever they paid.
  if (args.to === 'CANCELLED' || args.to === 'QA_REJECTED') {
    await refundExcess(
      tx,
      order.id,
      args.to === 'CANCELLED' ? `Order cancelled: ${args.note ?? ''}`.trim() : 'Produce failed inspection',
    );
  }

  await tx.orderEvent.create({
    data: { orderId: order.id, from, to: args.to, actorId: args.actorId ?? null, note: args.note },
  });
  await audit(tx, {
    actorId: args.actorId,
    action: 'order.transition',
    entity: 'Order',
    entityId: order.id,
    before: { status: from },
    after: { status: args.to, actor: args.actor, note: args.note },
  });
  await emit(
    tx,
    'order.status_changed',
    {
      orderId: order.id,
      code: order.code,
      buyerOrgId: order.buyerOrgId,
      farmerId: order.farmerId,
      from,
      to: args.to,
      county: order.buyerOrg.profile?.county,
    },
    order.id,
  );
  if (args.to === 'DELIVERED') {
    await emit(tx, 'payout.requested', { orderId: order.id }, order.id);
  }

  return tx.order.findUniqueOrThrow({ where: { id: order.id } });
}

/**
 * Whether the buyer can no longer dispute a delivered order: they confirmed receipt, or the
 * dispute window since delivery has passed.
 */
export async function disputeWindowClosed(
  db: DB,
  order: { deliveredAt: Date | null; receiptConfirmedAt: Date | null },
  now = new Date(),
): Promise<boolean> {
  if (order.receiptConfirmedAt) return true;
  if (!order.deliveredAt) return false;
  const hours = await getSetting(db, 'disputeWindowHours');
  return now.getTime() - order.deliveredAt.getTime() >= hours * 3600_000;
}

/**
 * Settle a DELIVERED order (move it to PAID) once the buyer has paid AND can no longer
 * dispute it. Until then the buyer's money is held, like escrow. Returns true if settled.
 */
export async function settleOrderIfComplete(
  tx: DB,
  orderId: string,
  actorId?: string | null,
): Promise<boolean> {
  const order = await tx.order.findUnique({ where: { id: orderId } });
  if (order?.status !== 'DELIVERED') return false;
  if (order.paymentStatus !== 'PAID' && order.paymentStatus !== 'PARTIALLY_REFUNDED') return false;
  if (!(await disputeWindowClosed(tx, order))) return false;
  await transitionOrder(tx, {
    orderId,
    to: 'PAID',
    actor: 'system',
    actorId,
    note: 'Payment released to farmer',
  });
  await emit(tx, 'payout.requested', { orderId }, orderId);
  return true;
}
