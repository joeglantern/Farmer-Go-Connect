import {
  AddressDto,
  AddressInput,
  AddressListDto,
  AddressUpdateInput,
  IdParams,
  Ok,
} from '@farmgo/contracts';
import { Errors } from '@farmgo/core';
import type { Prisma } from '@farmgo/db';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { requireOrg, requireUser, roleOf } from '../lib/guards.js';
import { LIST_CAP } from '../lib/pagination.js';
import { created, ok, typed } from '../lib/route.js';

/**
 * Who owns the caller's addresses: their buyer organization (shared by its members), or the
 * user themselves for everyone else.
 */
async function owner(req: FastifyRequest): Promise<{ userId: string; orgId: string | null }> {
  const user = requireUser(req);
  if (roleOf(user) === 'buyer') {
    const { orgId } = await requireOrg(req, 'BUYER');
    return { userId: user.id, orgId };
  }
  return { userId: user.id, orgId: null };
}

const scopeOf = (o: { userId: string; orgId: string | null }): Prisma.AddressWhereInput =>
  o.orgId ? { orgId: o.orgId } : { orgId: null, userId: o.userId };

/** Saved delivery addresses (B08). One default per owner; the first address becomes the default. */
export default async function addressRoutes(app: FastifyInstance) {
  const r = typed(app);

  const load = async (req: FastifyRequest, id: string) => {
    const o = await owner(req);
    const a = await app.prisma.address.findFirst({ where: { id, ...scopeOf(o) } });
    if (!a) throw Errors.notFound('Address');
    return { o, a };
  };

  r.get(
    '/v1/addresses',
    {
      schema: {
        tags: ['me'],
        summary: 'My saved delivery addresses, default first',
        response: ok(AddressListDto),
      },
    },
    async (req) => {
      const o = await owner(req);
      return app.prisma.address.findMany({
        where: scopeOf(o),
        orderBy: [{ isDefault: 'desc' }, { createdAt: 'asc' }],
        take: LIST_CAP.addresses,
      });
    },
  );

  r.post(
    '/v1/addresses',
    {
      schema: {
        tags: ['me'],
        summary: 'Save a delivery address',
        body: AddressInput,
        response: created(AddressDto),
      },
    },
    async (req, reply) => {
      const o = await owner(req);
      const a = await app.prisma.$transaction(async (tx) => {
        const count = await tx.address.count({ where: scopeOf(o) });
        if (count >= 20) throw Errors.badRequest('TOO_MANY_ADDRESSES', 'You can save up to 20 addresses');
        const isDefault = req.body.isDefault ?? count === 0;
        if (isDefault) await tx.address.updateMany({ where: scopeOf(o), data: { isDefault: false } });
        return tx.address.create({ data: { ...req.body, isDefault, userId: o.userId, orgId: o.orgId } });
      });
      return reply.status(201).send(a);
    },
  );

  r.patch(
    '/v1/addresses/:id',
    {
      schema: {
        tags: ['me'],
        summary: 'Edit a saved address (set isDefault to make it the default)',
        params: IdParams,
        body: AddressUpdateInput,
        response: ok(AddressDto),
      },
    },
    async (req) => {
      const { o, a } = await load(req, req.params.id);
      return app.prisma.$transaction(async (tx) => {
        if (req.body.isDefault)
          await tx.address.updateMany({ where: scopeOf(o), data: { isDefault: false } });
        // The default can only move to another address, never be switched off.
        const { isDefault, ...rest } = req.body;
        return tx.address.update({
          where: { id: a.id },
          data: { ...rest, ...(isDefault ? { isDefault: true } : {}) },
        });
      });
    },
  );

  r.delete(
    '/v1/addresses/:id',
    { schema: { tags: ['me'], summary: 'Delete a saved address', params: IdParams, response: ok(Ok) } },
    async (req) => {
      const { o, a } = await load(req, req.params.id);
      await app.prisma.$transaction(async (tx) => {
        await tx.address.delete({ where: { id: a.id } });
        if (a.isDefault) {
          // Keep one default while any address is left.
          const next = await tx.address.findFirst({ where: scopeOf(o), orderBy: { createdAt: 'asc' } });
          if (next) await tx.address.update({ where: { id: next.id }, data: { isDefault: true } });
        }
      });
      return { ok: true as const };
    },
  );
}
