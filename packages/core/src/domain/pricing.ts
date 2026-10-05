import { num, type PrismaClient } from '@farmgo/db';
import { emit } from '../outbox.js';
import { weekStart } from './demand.js';

const COUNTED_STATUSES = [
  'CONFIRMED',
  'READY_FOR_QA',
  'QA_PASSED',
  'IN_TRANSIT',
  'DELIVERED',
  'PAID',
  'DISPUTED',
];

/**
 * Build the public price index for one week from transacted prices: a volume-weighted average
 * per produce and buyer county, plus min, max and volume. Returns the number of points written.
 */
export async function rollupPriceIndex(prisma: PrismaClient, week = weekStart(new Date())): Promise<number> {
  const from = weekStart(week);
  const to = new Date(from.getTime() + 7 * 86_400_000);
  const rows = await prisma.$queryRawUnsafe<
    { produceId: string; county: string; avg: string; min: number; max: number; volume: string; n: bigint }[]
  >(
    `SELECT i."produceId", op.county,
            SUM(i."pricePerUnit" * i.quantity) / NULLIF(SUM(i.quantity), 0) AS avg,
            MIN(i."pricePerUnit") AS min, MAX(i."pricePerUnit") AS max,
            SUM(i.quantity) AS volume, COUNT(*) AS n
       FROM "OrderItem" i
       JOIN "Order" o ON o.id = i."orderId"
       JOIN "OrgProfile" op ON op."organizationId" = o."buyerOrgId"
      WHERE o."createdAt" >= $1 AND o."createdAt" < $2
        AND o.status::text = ANY($3::text[])
      GROUP BY i."produceId", op.county`,
    from,
    to,
    COUNTED_STATUSES,
  );
  for (const r of rows) {
    await prisma.pricePoint.upsert({
      where: { produceId_county_week: { produceId: r.produceId, county: r.county, week: from } },
      create: {
        produceId: r.produceId,
        county: r.county,
        week: from,
        avgPrice: Math.round(Number(r.avg)),
        minPrice: r.min,
        maxPrice: r.max,
        volume: num(r.volume),
        sampleSize: Number(r.n),
      },
      update: {
        avgPrice: Math.round(Number(r.avg)),
        minPrice: r.min,
        maxPrice: r.max,
        volume: num(r.volume),
        sampleSize: Number(r.n),
      },
    });
    await emit(prisma, 'price.updated', {
      produceId: r.produceId,
      county: r.county,
      week: from.toISOString().slice(0, 10),
    });
  }
  return rows.length;
}

/**
 * Forecast demand per produce and county for the next `weeks` weeks.
 * Method SEASONAL_MA: blend of the recent 4-week moving average and the same week last year
 * (when a year of history exists). Deliberately simple and explainable until there is data
 * to justify anything smarter.
 */
export function seasonalForecast(recentWeekly: number[], sameWeekLastYear: number | null): number {
  const recent = recentWeekly.slice(-4);
  const ma = recent.length ? recent.reduce((a, b) => a + b, 0) / recent.length : 0;
  if (sameWeekLastYear === null) return Math.round(ma * 100) / 100;
  return Math.round((0.6 * ma + 0.4 * sameWeekLastYear) * 100) / 100;
}

export async function forecastDemand(prisma: PrismaClient, weeks = 4, now = new Date()): Promise<number> {
  const thisWeek = weekStart(now);
  const historyFrom = new Date(thisWeek.getTime() - 60 * 7 * 86_400_000);
  const rows = await prisma.$queryRawUnsafe<{ produceId: string; county: string; week: Date; qty: string }[]>(
    `SELECT "produceId", county, date_trunc('week', "neededBy") AS week, SUM(quantity) AS qty
       FROM "DemandRequest"
      WHERE "neededBy" >= $1 AND "neededBy" < $2
        AND NOT (recurrence IS NOT NULL AND "parentId" IS NULL)
        AND status <> 'CANCELLED'
      GROUP BY "produceId", county, week`,
    historyFrom,
    thisWeek,
  );
  const series = new Map<string, Map<number, number>>();
  for (const r of rows) {
    const key = `${r.produceId}|${r.county}`;
    if (!series.has(key)) series.set(key, new Map());
    series.get(key)!.set(weekStart(r.week).getTime(), num(r.qty));
  }
  let written = 0;
  for (const [key, byWeek] of series) {
    const [produceId, county] = key.split('|') as [string, string];
    const recent: number[] = [];
    for (let i = 4; i >= 1; i--) recent.push(byWeek.get(thisWeek.getTime() - i * 7 * 86_400_000) ?? 0);
    for (let w = 0; w < weeks; w++) {
      const target = new Date(thisWeek.getTime() + w * 7 * 86_400_000);
      const lastYear =
        byWeek.get(weekStart(new Date(target.getTime() - 52 * 7 * 86_400_000)).getTime()) ?? null;
      const forecastQty = seasonalForecast(recent, lastYear);
      await prisma.demandForecast.upsert({
        where: { produceId_county_week: { produceId, county, week: target } },
        create: { produceId, county, week: target, forecastQty, method: 'SEASONAL_MA' },
        update: { forecastQty, method: 'SEASONAL_MA' },
      });
      written++;
    }
  }
  return written;
}
