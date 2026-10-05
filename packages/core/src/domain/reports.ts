import { type DB, num } from '@farmgo/db';

export interface ReportRange {
  from?: Date;
  to?: Date;
  county?: string;
}

const range = (r: ReportRange) => ({
  from: r.from ?? new Date(Date.now() - 90 * 86_400_000),
  to: r.to ?? new Date(),
});

/**
 * Impact metrics for EYAAM and funders: inclusion, volumes, food loss avoided, farmer income,
 * packaging reuse and youth jobs. Figures are for the date range (default: last 90 days).
 */
export async function impactReport(db: DB, r: ReportRange) {
  const { from, to } = range(r);
  const county = r.county ?? null;

  const [farmers] = await db.$queryRawUnsafe<
    { total: bigint; youth: bigint; women: bigint; newInRange: bigint }[]
  >(
    `SELECT COUNT(*) AS total,
            COUNT(*) FILTER (WHERE fp."dateOfBirth" IS NOT NULL
                               AND fp."dateOfBirth" BETWEEN now() - interval '35 years' AND now() - interval '18 years') AS youth,
            COUNT(*) FILTER (WHERE fp.gender = 'FEMALE') AS women,
            COUNT(*) FILTER (WHERE fp."createdAt" BETWEEN $1 AND $2) AS "newInRange"
       FROM "FarmerProfile" fp JOIN "user" u ON u.id = fp."userId"
      WHERE ($3::text IS NULL OR u.county = $3)`,
    from,
    to,
    county,
  );

  const [trade] = await db.$queryRawUnsafe<
    { orders: bigint; kg: string | null; gmv: bigint | null; preHarvestKg: string | null; buyers: bigint }[]
  >(
    `SELECT COUNT(DISTINCT o.id) AS orders,
            SUM(i.quantity) FILTER (WHERE p.unit = 'KG') AS kg,
            SUM(i."lineTotal") AS gmv,
            SUM(i.quantity) FILTER (WHERE p.unit = 'KG' AND l."availableFrom" > o."createdAt") AS "preHarvestKg",
            COUNT(DISTINCT o."buyerOrgId") AS buyers
       FROM "Order" o
       JOIN "OrderItem" i ON i."orderId" = o.id
       JOIN "SupplyListing" l ON l.id = i."listingId"
       JOIN "Produce" p ON p.id = i."produceId"
       JOIN "OrgProfile" op ON op."organizationId" = o."buyerOrgId"
      WHERE o."createdAt" BETWEEN $1 AND $2
        AND o.status NOT IN ('CANCELLED', 'QA_REJECTED')
        AND ($3::text IS NULL OR op.county = $3)`,
    from,
    to,
    county,
  );

  const [income] = await db.$queryRawUnsafe<{ paid: bigint | null; farmersPaid: bigint }[]>(
    `SELECT SUM(amount) AS paid, COUNT(DISTINCT "farmerId") AS "farmersPaid"
       FROM "Payout" WHERE status = 'SUCCESS' AND "createdAt" BETWEEN $1 AND $2`,
    from,
    to,
  );

  const [crates] = await db.$queryRawUnsafe<
    { returns: bigint; deliveries: bigint; lost: bigint; active: bigint }[]
  >(
    `SELECT (SELECT COUNT(*) FROM "CrateMovement" WHERE "to" = 'IN_STOCK' AND "from" = 'WITH_BUYER' AND "createdAt" BETWEEN $1 AND $2) AS returns,
            (SELECT COUNT(*) FROM "CrateMovement" WHERE "to" = 'WITH_BUYER' AND "createdAt" BETWEEN $1 AND $2) AS deliveries,
            (SELECT COUNT(*) FROM "Crate" WHERE status = 'LOST') AS lost,
            (SELECT COUNT(*) FROM "Crate" WHERE status NOT IN ('RETIRED', 'LOST')) AS active`,
    from,
    to,
  );

  const [logistics] = await db.$queryRawUnsafe<{ routes: bigint; stops: bigint; km: number | null }[]>(
    `SELECT COUNT(DISTINCT r.id) AS routes, COUNT(d.id) AS stops, SUM(DISTINCT r."distanceKm") AS km
       FROM "Route" r LEFT JOIN "Delivery" d ON d."routeId" = r.id
      WHERE r.date BETWEEN $1::date AND $2::date AND ($3::text IS NULL OR r.county = $3)`,
    from,
    to,
    county,
  );

  const staff = await db.user.groupBy({
    by: ['role'],
    where: { role: { in: ['agent', 'qa_officer', 'driver', 'admin'] }, banned: { not: true } },
    _count: { _all: true },
  });

  const [qa] = await db.$queryRawUnsafe<{ inspected: bigint; passed: bigint }[]>(
    `SELECT COUNT(*) AS inspected, COUNT(*) FILTER (WHERE passed) AS passed
       FROM "QualityInspection" WHERE "inspectedAt" BETWEEN $1 AND $2`,
    from,
    to,
  );

  const pct = (a: bigint | number, b: bigint | number) =>
    Number(b) ? Math.round((Number(a) / Number(b)) * 1000) / 10 : 0;
  const kgTraded = num(trade?.kg ?? null);
  const preHarvestKg = num(trade?.preHarvestKg ?? null);
  const staffCounts = Object.fromEntries(staff.map((s) => [s.role ?? 'user', s._count._all]));

  return {
    range: { from, to, county },
    farmers: {
      total: Number(farmers?.total ?? 0),
      newInRange: Number(farmers?.newInRange ?? 0),
      youthPct: pct(farmers?.youth ?? 0, farmers?.total ?? 0),
      womenPct: pct(farmers?.women ?? 0, farmers?.total ?? 0),
    },
    trade: {
      orders: Number(trade?.orders ?? 0),
      activeBuyers: Number(trade?.buyers ?? 0),
      kgTraded,
      grossValueCents: Number(trade?.gmv ?? 0),
      /** Produce sold before it was harvested: a proxy for food loss avoided. */
      preHarvestMatchedKg: preHarvestKg,
      preHarvestMatchedPct: kgTraded ? Math.round((preHarvestKg / kgTraded) * 1000) / 10 : 0,
    },
    farmerIncome: { paidOutCents: Number(income?.paid ?? 0), farmersPaid: Number(income?.farmersPaid ?? 0) },
    quality: { inspected: Number(qa?.inspected ?? 0), passRatePct: pct(qa?.passed ?? 0, qa?.inspected ?? 0) },
    packaging: {
      activeCrates: Number(crates?.active ?? 0),
      crateTrips: Number(crates?.deliveries ?? 0),
      crateReturns: Number(crates?.returns ?? 0),
      returnRatePct: pct(crates?.returns ?? 0, crates?.deliveries ?? 0),
      lost: Number(crates?.lost ?? 0),
    },
    logistics: {
      routes: Number(logistics?.routes ?? 0),
      stops: Number(logistics?.stops ?? 0),
      distanceKm: Math.round(Number(logistics?.km ?? 0)),
    },
    youthJobs: {
      agents: staffCounts.agent ?? 0,
      qaOfficers: staffCounts.qa_officer ?? 0,
      drivers: staffCounts.driver ?? 0,
      admins: staffCounts.admin ?? 0,
    },
  };
}

/** Operational dashboard for the admin console. */
export async function opsSummary(db: DB) {
  const today = new Date(new Date().toISOString().slice(0, 10));
  const [ordersByStatus, openDisputes, failedPayouts, pendingPayments, openDemand, openListings, pendingKyc] =
    await Promise.all([
      db.order.groupBy({ by: ['status'], _count: { _all: true } }),
      db.dispute.count({ where: { status: { in: ['OPEN', 'UNDER_REVIEW'] } } }),
      db.payout.count({ where: { status: 'FAILED' } }),
      db.payment.count({ where: { status: 'PENDING' } }),
      db.demandRequest.count({
        where: { status: { in: ['OPEN', 'PARTIALLY_FILLED'] }, neededBy: { gte: today } },
      }),
      db.supplyListing.count({ where: { status: { in: ['OPEN', 'PARTIALLY_MATCHED'] } } }),
      db.farmerProfile.count({ where: { kycStatus: 'SUBMITTED' } }),
    ]);
  return {
    ordersByStatus: Object.fromEntries(ordersByStatus.map((o) => [o.status, o._count._all])),
    openDisputes,
    failedPayouts,
    pendingPayments,
    openDemand,
    openListings,
    pendingKyc,
  };
}
