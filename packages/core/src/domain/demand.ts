import { type DB, num, type PrismaClient } from '@farmgo/db';
import * as rrule from 'rrule';
import { logger } from '../logger.js';
import { emit } from '../outbox.js';
import { getSetting } from './settings.js';

// rrule ships ESM (named exports) and CJS (default export); support both loaders.
const RRule =
  (rrule as unknown as { RRule?: typeof rrule.RRule; default?: { RRule: typeof rrule.RRule } }).RRule ??
  (rrule as unknown as { default: { RRule: typeof rrule.RRule } }).default.RRule;

/** Occurrence dates of a recurring demand between `from` and `to` (inclusive). */
export function occurrences(rule: string, dtstart: Date, from: Date, to: Date, until?: Date | null): Date[] {
  const opts = RRule.parseString(rule);
  const r = new RRule({ ...opts, dtstart, ...(until ? { until } : {}) });
  return r.between(from, to, true);
}

/**
 * Recurring demand requests are templates. This creates concrete child requests for each
 * occurrence inside the horizon, so farmers see upcoming demand and matching can run on
 * each delivery date. Idempotent via the (parentId, neededBy) unique constraint.
 */
export async function expandRecurringDemand(prisma: PrismaClient, now = new Date()): Promise<number> {
  const horizonDays = await getSetting(prisma, 'recurringHorizonDays');
  const horizon = new Date(now.getTime() + horizonDays * 86_400_000);
  const templates = await prisma.demandRequest.findMany({
    where: {
      recurrence: { not: null },
      parentId: null,
      status: { in: ['OPEN', 'PARTIALLY_FILLED'] },
      OR: [{ recurrenceUntil: null }, { recurrenceUntil: { gte: now } }],
    },
  });
  let created = 0;
  for (const t of templates) {
    let dates: Date[];
    try {
      dates = occurrences(t.recurrence!, t.neededBy, now, horizon, t.recurrenceUntil);
    } catch (err) {
      logger.warn({ err, demandId: t.id }, 'invalid recurrence rule');
      continue;
    }
    for (const neededBy of dates) {
      const result = await prisma.$transaction(async (tx) => {
        const exists = await tx.demandRequest.findUnique({
          where: { parentId_neededBy: { parentId: t.id, neededBy } },
        });
        if (exists) return null;
        const child = await tx.demandRequest.create({
          data: {
            buyerOrgId: t.buyerOrgId,
            createdById: t.createdById,
            produceId: t.produceId,
            quantity: t.quantity,
            minGrade: t.minGrade,
            maxPricePerUnit: t.maxPricePerUnit,
            neededBy,
            parentId: t.id,
            county: t.county,
            deliveryLat: t.deliveryLat,
            deliveryLng: t.deliveryLng,
            notes: t.notes,
          },
        });
        await emit(
          tx,
          'demand.created',
          {
            demandId: child.id,
            buyerOrgId: child.buyerOrgId,
            produceId: child.produceId,
            county: child.county,
          },
          child.id,
        );
        return child;
      });
      if (result) created++;
    }
  }
  return created;
}

/** Start of the ISO week (Monday 00:00 UTC) containing `d`. */
export function weekStart(d: Date): Date {
  const x = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const day = (x.getUTCDay() + 6) % 7;
  x.setUTCDate(x.getUTCDate() - day);
  return x;
}

export interface DemandBoardRow {
  produceId: string;
  produceName: string;
  produceNameSw: string;
  unit: string;
  county: string;
  week: string;
  totalQty: number;
  openQty: number;
  buyers: number;
  avgMaxPrice: number | null;
}

/**
 * Aggregated, anonymised demand for farmers: how much of each produce buyers need per county
 * and week. Buyer identities are never exposed here.
 */
export async function demandBoard(
  db: DB,
  opts: { county?: string; produceId?: string; weeks: number },
): Promise<DemandBoardRow[]> {
  const from = weekStart(new Date());
  const to = new Date(from.getTime() + opts.weeks * 7 * 86_400_000);
  const rows = await db.$queryRawUnsafe<
    {
      produceId: string;
      produceName: string;
      produceNameSw: string;
      unit: string;
      county: string;
      week: Date;
      totalQty: string;
      openQty: string;
      buyers: bigint;
      avgMaxPrice: string | null;
    }[]
  >(
    `SELECT d."produceId", p.name AS "produceName", p."nameSw" AS "produceNameSw", p.unit::text AS unit, d.county,
            date_trunc('week', d."neededBy") AS week,
            SUM(d.quantity) AS "totalQty",
            SUM(GREATEST(0, d.quantity - d."quantityFilled")) AS "openQty",
            COUNT(DISTINCT d."buyerOrgId") AS buyers,
            AVG(d."maxPricePerUnit") AS "avgMaxPrice"
       FROM "DemandRequest" d
       JOIN "Produce" p ON p.id = d."produceId"
      WHERE d.status IN ('OPEN', 'PARTIALLY_FILLED')
        AND NOT (d.recurrence IS NOT NULL AND d."parentId" IS NULL)
        AND d."neededBy" >= $1 AND d."neededBy" < $2
        AND ($3::text IS NULL OR d.county = $3)
        AND ($4::text IS NULL OR d."produceId" = $4)
      GROUP BY d."produceId", p.name, p."nameSw", p.unit, d.county, week
      ORDER BY week, "openQty" DESC`,
    from,
    to,
    opts.county ?? null,
    opts.produceId ?? null,
  );
  return rows.map((r) => ({
    produceId: r.produceId,
    produceName: r.produceName,
    produceNameSw: r.produceNameSw,
    unit: r.unit,
    county: r.county,
    week: r.week.toISOString().slice(0, 10),
    totalQty: num(r.totalQty),
    openQty: num(r.openQty),
    buyers: Number(r.buyers),
    avgMaxPrice: r.avgMaxPrice === null ? null : Math.round(Number(r.avgMaxPrice)),
  }));
}

/**
 * Weekly job: tell farmers what buyers need next week. Emits one `demand.aggregated`
 * event per produce and county, which fans out to the `demand:{county}` channel and to
 * farmers who grow that produce.
 */
export async function publishWeeklyDemand(prisma: PrismaClient): Promise<number> {
  const rows = await demandBoard(prisma, { weeks: 2 });
  for (const r of rows) {
    await emit(prisma, 'demand.aggregated', {
      produceId: r.produceId,
      county: r.county,
      week: r.week,
      totalQty: r.openQty,
      buyers: r.buyers,
    });
  }
  return rows.length;
}

/** Close demand whose date has passed and listings whose availability window has ended. */
export async function expireStale(
  prisma: PrismaClient,
  now = new Date(),
): Promise<{ demand: number; listings: number }> {
  const cutoff = new Date(now.getTime() - 86_400_000);
  const demand = await prisma.demandRequest.updateMany({
    where: {
      status: { in: ['OPEN', 'PARTIALLY_FILLED', 'PAUSED'] },
      neededBy: { lt: cutoff },
      OR: [{ recurrence: null }, { parentId: { not: null } }],
    },
    data: { status: 'EXPIRED' },
  });
  const templates = await prisma.demandRequest.updateMany({
    where: {
      recurrence: { not: null },
      parentId: null,
      status: { in: ['OPEN', 'PAUSED'] },
      recurrenceUntil: { lt: now },
    },
    data: { status: 'EXPIRED' },
  });
  const listings = await prisma.supplyListing.updateMany({
    where: { status: { in: ['OPEN', 'PARTIALLY_MATCHED'] }, availableTo: { lt: cutoff } },
    data: { status: 'EXPIRED' },
  });
  return { demand: demand.count + templates.count, listings: listings.count };
}
