import { APP_CATEGORIES, type ListingQuery } from '@farmgo/contracts';
import { COUNTY_CENTROIDS, Errors, type Point, pointOrCentroid } from '@farmgo/core';
import type { PrismaClient } from '@farmgo/db';

/**
 * Where "nearest" and `distanceKm` measure from: the query's lat/lng, else the caller's default
 * saved address, else their buyer organization's location (or its county centre), else nothing.
 */
export async function searchOrigin(
  prisma: PrismaClient,
  userId: string,
  q: { lat?: number; lng?: number },
): Promise<Point | null> {
  if (q.lat !== undefined && q.lng !== undefined) return { lat: q.lat, lng: q.lng };
  const orgIds = (await prisma.member.findMany({ where: { userId }, select: { organizationId: true } })).map(
    (m) => m.organizationId,
  );
  const address = await prisma.address.findFirst({
    where: {
      isDefault: true,
      lat: { not: null },
      lng: { not: null },
      OR: [{ orgId: { in: orgIds } }, { orgId: null, userId }],
    },
  });
  if (address?.lat != null && address.lng != null) return { lat: address.lat, lng: address.lng };
  const profile = await prisma.orgProfile.findFirst({
    where: { organizationId: { in: orgIds }, type: 'BUYER' },
  });
  if (profile) return pointOrCentroid(profile, profile.county);
  return null;
}

/** Produce categories behind an app tile slug (null = no filter). */
function categoriesFor(slug: string | undefined): string[] | null {
  if (!slug) return null;
  const tile = APP_CATEGORIES.find((c) => c.slug === slug);
  if (!tile) throw Errors.badRequest('UNKNOWN_CATEGORY', 'Choose a category from GET /v1/categories');
  if (tile.source === 'inputs') {
    throw Errors.badRequest(
      'UNKNOWN_CATEGORY',
      'Natural fertilizers are in the green inputs marketplace (GET /v1/inputs)',
    );
  }
  return tile.slug === 'all' ? null : [...tile.produceCategories];
}

/** County centre points as a SQL VALUES list (constants), for farms without coordinates. */
const CENTROIDS_SQL = Object.entries(COUNTY_CENTROIDS)
  .map(([county, p]) => `('${county.replace(/'/g, "''")}', ${Number(p.lat)}, ${Number(p.lng)})`)
  .join(', ');

/**
 * Public supply search (B05): filters, text search (pg_trgm), sorting and PostGIS distance in
 * one query. Returns listing ids in order with their distance, plus the next page's cursor
 * (an opaque offset).
 */
export async function searchListingIds(
  prisma: PrismaClient,
  q: ListingQuery,
  opts: { origin: Point | null; statuses: string[] },
): Promise<{ rows: { id: string; km: number | null }[]; nextCursor: string | null }> {
  const params: unknown[] = [];
  const p = (v: unknown) => {
    params.push(v);
    return `$${params.length}`;
  };
  const where: string[] = [`l.status::text = ANY(${p(opts.statuses)}::text[])`, `f.active`, `pr.active`];
  const now = new Date();
  where.push(`l."availableTo" >= ${p(q.from && q.from > now ? q.from : now)}`);
  if (q.to) where.push(`l."availableFrom" <= ${p(q.to)}`);
  if (q.upcoming) where.push(`l."availableFrom" > ${p(now)}`);
  if (q.produceId) where.push(`l."produceId" = ${p(q.produceId)}`);
  if (q.county) where.push(`f.county = ${p(q.county)}`);
  if (q.organic) where.push(`f."isOrganic"`);
  const cats = categoriesFor(q.category);
  if (cats) where.push(`pr.category::text = ANY(${p(cats)}::text[])`);
  let relevance = '0';
  if (q.q) {
    const t = p(q.q);
    where.push(
      `(pr.name ILIKE '%' || ${t} || '%' OR pr."nameSw" ILIKE '%' || ${t} || '%' OR f.name ILIKE '%' || ${t} || '%'` +
        ` OR similarity(pr.name, ${t}) > 0.3 OR similarity(pr."nameSw", ${t}) > 0.3 OR similarity(f.name, ${t}) > 0.3)`,
    );
    relevance = `GREATEST(similarity(pr.name, ${t}), similarity(pr."nameSw", ${t}), similarity(f.name, ${t}))`;
  }
  const km = opts.origin
    ? `ST_Distance(
         geography(ST_MakePoint(COALESCE(f.lng, c.lng), COALESCE(f.lat, c.lat))),
         geography(ST_MakePoint(${p(opts.origin.lng)}::float8, ${p(opts.origin.lat)}::float8))
       ) / 1000`
    : 'NULL::float8';
  const sort = q.sort ?? (q.q ? 'relevance' : 'soonest');
  if (sort === 'nearest' && !opts.origin) {
    throw Errors.badRequest(
      'LOCATION_REQUIRED',
      'Send lat and lng, or save a delivery address, to sort by distance',
    );
  }
  const orderBy = {
    nearest: 'km ASC NULLS LAST',
    price_asc: 'l."pricePerUnit" ASC',
    price_desc: 'l."pricePerUnit" DESC',
    newest: 'l."createdAt" DESC',
    soonest: 'l."availableFrom" ASC',
    relevance: 'rel DESC, l."availableFrom" ASC',
  }[sort];
  const offset = q.cursor && /^\d+$/.test(q.cursor) ? Number(q.cursor) : 0;
  const rows = await prisma.$queryRawUnsafe<{ id: string; km: number | null }[]>(
    `WITH c(county, lat, lng) AS (VALUES ${CENTROIDS_SQL})
     SELECT l.id, ${km} AS km, ${relevance} AS rel
       FROM "SupplyListing" l
       JOIN "Farm" f ON f.id = l."farmId"
       JOIN "Produce" pr ON pr.id = l."produceId"
       LEFT JOIN c ON c.county = f.county
      WHERE ${where.join(' AND ')}
      ORDER BY ${orderBy}, l.id
      LIMIT ${p(q.limit + 1)} OFFSET ${p(offset)}`,
    ...params,
  );
  const more = rows.length > q.limit;
  return {
    rows: rows
      .slice(0, q.limit)
      .map((r) => ({ id: r.id, km: r.km === null ? null : Math.round(Number(r.km) * 10) / 10 })),
    nextCursor: more ? String(offset + q.limit) : null,
  };
}
