import {
  APP_CATEGORIES,
  CategoryListDto,
  IdParams,
  ProduceDto,
  ProduceInput,
  ProduceListDto,
  ProduceQuery,
  ProduceUpdateInput,
} from '@farmgo/contracts';
import { audit, Errors } from '@farmgo/core';
import type { FastifyInstance } from 'fastify';
import { requirePermission } from '../lib/guards.js';
import { LIST_CAP } from '../lib/pagination.js';
import { created, ok, typed } from '../lib/route.js';

export default async function catalogRoutes(app: FastifyInstance) {
  const r = typed(app);

  r.get(
    '/v1/produce',
    {
      schema: {
        tags: ['catalog'],
        summary: 'Produce catalog (English and Kiswahili names)',
        querystring: ProduceQuery,
        response: ok(ProduceListDto),
      },
    },
    async (req) => {
      const { q, category } = req.query;
      if (q) {
        // Fuzzy match on either language (pg_trgm), so "nyanya" and "tomatos" both find Tomatoes.
        const ids = await app.prisma.$queryRawUnsafe<{ id: string }[]>(
          `SELECT id FROM "Produce"
          WHERE active AND ($2::text IS NULL OR category::text = $2)
            AND (name ILIKE '%' || $1 || '%' OR "nameSw" ILIKE '%' || $1 || '%'
                 OR similarity(name, $1) > 0.3 OR similarity("nameSw", $1) > 0.3)
          ORDER BY GREATEST(similarity(name, $1), similarity("nameSw", $1)) DESC
          LIMIT 30`,
          q,
          category ?? null,
        );
        const rows = await app.prisma.produce.findMany({ where: { id: { in: ids.map((i) => i.id) } } });
        const order = new Map(ids.map((i, idx) => [i.id, idx]));
        return rows.sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0));
      }
      return app.prisma.produce.findMany({
        where: { active: true, ...(category ? { category } : {}) },
        orderBy: { name: 'asc' },
        take: LIST_CAP.produce,
      });
    },
  );

  r.get(
    '/v1/categories',
    {
      schema: {
        tags: ['catalog'],
        summary: 'Home screen category tiles, in display order, with live counts',
        response: ok(CategoryListDto),
      },
    },
    async () => {
      const [byProduce, byInput] = await Promise.all([
        app.prisma.$queryRawUnsafe<{ category: string; n: number }[]>(
          `SELECT p.category::text AS category, COUNT(*)::int AS n
             FROM "SupplyListing" l JOIN "Produce" p ON p.id = l."produceId"
            WHERE l.status IN ('OPEN', 'PARTIALLY_MATCHED') AND l."availableTo" >= now()
              AND l."quantityLeft" > 0 AND p.active
            GROUP BY p.category`,
        ),
        app.prisma.inputProduct.groupBy({
          by: ['category'],
          where: { active: true, stock: { gt: 0 } },
          _count: { _all: true },
        }),
      ]);
      const produceCount = new Map(byProduce.map((r) => [r.category, r.n]));
      const inputCount = new Map(byInput.map((r) => [r.category as string, r._count._all]));
      const allProduce = byProduce.reduce((s, r) => s + r.n, 0);
      return APP_CATEGORIES.map((c) => {
        const produceCategories: string[] = 'produceCategories' in c ? [...c.produceCategories] : [];
        const inputCategories: string[] = 'inputCategories' in c ? [...c.inputCategories] : [];
        const count =
          c.source === 'inputs'
            ? inputCategories.reduce((s, k) => s + (inputCount.get(k) ?? 0), 0)
            : c.slug === 'all'
              ? allProduce
              : produceCategories.reduce((s, k) => s + (produceCount.get(k) ?? 0), 0);
        return {
          slug: c.slug,
          name: c.name,
          nameSw: c.nameSw,
          count,
          source: c.source,
          produceCategories,
          inputCategories,
        };
      });
    },
  );

  r.get(
    '/v1/produce/:id',
    {
      schema: { tags: ['catalog'], summary: 'One produce item', params: IdParams, response: ok(ProduceDto) },
    },
    async (req) => {
      const p = await app.prisma.produce.findUnique({ where: { id: req.params.id } });
      if (!p) throw Errors.notFound('Produce');
      return p;
    },
  );

  r.post(
    '/v1/produce',
    {
      schema: {
        tags: ['catalog'],
        summary: 'Add produce (admin)',
        body: ProduceInput,
        response: created(ProduceDto),
      },
    },
    async (req, reply) => {
      const user = requirePermission(req, { produce: ['manage'] });
      const p = await app.prisma.produce.create({ data: req.body });
      await audit(app.prisma, {
        actorId: user.id,
        action: 'produce.create',
        entity: 'Produce',
        entityId: p.id,
        after: p,
      });
      return reply.status(201).send(p);
    },
  );

  r.patch(
    '/v1/produce/:id',
    {
      schema: {
        tags: ['catalog'],
        summary: 'Edit produce (admin)',
        params: IdParams,
        body: ProduceUpdateInput,
        response: ok(ProduceDto),
      },
    },
    async (req) => {
      const user = requirePermission(req, { produce: ['manage'] });
      const before = await app.prisma.produce.findUnique({ where: { id: req.params.id } });
      if (!before) throw Errors.notFound('Produce');
      const p = await app.prisma.produce.update({ where: { id: req.params.id }, data: req.body });
      await audit(app.prisma, {
        actorId: user.id,
        action: 'produce.update',
        entity: 'Produce',
        entityId: p.id,
        before,
        after: p,
      });
      return p;
    },
  );
}
