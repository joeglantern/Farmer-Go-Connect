import type { InspectionInput } from '@farmgo/contracts';
import { type DB, num, type QualityInspection } from '@farmgo/db';
import { AppError, Errors } from '../errors.js';
import { emit } from '../outbox.js';
import { commissionFor, lineTotal } from './money.js';
import { transitionOrder } from './order-machine.js';
import { refundExcess } from './refunds.js';
import { getSetting } from './settings.js';

/**
 * Record a QA inspection for one order item. When every item on the order has been
 * inspected, the order moves to QA_PASSED (if anything was accepted) or QA_REJECTED,
 * and the accepted value is stored for the farmer's payout.
 */
export async function recordInspection(
  tx: DB,
  input: InspectionInput,
  inspectorId: string,
  actor: 'qa' | 'admin' = 'qa',
): Promise<{ inspection: QualityInspection; orderStatus: string }> {
  const item = await tx.orderItem.findUnique({
    where: { id: input.orderItemId },
    include: { order: { include: { items: { include: { inspection: true } } } }, inspection: true },
  });
  if (!item) throw Errors.notFound('Order item');
  if (item.order.status !== 'READY_FOR_QA') {
    throw new AppError(
      'ORDER_NOT_READY_FOR_QA',
      `Order ${item.order.code} is ${item.order.status}, not ready for inspection`,
      409,
    );
  }
  if (item.inspection) throw Errors.conflict('ALREADY_INSPECTED', 'This item has already been inspected');

  const ordered = num(item.quantity);
  if (input.acceptedQty + input.rejectedQty > ordered + 0.001) {
    throw Errors.badRequest(
      'QA_QTY_EXCEEDS_ORDER',
      `Accepted plus rejected cannot exceed the ordered ${ordered}`,
    );
  }
  if (!input.passed && input.acceptedQty > 0) {
    throw Errors.badRequest('QA_FAILED_WITH_ACCEPTED', 'A failed inspection cannot accept any quantity');
  }

  const inspection = await tx.qualityInspection.create({
    data: {
      orderItemId: item.id,
      inspectorId,
      grade: input.grade,
      passed: input.passed,
      acceptedQty: input.acceptedQty,
      rejectedQty: input.passed ? input.rejectedQty : ordered,
      rejectReason: input.rejectReason,
      checklist: input.checklist,
      notes: input.notes,
      photos: input.photos,
      location: input.location,
    },
  });
  await emit(
    tx,
    'qa.completed',
    { orderId: item.orderId, orderItemId: item.id, passed: input.passed, inspectorId },
    item.orderId,
  );

  const others = item.order.items.filter((i) => i.id !== item.id);
  const allDone = others.every((i) => i.inspection);
  if (!allDone) return { inspection, orderStatus: item.order.status };

  const inspections = [...others.map((i) => ({ item: i, insp: i.inspection! })), { item, insp: inspection }];
  const accepted = inspections.reduce(
    (s, x) => s + (x.insp.passed ? lineTotal(num(x.insp.acceptedQty), x.item.pricePerUnit) : 0),
    0,
  );
  const anyAccepted = inspections.some((x) => x.insp.passed && num(x.insp.acceptedQty) > 0);

  // The buyer is charged for what QA accepted plus delivery: the order total follows the accepted
  // value, so an unpaid prepaid order asks for less, an invoice bills less, and a buyer who has
  // already paid is refunded the difference below.
  const order = item.order;
  const partial = anyAccepted && accepted < order.subtotal;
  await tx.order.update({
    where: { id: item.orderId },
    data: {
      acceptedSubtotal: accepted,
      ...(partial
        ? {
            total: accepted + order.deliveryFee,
            commission: commissionFor(accepted, await getSetting(tx, 'commissionBps')),
          }
        : {}),
    },
  });
  const next = await transitionOrder(tx, {
    orderId: item.orderId,
    to: anyAccepted ? 'QA_PASSED' : 'QA_REJECTED',
    actor,
    actorId: inspectorId,
    note: anyAccepted
      ? `Inspection passed (accepted value ${accepted / 100} KES)`
      : (input.rejectReason ?? 'Inspection failed'),
  });
  if (partial) await refundExcess(tx, item.orderId, 'Part of the order failed inspection');
  return { inspection, orderStatus: next.status };
}
