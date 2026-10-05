import type { CrateAction, CrateStatus, ScanCrateInput } from '@farmgo/contracts';
import type { Crate, DB } from '@farmgo/db';
import { AppError, Errors } from '../errors.js';
import { emit } from '../outbox.js';

/** Which statuses each scan action accepts, and the status it moves the crate to. */
export const CRATE_ACTIONS: Record<CrateAction, { from: readonly CrateStatus[]; to: CrateStatus }> = {
  ISSUE_TO_FARMER: { from: ['IN_STOCK'], to: 'WITH_FARMER' },
  LOAD: { from: ['IN_STOCK', 'WITH_FARMER'], to: 'IN_TRANSIT' },
  DELIVER_TO_BUYER: { from: ['IN_TRANSIT'], to: 'WITH_BUYER' },
  RETURN: { from: ['WITH_BUYER', 'IN_TRANSIT', 'WITH_FARMER', 'LOST'], to: 'IN_STOCK' },
  MARK_LOST: { from: ['IN_STOCK', 'WITH_FARMER', 'IN_TRANSIT', 'WITH_BUYER'], to: 'LOST' },
  RETIRE: { from: ['IN_STOCK', 'LOST'], to: 'RETIRED' },
};

/** Record a crate scan and move it through its lifecycle (reusable packaging tracking). */
export async function scanCrate(
  tx: DB,
  input: Omit<ScanCrateInput, 'note'> & { note?: string },
  scannedById: string,
): Promise<Crate> {
  const crate = await tx.crate.findUnique({ where: { qrCode: input.qrCode } });
  if (!crate) throw Errors.notFound(`Crate ${input.qrCode}`);
  const rule = CRATE_ACTIONS[input.action];
  if (!rule.from.includes(crate.status as CrateStatus)) {
    throw new AppError(
      'CRATE_INVALID_SCAN',
      `Crate ${crate.qrCode} is ${crate.status}; cannot ${input.action}`,
      409,
    );
  }

  let holderUserId: string | null = null;
  let holderOrgId: string | null = null;
  if (input.action === 'ISSUE_TO_FARMER') {
    if (!input.toUserId)
      throw Errors.badRequest('CRATE_HOLDER_REQUIRED', 'Choose the farmer receiving the crate');
    holderUserId = input.toUserId;
  } else if (input.action === 'DELIVER_TO_BUYER') {
    holderOrgId = input.toOrgId ?? null;
    if (!holderOrgId && input.orderId) {
      holderOrgId = (await tx.order.findUnique({ where: { id: input.orderId } }))?.buyerOrgId ?? null;
    }
  } else if (input.action === 'LOAD') {
    holderUserId = scannedById;
  }

  const updated = await tx.crate.update({
    where: { id: crate.id },
    data: { status: rule.to, holderUserId, holderOrgId, lastSeenAt: new Date() },
  });
  await tx.crateMovement.create({
    data: {
      crateId: crate.id,
      orderId: input.orderId,
      deliveryId: input.deliveryId,
      from: crate.status,
      to: rule.to,
      scannedById,
      toUserId: holderUserId,
      toOrgId: holderOrgId,
      note: input.note,
    },
  });
  await emit(
    tx,
    'crate.moved',
    { crateId: crate.id, qrCode: crate.qrCode, to: rule.to, orderId: input.orderId },
    crate.id,
  );
  return updated;
}

/** QR payload for new crates: FGC-<base36 time>-<random>. */
export function newCrateCode(): string {
  return `FGC-${Date.now().toString(36).toUpperCase()}-${Math.random().toString(36).slice(2, 7).toUpperCase()}`;
}
