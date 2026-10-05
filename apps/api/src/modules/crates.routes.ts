import {
  CrateDetailDto,
  CrateDto,
  CratePageDto,
  CrateQuery,
  CratesCreatedDto,
  CreateCratesInput,
  ScanCrateInput,
} from '@farmgo/contracts';
import { audit, Errors, newCrateCode, scanCrate } from '@farmgo/core';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requirePermission } from '../lib/guards.js';
import { cursorArgs, paginate } from '../lib/pagination.js';
import { created, ok, typed } from '../lib/route.js';

export default async function crateRoutes(app: FastifyInstance) {
  const r = typed(app);

  r.post(
    '/v1/crates',
    {
      schema: {
        tags: ['crates'],
        summary: 'Register a batch of reusable crates (admin)',
        body: CreateCratesInput,
        response: created(CratesCreatedDto),
      },
    },
    async (req, reply) => {
      const user = requirePermission(req, { crate: ['manage'] });
      const codes = Array.from({ length: req.body.count }, () => newCrateCode());
      await app.prisma.crate.createMany({
        data: codes.map((qrCode) => ({ qrCode, size: req.body.size, depositCents: req.body.depositCents })),
      });
      await audit(app.prisma, {
        actorId: user.id,
        action: 'crate.create',
        entity: 'Crate',
        entityId: codes[0]!,
        after: { count: codes.length },
      });
      return reply.status(201).send({ created: codes.length, qrCodes: codes });
    },
  );

  r.get(
    '/v1/crates',
    {
      schema: {
        tags: ['crates'],
        summary: 'Crate fleet with a count per status',
        querystring: CrateQuery,
        response: ok(CratePageDto),
      },
    },
    async (req) => {
      requirePermission(req, { crate: ['manage'] });
      const q = req.query;
      const rows = await app.prisma.crate.findMany({
        where: {
          ...(q.status ? { status: q.status } : {}),
          ...(q.holderOrgId ? { holderOrgId: q.holderOrgId } : {}),
        },
        orderBy: { id: 'asc' },
        ...cursorArgs(q.cursor, q.limit),
      });
      const summary = await app.prisma.crate.groupBy({ by: ['status'], _count: { _all: true } });
      return {
        ...paginate(rows, q.limit),
        summary: Object.fromEntries(summary.map((s) => [s.status, s._count._all])),
      };
    },
  );

  r.get(
    '/v1/crates/:qrCode',
    {
      schema: {
        tags: ['crates'],
        summary: 'A crate and its recent movements',
        params: z.object({ qrCode: z.string().max(64) }),
        response: ok(CrateDetailDto),
      },
    },
    async (req) => {
      requirePermission(req, { crate: ['scan'] });
      const crate = await app.prisma.crate.findUnique({
        where: { qrCode: req.params.qrCode },
        include: {
          movements: {
            orderBy: { createdAt: 'desc' },
            take: 50,
            include: { scannedBy: { select: { name: true } } },
          },
        },
      });
      if (!crate) throw Errors.notFound('Crate');
      return crate;
    },
  );

  r.post(
    '/v1/crates/scan',
    {
      schema: {
        tags: ['crates'],
        summary: 'Scan a crate QR code to record where it is',
        body: ScanCrateInput,
        response: ok(CrateDto),
      },
    },
    async (req) => {
      const user = requirePermission(req, { crate: ['scan'] });
      return app.prisma.$transaction((tx) => scanCrate(tx, req.body, user.id));
    },
  );
}
