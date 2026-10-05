import {
  ForecastListDto,
  ForecastQuery,
  LatestPriceListDto,
  PriceListDto,
  PriceQuery,
} from '@farmgo/contracts';
import { weekStart } from '@farmgo/core';
import type { FastifyInstance } from 'fastify';
import { requireUser } from '../lib/guards.js';
import { LIST_CAP } from '../lib/pagination.js';
import { ok, typed } from '../lib/route.js';

export default async function pricingRoutes(app: FastifyInstance) {
  const r = typed(app);

  r.get(
    '/v1/prices',
    {
      schema: {
        tags: ['pricing'],
        summary: 'Weekly price index (transacted prices)',
        querystring: PriceQuery,
        response: ok(PriceListDto),
      },
    },
    async (req) => {
      requireUser(req);
      const since = new Date(weekStart(new Date()).getTime() - req.query.weeks * 7 * 86_400_000);
      return app.prisma.pricePoint.findMany({
        where: {
          week: { gte: since },
          ...(req.query.produceId ? { produceId: req.query.produceId } : {}),
          ...(req.query.county ? { county: req.query.county } : {}),
        },
        include: { produce: { select: { id: true, name: true, nameSw: true, unit: true } } },
        orderBy: [{ produceId: 'asc' }, { week: 'asc' }],
        take: LIST_CAP.prices,
      });
    },
  );

  r.get(
    '/v1/prices/latest',
    {
      schema: {
        tags: ['pricing'],
        summary: 'Latest price for each produce (optionally one produce and/or one county)',
        querystring: PriceQuery.pick({ county: true, produceId: true }),
        response: ok(LatestPriceListDto),
      },
    },
    async (req) => {
      requireUser(req);
      const rows = await app.prisma.$queryRawUnsafe<
        {
          produceId: string;
          name: string;
          nameSw: string;
          unit: string;
          county: string;
          week: Date;
          avgPrice: number;
          minPrice: number;
          maxPrice: number;
          prevAvg: number | null;
        }[]
      >(
        `SELECT DISTINCT ON (pp."produceId", pp.county)
              pp."produceId", p.name, p."nameSw", p.unit::text AS unit, pp.county, pp.week,
              pp."avgPrice", pp."minPrice", pp."maxPrice",
              (SELECT prev."avgPrice" FROM "PricePoint" prev
                WHERE prev."produceId" = pp."produceId" AND prev.county = pp.county AND prev.week < pp.week
                ORDER BY prev.week DESC LIMIT 1) AS "prevAvg"
         FROM "PricePoint" pp JOIN "Produce" p ON p.id = pp."produceId"
        WHERE ($1::text IS NULL OR pp.county = $1)
          AND ($2::text IS NULL OR pp."produceId" = $2)
        ORDER BY pp."produceId", pp.county, pp.week DESC`,
        req.query.county ?? null,
        req.query.produceId ?? null,
      );
      return rows.map((r) => ({
        ...r,
        changePct: r.prevAvg ? Math.round(((r.avgPrice - r.prevAvg) / r.prevAvg) * 1000) / 10 : null,
      }));
    },
  );

  r.get(
    '/v1/forecasts',
    {
      schema: {
        tags: ['pricing'],
        summary: 'Forecast demand for the coming weeks',
        querystring: ForecastQuery,
        response: ok(ForecastListDto),
      },
    },
    async (req) => {
      requireUser(req);
      const from = weekStart(new Date());
      return app.prisma.demandForecast.findMany({
        where: {
          week: { gte: from, lt: new Date(from.getTime() + req.query.weeks * 7 * 86_400_000) },
          ...(req.query.produceId ? { produceId: req.query.produceId } : {}),
          ...(req.query.county ? { county: req.query.county } : {}),
        },
        include: { produce: { select: { id: true, name: true, nameSw: true, unit: true } } },
        orderBy: [{ week: 'asc' }, { forecastQty: 'desc' }],
        take: LIST_CAP.forecasts,
      });
    },
  );
}
