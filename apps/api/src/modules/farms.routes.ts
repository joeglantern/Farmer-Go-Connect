import { FarmDetailDto, FarmDto, FarmInput, FarmUpdateInput, IdParams } from '@farmgo/contracts';
import { Errors } from '@farmgo/core';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { isAdmin, requireFarmer, requireUser, roleOf } from '../lib/guards.js';
import { LIST_CAP } from '../lib/pagination.js';
import { created, ok, typed } from '../lib/route.js';
import { assertOwnKeys } from './uploads.routes.js';

/** The farm, if the caller owns it, onboarded its farmer (agent), or is an admin. */
export async function loadManageableFarm(req: FastifyRequest, farmId: string) {
  const user = requireUser(req);
  const farm = await req.server.prisma.farm.findUnique({ where: { id: farmId }, include: { farmer: true } });
  if (!farm) throw Errors.notFound('Farm');
  const ok =
    farm.farmer.userId === user.id ||
    isAdmin(user) ||
    (roleOf(user) === 'agent' && farm.farmer.onboardedById === user.id);
  if (!ok) throw Errors.notFound('Farm');
  return farm;
}

export default async function farmRoutes(app: FastifyInstance) {
  const r = typed(app);

  r.get(
    '/v1/farms',
    {
      schema: {
        tags: ['farms'],
        summary: "My farms, or (agents and admins) a farmer's farms with ?farmerId=",
        querystring: z.object({ farmerId: z.string().max(64).optional() }),
        response: ok(z.array(FarmDto)),
      },
    },
    async (req) => {
      if (req.query.farmerId) {
        const user = requireUser(req);
        const profile = await app.prisma.farmerProfile.findUnique({ where: { id: req.query.farmerId } });
        const allowed =
          profile &&
          (isAdmin(user) ||
            profile.userId === user.id ||
            (roleOf(user) === 'agent' && profile.onboardedById === user.id));
        if (!allowed) throw Errors.notFound('Farmer');
        return app.prisma.farm.findMany({
          where: { farmerId: profile.id },
          orderBy: { createdAt: 'asc' },
          take: LIST_CAP.farms,
        });
      }
      const { profile } = await requireFarmer(req);
      return app.prisma.farm.findMany({
        where: { farmerId: profile.id },
        orderBy: { createdAt: 'asc' },
        take: LIST_CAP.farms,
      });
    },
  );

  r.post(
    '/v1/farms',
    { schema: { tags: ['farms'], summary: 'Add a farm', body: FarmInput, response: created(FarmDto) } },
    async (req, reply) => {
      const { profile } = await requireFarmer(req);
      if (req.body.photoKey) await assertOwnKeys(req, [req.body.photoKey]);
      const farm = await app.prisma.farm.create({ data: { ...req.body, farmerId: profile.id } });
      return reply.status(201).send(farm);
    },
  );

  r.get(
    '/v1/farms/:id',
    {
      schema: {
        tags: ['farms'],
        summary: 'A farm with its recent listings',
        params: IdParams,
        response: ok(FarmDetailDto),
      },
    },
    async (req) => {
      const farm = await loadManageableFarm(req, req.params.id);
      const listings = await app.prisma.supplyListing.findMany({
        where: { farmId: farm.id },
        orderBy: { availableFrom: 'desc' },
        take: 50,
        include: { produce: true },
      });
      return { ...farm, listings };
    },
  );

  r.patch(
    '/v1/farms/:id',
    {
      schema: {
        tags: ['farms'],
        summary: 'Edit a farm',
        params: IdParams,
        body: FarmUpdateInput,
        response: ok(FarmDto),
      },
    },
    async (req) => {
      const farm = await loadManageableFarm(req, req.params.id);
      if (req.body.photoKey) await assertOwnKeys(req, [req.body.photoKey]);
      return app.prisma.farm.update({ where: { id: farm.id }, data: req.body });
    },
  );

  r.delete(
    '/v1/farms/:id',
    {
      schema: {
        tags: ['farms'],
        summary: 'Remove a farm (archived if it has any history)',
        description:
          'Refused while the farm has open listings or orders in progress. A farm that ever had ' +
          'listings is archived (active=false) so past orders keep their farm; otherwise it is deleted.',
        params: IdParams,
        response: ok(z.object({ ok: z.literal(true), archived: z.boolean() })),
      },
    },
    async (req) => {
      const farm = await loadManageableFarm(req, req.params.id);
      const [open, busy, any] = await Promise.all([
        app.prisma.supplyListing.count({
          where: { farmId: farm.id, status: { in: ['OPEN', 'PARTIALLY_MATCHED', 'DRAFT'] } },
        }),
        app.prisma.order.count({
          where: {
            items: { some: { listing: { farmId: farm.id } } },
            status: { notIn: ['PAID', 'REFUNDED', 'CANCELLED', 'QA_REJECTED'] },
          },
        }),
        app.prisma.supplyListing.count({ where: { farmId: farm.id } }),
      ]);
      if (open || busy) {
        throw Errors.conflict(
          'FARM_IN_USE',
          "Close this farm's listings and finish its orders before removing it",
        );
      }
      if (any) {
        await app.prisma.farm.update({ where: { id: farm.id }, data: { active: false } });
        return { ok: true as const, archived: true };
      }
      await app.prisma.farm.delete({ where: { id: farm.id } });
      return { ok: true as const, archived: false };
    },
  );
}
