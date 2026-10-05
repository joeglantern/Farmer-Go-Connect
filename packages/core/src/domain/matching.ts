import { type DB, type Match, num, type PrismaClient } from '@farmgo/db';
import { AppError, Errors } from '../errors.js';
import { logger } from '../logger.js';
import { emit } from '../outbox.js';
import { farmsWithin, haversineKm, pointOrCentroid } from './geo.js';
import { createOrder } from './orders.js';
import { getSetting, type Settings } from './settings.js';

// ─── Scoring (pure, unit-tested) ──────────────────────────────

export interface CandidateFacts {
  distanceKm: number | null;
  radiusKm: number;
  pricePerUnit: number;
  referencePrice: number;
  qaPassRate: number;
  onTimeRate: number;
  availableFrom: Date;
  neededBy: Date;
  isYouth: boolean;
  isWoman: boolean;
  ordersCompleted: number;
}

export interface ScoreBreakdown {
  distance: number;
  price: number;
  reliability: number;
  freshness: number;
  inclusion: number;
  total: number;
}

const clamp01 = (n: number) => Math.max(0, Math.min(1, n));

export function scoreCandidate(f: CandidateFacts, w: Settings['matchWeights']): ScoreBreakdown {
  // Closer is better: fewer kilometres, lower cost and emissions.
  const distance = f.distanceKm === null ? 0.5 : clamp01(1 - f.distanceKm / f.radiusKm);
  // At the reference price scores 0.5; 30% cheaper scores 1; 30% dearer scores 0.
  const price =
    f.referencePrice > 0
      ? clamp01(0.5 + (f.referencePrice - f.pricePerUnit) / (0.6 * f.referencePrice))
      : 0.5;
  const reliability = clamp01(0.6 * f.qaPassRate + 0.4 * f.onTimeRate);
  // Harvest within a day of when it is needed is ideal; a week apart scores 0.
  const daysApart = Math.abs(f.neededBy.getTime() - f.availableFrom.getTime()) / 86_400_000;
  const freshness = clamp01(1 - Math.max(0, daysApart - 1) / 6);
  // Inclusion: youth and women farmers, and newcomers who need a first sale.
  const inclusion = clamp01(
    (f.isYouth ? 0.5 : 0) + (f.isWoman ? 0.5 : 0) + (f.ordersCompleted < 3 ? 0.5 : 0),
  );
  const total =
    w.distance * distance +
    w.price * price +
    w.reliability * reliability +
    w.freshness * freshness +
    w.inclusion * inclusion;
  return { distance, price, reliability, freshness, inclusion, total: Math.round(total * 10_000) / 10_000 };
}

/** Grades are listed best-first on the produce (e.g. ["A","B","C"]). Missing grade ranks last. */
export function gradeMeets(grades: string[], listingGrade: string | null, minGrade: string | null): boolean {
  if (!minGrade) return true;
  if (!listingGrade) return false;
  const have = grades.indexOf(listingGrade);
  const need = grades.indexOf(minGrade);
  if (have < 0 || need < 0) return listingGrade === minGrade;
  return have <= need;
}

export function isYouth(dateOfBirth: Date | null, now = new Date()): boolean {
  if (!dateOfBirth) return false;
  const age = (now.getTime() - dateOfBirth.getTime()) / (365.25 * 86_400_000);
  return age >= 18 && age <= 35;
}

// ─── Engine ───────────────────────────────────────────────────

/** Proposed matches already hold these quantities; don't offer the same stock twice. */
async function proposedQtyByListing(db: DB, listingIds: string[]): Promise<Map<string, number>> {
  if (listingIds.length === 0) return new Map();
  const rows = await db.match.groupBy({
    by: ['listingId'],
    where: { listingId: { in: listingIds }, status: 'PROPOSED' },
    _sum: { quantity: true },
  });
  return new Map(rows.map((r) => [r.listingId, num(r._sum.quantity)]));
}

async function referencePriceFor(
  db: DB,
  produceId: string,
  county: string,
  fallback: number[],
): Promise<number> {
  const point = await db.pricePoint.findFirst({ where: { produceId, county }, orderBy: { week: 'desc' } });
  if (point) return point.avgPrice;
  const anyCounty = await db.pricePoint.findFirst({ where: { produceId }, orderBy: { week: 'desc' } });
  if (anyCounty) return anyCounty.avgPrice;
  if (fallback.length === 0) return 0;
  const sorted = [...fallback].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)]!;
}

/**
 * Find supply for one demand request and propose matches for the unfilled quantity.
 * Idempotent: re-running only proposes for quantity not already filled or proposed.
 */
export async function matchDemand(prisma: PrismaClient, demandId: string): Promise<Match[]> {
  const demand = await prisma.demandRequest.findUnique({
    where: { id: demandId },
    include: {
      produce: true,
      buyerOrg: { include: { profile: true } },
      matches: { where: { status: 'PROPOSED' } },
    },
  });
  if (!demand || !['OPEN', 'PARTIALLY_FILLED'].includes(demand.status)) return [];
  if (demand.recurrence && !demand.parentId) return []; // recurring templates are matched via their instances
  if (demand.neededBy < new Date(Date.now() - 86_400_000)) return [];

  const proposed = demand.matches.reduce((s, m) => s + num(m.quantity), 0);
  let remaining = num(demand.quantity) - num(demand.quantityFilled) - proposed;
  if (remaining <= 0) return [];

  const [radiusKm, weights, expiryHours] = await Promise.all([
    getSetting(prisma, 'matchRadiusKm'),
    getSetting(prisma, 'matchWeights'),
    getSetting(prisma, 'matchExpiryHours'),
  ]);

  const buyerPoint = pointOrCentroid(
    {
      lat: demand.deliveryLat ?? demand.buyerOrg.profile?.lat ?? null,
      lng: demand.deliveryLng ?? demand.buyerOrg.profile?.lng ?? null,
    },
    demand.county,
  );

  // Geographic prefilter with PostGIS; farms without coordinates fall back to same county.
  const nearby = buyerPoint ? await farmsWithin(prisma, buyerPoint, radiusKm) : [];
  const distanceByFarm = new Map(nearby.map((f) => [f.id, f.distanceKm]));

  const windowStart = new Date(demand.neededBy.getTime() - 2 * 86_400_000);
  const listings = await prisma.supplyListing.findMany({
    where: {
      produceId: demand.produceId,
      status: { in: ['OPEN', 'PARTIALLY_MATCHED'] },
      availableFrom: { lte: demand.neededBy },
      availableTo: { gte: windowStart },
      ...(demand.maxPricePerUnit ? { pricePerUnit: { lte: demand.maxPricePerUnit } } : {}),
      matches: { none: { demandId: demand.id } },
      OR: [{ farmId: { in: [...distanceByFarm.keys()] } }, { farm: { lat: null } }],
    },
    include: { farm: { include: { farmer: true } } },
    take: 200,
  });

  // Farms without coordinates are placed at their county centre point.
  for (const l of listings) {
    if (distanceByFarm.has(l.farmId) || l.farm.lat !== null) continue;
    const centre = pointOrCentroid({ lat: null, lng: null }, l.farm.county);
    if (centre && buyerPoint) {
      const km = haversineKm(centre, buyerPoint);
      if (km <= radiusKm) distanceByFarm.set(l.farmId, km);
    } else if (l.farm.county === demand.county) {
      distanceByFarm.set(l.farmId, 0);
    }
  }
  const eligible = listings.filter(
    (l) =>
      distanceByFarm.has(l.farmId) &&
      gradeMeets(demand.produce.grades, l.grade, demand.minGrade) &&
      l.farm.farmer.userId !== demand.createdById,
  );
  if (eligible.length === 0) return [];

  const held = await proposedQtyByListing(
    prisma,
    eligible.map((l) => l.id),
  );
  const refPrice = await referencePriceFor(
    prisma,
    demand.produceId,
    demand.county,
    eligible.map((l) => l.pricePerUnit),
  );

  const scored = eligible
    .map((l) => {
      const available = num(l.quantityLeft) - (held.get(l.id) ?? 0);
      const breakdown = scoreCandidate(
        {
          distanceKm: distanceByFarm.get(l.farmId) ?? null,
          radiusKm,
          pricePerUnit: l.pricePerUnit,
          referencePrice: refPrice,
          qaPassRate: l.farm.farmer.qaPassRate,
          onTimeRate: l.farm.farmer.onTimeRate,
          availableFrom: l.availableFrom,
          neededBy: demand.neededBy,
          isYouth: isYouth(l.farm.farmer.dateOfBirth),
          isWoman: l.farm.farmer.gender === 'FEMALE',
          ordersCompleted: l.farm.farmer.ordersCompleted,
        },
        weights,
      );
      return { listing: l, available, breakdown };
    })
    .filter((c) => c.available > 0)
    .sort((a, b) => b.breakdown.total - a.breakdown.total);

  // Greedy allocation by score. Prefer a single farmer who can cover everything when their
  // score is close to the best, to keep aggregation simple.
  const best = scored[0];
  const coverAll = scored.find(
    (c) => c.available >= remaining && best && best.breakdown.total - c.breakdown.total < 0.05,
  );
  const ordered = coverAll ? [coverAll, ...scored.filter((c) => c !== coverAll)] : scored;

  const expiresAt = new Date(Date.now() + expiryHours * 3600_000);
  const created: Match[] = [];
  for (const c of ordered) {
    if (remaining <= 0) break;
    const qty = Math.min(remaining, c.available);
    const match = await prisma.$transaction(async (tx) => {
      const m = await tx.match.create({
        data: {
          demandId: demand.id,
          listingId: c.listing.id,
          quantity: qty,
          pricePerUnit: c.listing.pricePerUnit,
          score: c.breakdown.total,
          scoreBreakdown: { ...c.breakdown },
          distanceKm: distanceByFarm.get(c.listing.farmId) ?? null,
          expiresAt,
        },
      });
      await emit(
        tx,
        'match.proposed',
        {
          matchId: m.id,
          demandId: demand.id,
          listingId: c.listing.id,
          buyerOrgId: demand.buyerOrgId,
          farmerUserId: c.listing.farm.farmer.userId,
        },
        m.id,
      );
      return m;
    });
    created.push(match);
    remaining -= qty;
  }
  logger.info({ demandId, proposed: created.length }, 'matching: demand processed');
  return created;
}

/** A new or updated listing: try it against open demand for the same produce, soonest first. */
export async function matchListing(prisma: PrismaClient, listingId: string): Promise<number> {
  const listing = await prisma.supplyListing.findUnique({
    where: { id: listingId },
    include: { farm: true },
  });
  if (!listing || !['OPEN', 'PARTIALLY_MATCHED'].includes(listing.status)) return 0;
  const demands = await prisma.demandRequest.findMany({
    where: {
      produceId: listing.produceId,
      status: { in: ['OPEN', 'PARTIALLY_FILLED'] },
      neededBy: { gte: listing.availableFrom, lte: new Date(listing.availableTo.getTime() + 2 * 86_400_000) },
      NOT: { recurrence: { not: null }, parentId: null },
    },
    orderBy: { neededBy: 'asc' },
    take: 25,
    select: { id: true },
  });
  let total = 0;
  for (const d of demands) total += (await matchDemand(prisma, d.id)).length;
  return total;
}

// ─── Responding to matches ────────────────────────────────────

export type MatchSide = 'buyer' | 'farmer';

async function loadMatch(tx: DB, matchId: string) {
  const match = await tx.match.findUnique({
    where: { id: matchId },
    include: { demand: true, listing: { include: { farm: { include: { farmer: true } } } } },
  });
  if (!match) throw Errors.notFound('Match');
  return match;
}

/**
 * Buyer or farmer accepts. When both have accepted, the order is created (CONFIRMED) and the
 * listing quantity reserved. Returns the order id when one was created.
 */
export async function acceptMatch(
  tx: DB,
  matchId: string,
  side: MatchSide,
  userId: string,
): Promise<{ orderId?: string }> {
  const match = await loadMatch(tx, matchId);
  if (match.status !== 'PROPOSED')
    throw Errors.conflict('MATCH_CLOSED', `This match is ${match.status.toLowerCase()}`);
  if (match.expiresAt < new Date()) throw Errors.conflict('MATCH_EXPIRED', 'This match has expired');

  const now = new Date();
  const buyerAcceptedAt = side === 'buyer' ? now : match.buyerAcceptedAt;
  const farmerAcceptedAt = side === 'farmer' ? now : match.farmerAcceptedAt;
  await tx.match.update({ where: { id: match.id }, data: { buyerAcceptedAt, farmerAcceptedAt } });

  if (!buyerAcceptedAt || !farmerAcceptedAt) return {};

  let orderId: string;
  try {
    const order = await createOrder(tx, {
      buyerOrgId: match.demand.buyerOrgId,
      createdById: match.demand.createdById,
      listingId: match.listingId,
      quantity: num(match.quantity),
      pricePerUnit: match.pricePerUnit,
      deliveryDate: match.demand.neededBy,
      deliveryLat: match.demand.deliveryLat ?? undefined,
      deliveryLng: match.demand.deliveryLng ?? undefined,
      notes: match.demand.notes ?? undefined,
      matchId: match.id,
      demandId: match.demandId,
      initialStatus: 'CONFIRMED',
    });
    orderId = order.id;
  } catch (err) {
    if (err instanceof AppError && err.code === 'LISTING_UNAVAILABLE') {
      await tx.match.update({ where: { id: match.id }, data: { status: 'EXPIRED' } });
      throw Errors.conflict('MATCH_STOCK_GONE', 'The farmer no longer has enough stock for this match');
    }
    throw err;
  }

  await tx.match.update({ where: { id: match.id }, data: { status: 'ACCEPTED' } });
  await emit(
    tx,
    'match.accepted',
    {
      matchId: match.id,
      buyerOrgId: match.demand.buyerOrgId,
      farmerUserId: match.listing.farm.farmer.userId,
      orderId,
    },
    match.id,
  );
  void userId;
  return { orderId };
}

export async function rejectMatch(tx: DB, matchId: string, side: MatchSide): Promise<void> {
  const match = await loadMatch(tx, matchId);
  if (match.status !== 'PROPOSED')
    throw Errors.conflict('MATCH_CLOSED', `This match is ${match.status.toLowerCase()}`);
  await tx.match.update({ where: { id: match.id }, data: { status: 'REJECTED' } });
  await emit(
    tx,
    'match.rejected',
    {
      matchId: match.id,
      buyerOrgId: match.demand.buyerOrgId,
      farmerUserId: match.listing.farm.farmer.userId,
      by: side,
    },
    match.id,
  );
}

/** Expire stale proposals so their quantity can be offered again. Returns the count. */
export async function expireMatches(prisma: PrismaClient): Promise<number> {
  const stale = await prisma.match.findMany({
    where: { status: 'PROPOSED', expiresAt: { lt: new Date() } },
    include: { demand: true, listing: { include: { farm: { include: { farmer: true } } } } },
    take: 500,
  });
  for (const m of stale) {
    await prisma.$transaction(async (tx) => {
      const res = await tx.match.updateMany({
        where: { id: m.id, status: 'PROPOSED' },
        data: { status: 'EXPIRED' },
      });
      if (res.count === 1) {
        await emit(
          tx,
          'match.expired',
          {
            matchId: m.id,
            buyerOrgId: m.demand.buyerOrgId,
            farmerUserId: m.listing.farm.farmer.userId,
          },
          m.id,
        );
      }
    });
  }
  return stale.length;
}

/** Admin creates or overrides a match manually. */
export async function createManualMatch(
  tx: DB,
  a: { demandId: string; listingId: string; quantity: number; pricePerUnit?: number; adminId: string },
): Promise<Match> {
  const [demand, listing] = await Promise.all([
    tx.demandRequest.findUnique({ where: { id: a.demandId } }),
    tx.supplyListing.findUnique({
      where: { id: a.listingId },
      include: { farm: { include: { farmer: true } } },
    }),
  ]);
  if (!demand) throw Errors.notFound('Demand');
  if (!listing) throw Errors.notFound('Listing');
  if (demand.produceId !== listing.produceId)
    throw Errors.badRequest('PRODUCE_MISMATCH', 'Demand and listing are for different produce');
  const expiryHours = await getSetting(tx, 'matchExpiryHours');
  const m = await tx.match.upsert({
    where: { demandId_listingId: { demandId: a.demandId, listingId: a.listingId } },
    create: {
      demandId: a.demandId,
      listingId: a.listingId,
      quantity: a.quantity,
      pricePerUnit: a.pricePerUnit ?? listing.pricePerUnit,
      score: 1,
      scoreBreakdown: { manual: true },
      expiresAt: new Date(Date.now() + expiryHours * 3600_000),
      createdByAdminId: a.adminId,
    },
    update: {
      quantity: a.quantity,
      pricePerUnit: a.pricePerUnit ?? listing.pricePerUnit,
      status: 'PROPOSED',
      buyerAcceptedAt: null,
      farmerAcceptedAt: null,
      expiresAt: new Date(Date.now() + expiryHours * 3600_000),
      createdByAdminId: a.adminId,
    },
  });
  await emit(
    tx,
    'match.proposed',
    {
      matchId: m.id,
      demandId: demand.id,
      listingId: listing.id,
      buyerOrgId: demand.buyerOrgId,
      farmerUserId: listing.farm.farmer.userId,
    },
    m.id,
  );
  return m;
}
