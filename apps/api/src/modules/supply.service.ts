import type { CreateListingInput, UpdateListingInput } from '@farmgo/contracts';
import { AppError, Errors, emit, transitionOrder } from '@farmgo/core';
import { type Farm, type FarmerProfile, num, type PrismaClient } from '@farmgo/db';

type FarmWithFarmer = Farm & { farmer: FarmerProfile };

export async function createListing(prisma: PrismaClient, farm: FarmWithFarmer, input: CreateListingInput) {
  if (!farm.active) throw Errors.badRequest('FARM_INACTIVE', 'This farm is marked inactive');
  const produce = await prisma.produce.findUnique({ where: { id: input.produceId } });
  if (!produce?.active) throw Errors.badRequest('UNKNOWN_PRODUCE', 'Choose produce from the catalog');
  if (input.grade && !produce.grades.includes(input.grade)) {
    throw Errors.badRequest('INVALID_GRADE', `Grade must be one of ${produce.grades.join(', ')}`);
  }
  if (input.availableTo < new Date(Date.now() - 86_400_000)) {
    throw Errors.badRequest('LISTING_IN_PAST', 'The availability window has already ended');
  }
  return prisma.$transaction(async (tx) => {
    const listing = await tx.supplyListing.create({
      data: {
        farmId: farm.id,
        produceId: produce.id,
        quantity: input.quantity,
        quantityLeft: input.quantity,
        grade: input.grade,
        pricePerUnit: input.pricePerUnit,
        availableFrom: input.availableFrom,
        availableTo: input.availableTo,
        photos: input.photos,
        notes: input.notes,
        status: input.status,
      },
      include: { produce: true },
    });
    if (listing.status === 'OPEN') {
      await emit(
        tx,
        'supply.created',
        {
          listingId: listing.id,
          farmerUserId: farm.farmer.userId,
          produceId: produce.id,
          county: farm.county,
        },
        listing.id,
      );
    }
    return listing;
  });
}

export async function updateListing(
  prisma: PrismaClient,
  listingId: string,
  farmerUserId: string,
  input: UpdateListingInput,
) {
  return prisma.$transaction(async (tx) => {
    const listing = await tx.supplyListing.findUnique({
      where: { id: listingId },
      include: { produce: true },
    });
    if (!listing) throw Errors.notFound('Listing');
    // An expired listing comes back when the farmer gives it a new window that has not ended.
    const reactivating =
      listing.status === 'EXPIRED' && input.availableTo !== undefined && input.availableTo >= new Date();
    // A listing the farmer closed comes back with status OPEN, if its window has not ended,
    // something is left to sell and the farm is still active.
    const reopening = listing.status === 'CANCELLED' && input.status === 'OPEN';
    if (reopening) {
      const until = input.availableTo ?? listing.availableTo;
      if (until < new Date()) {
        throw Errors.conflict(
          'LISTING_WINDOW_ENDED',
          'Give the listing an available-until date in the future to reopen it',
        );
      }
      const committed = num(listing.quantity) - num(listing.quantityLeft);
      const leftAfter = input.quantity !== undefined ? input.quantity - committed : num(listing.quantityLeft);
      if (leftAfter <= 0) {
        throw Errors.conflict(
          'LISTING_NOTHING_LEFT',
          'Nothing is left to sell on this listing; add quantity to reopen it',
        );
      }
      const farm = await tx.farm.findUniqueOrThrow({
        where: { id: listing.farmId },
        select: { active: true },
      });
      if (!farm.active)
        throw Errors.conflict('FARM_INACTIVE', 'This farm is closed, so its listings cannot reopen');
    }
    if ((listing.status === 'CANCELLED' && !reopening) || (listing.status === 'EXPIRED' && !reactivating)) {
      throw Errors.conflict(
        'LISTING_CLOSED',
        `This listing is ${listing.status.toLowerCase()} and can no longer be edited`,
      );
    }
    if (input.grade && !listing.produce.grades.includes(input.grade)) {
      throw Errors.badRequest('INVALID_GRADE', `Grade must be one of ${listing.produce.grades.join(', ')}`);
    }
    const data: Record<string, unknown> = { ...input };
    const committed = num(listing.quantity) - num(listing.quantityLeft);
    let left = num(listing.quantityLeft);
    if (input.quantity !== undefined) {
      if (input.quantity < committed) {
        throw new AppError(
          'QUANTITY_BELOW_COMMITTED',
          `${committed} is already sold; quantity cannot go below that`,
          409,
        );
      }
      left = input.quantity - committed;
      data.quantityLeft = left;
    }
    // Keep status consistent with what is left (unless the farmer is cancelling or drafting).
    if (input.status !== 'CANCELLED' && input.status !== 'DRAFT' && listing.status !== 'DRAFT') {
      data.status = left <= 0 ? 'FULLY_MATCHED' : committed > 0 ? 'PARTIALLY_MATCHED' : 'OPEN';
    }
    const updated = await tx.supplyListing.update({
      where: { id: listingId },
      data,
      include: { produce: true },
    });
    if (input.status === 'CANCELLED') {
      // Withdraw open proposals; confirmed orders are unaffected.
      await tx.match.updateMany({ where: { listingId, status: 'PROPOSED' }, data: { status: 'REJECTED' } });
    }
    await emit(tx, 'supply.updated', { listingId, farmerUserId }, listingId);
    return updated;
  });
}

/**
 * Farmer reports the harvest is in. Confirmed orders on this listing move to READY_FOR_QA so
 * a QA officer can inspect them.
 */
export async function markHarvestReady(
  prisma: PrismaClient,
  listingId: string,
  actorId: string,
  actor: 'farmer' | 'admin',
) {
  return prisma.$transaction(async (tx) => {
    const listing = await tx.supplyListing.update({ where: { id: listingId }, data: { harvestReady: true } });
    const farm = await tx.farm.findUniqueOrThrow({
      where: { id: listing.farmId },
      include: { farmer: true },
    });
    const orders = await tx.order.findMany({
      where: { status: 'CONFIRMED', items: { some: { listingId } } },
      select: { id: true },
    });
    for (const o of orders) {
      await transitionOrder(tx, { orderId: o.id, to: 'READY_FOR_QA', actor, actorId, note: 'Harvest ready' });
    }
    await emit(tx, 'supply.harvest_ready', { listingId, farmerUserId: farm.farmer.userId }, listingId);
    return { listing, ordersReady: orders.length };
  });
}

/**
 * Farmer takes back "harvest ready": orders waiting for inspection go back to CONFIRMED. Refused
 * once QA has recorded an inspection on any of them, or passed any order from this listing.
 */
export async function undoHarvestReady(
  prisma: PrismaClient,
  listingId: string,
  actorId: string,
  actor: 'farmer' | 'admin',
) {
  return prisma.$transaction(async (tx) => {
    const orders = await tx.order.findMany({
      where: { status: { in: ['READY_FOR_QA', 'QA_PASSED'] }, items: { some: { listingId } } },
      select: { id: true, status: true, items: { select: { inspection: { select: { id: true } } } } },
    });
    if (orders.some((o) => o.status === 'QA_PASSED' || o.items.some((i) => i.inspection))) {
      throw Errors.conflict(
        'HARVEST_ALREADY_IN_QA',
        'QA has already inspected orders from this harvest, so it cannot go back',
      );
    }
    for (const o of orders) {
      await transitionOrder(tx, {
        orderId: o.id,
        to: 'CONFIRMED',
        actor,
        actorId,
        note: 'Harvest not ready after all',
        harvestUndo: true,
      });
    }
    return tx.supplyListing.update({
      where: { id: listingId },
      data: { harvestReady: false },
      include: { produce: true },
    });
  });
}

/** Buyer-facing listing shape: farm location and farmer track record, no contact details. */
export const publicListingInclude = {
  produce: true,
  farm: {
    select: {
      id: true,
      name: true,
      county: true,
      ward: true,
      isOrganic: true,
      photoKey: true,
      farmer: {
        select: {
          id: true,
          ratingAvg: true,
          qaPassRate: true,
          onTimeRate: true,
          ordersCompleted: true,
          kycStatus: true,
          user: { select: { name: true } },
        },
      },
    },
  },
} as const;
