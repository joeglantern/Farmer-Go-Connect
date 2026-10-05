import {
  AgentCreateFarmerInput,
  AgentFarmerCreatedDto,
  AgentFarmerDto,
  FarmDto,
  FarmInput,
  IdParams,
  Pagination,
  page,
} from '@farmgo/contracts';
import { Errors } from '@farmgo/core';
import type { FastifyInstance } from 'fastify';
import { isAdmin, requirePermission } from '../lib/guards.js';
import { cursorArgs, paginate } from '../lib/pagination.js';
import { created, ok, typed } from '../lib/route.js';
import { agentCreateFarmer } from './onboarding.service.js';
import { assertOwnKeys } from './uploads.routes.js';

/**
 * Field agents onboard farmers who may not own smartphones, then add farms and listings on
 * their behalf (listings use the normal POST /v1/supply with the farmer's farmId).
 */
export default async function agentRoutes(app: FastifyInstance) {
  const r = typed(app);

  r.post(
    '/v1/agent/farmers',
    {
      schema: {
        tags: ['me'],
        summary: 'Register a farmer (field agent)',
        body: AgentCreateFarmerInput,
        response: created(AgentFarmerCreatedDto),
      },
    },
    async (req, reply) => {
      const agent = requirePermission(req, { farmer: ['onboard'] });
      if (req.body.farm?.photoKey) await assertOwnKeys(req, [req.body.farm.photoKey]);
      const result = await agentCreateFarmer(app.prisma, agent, req.body);
      return reply.status(201).send(result);
    },
  );

  r.get(
    '/v1/agent/farmers',
    {
      schema: {
        tags: ['me'],
        summary: 'Farmers I onboarded',
        querystring: Pagination,
        response: ok(page(AgentFarmerDto)),
      },
    },
    async (req) => {
      const agent = requirePermission(req, { farmer: ['onboard'] });
      const rows = await app.prisma.farmerProfile.findMany({
        where: isAdmin(agent) ? {} : { onboardedById: agent.id },
        include: {
          user: {
            select: { id: true, name: true, phoneNumber: true, county: true, phoneNumberVerified: true },
          },
          farms: true,
        },
        orderBy: { id: 'desc' },
        ...cursorArgs(req.query.cursor, req.query.limit),
      });
      return paginate(rows, req.query.limit);
    },
  );

  r.post(
    '/v1/agent/farmers/:id/farms',
    {
      schema: {
        tags: ['farms'],
        summary: 'Add a farm for a farmer (field agent)',
        params: IdParams,
        body: FarmInput,
        response: created(FarmDto),
      },
    },
    async (req, reply) => {
      const agent = requirePermission(req, { farmer: ['onboard'] });
      const profile = await app.prisma.farmerProfile.findUnique({ where: { id: req.params.id } });
      if (!profile || (!isAdmin(agent) && profile.onboardedById !== agent.id))
        throw Errors.notFound('Farmer');
      if (req.body.photoKey) await assertOwnKeys(req, [req.body.photoKey]);
      const farm = await app.prisma.farm.create({ data: { ...req.body, farmerId: profile.id } });
      return reply.status(201).send(farm);
    },
  );
}
