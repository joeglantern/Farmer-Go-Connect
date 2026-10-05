import type { TransitionActor } from '@farmgo/contracts';
import { Errors } from '@farmgo/core';
import type { Order, Prisma } from '@farmgo/db';
import type { FastifyRequest } from 'fastify';
import { requireOrg, requireUser, roleOf } from '../lib/guards.js';

export type OrderViewer = 'buyer' | 'farmer' | 'qa' | 'driver' | 'admin' | 'agent';

/** How the signed-in user relates to an order (or 404 so order ids are not enumerable). */
export async function orderViewer(req: FastifyRequest, order: Order): Promise<OrderViewer> {
  const user = requireUser(req);
  const role = roleOf(user);
  const prisma = req.server.prisma;
  if (role === 'admin') return 'admin';
  if (order.farmerId === user.id) return 'farmer';
  const member = await prisma.member.findFirst({
    where: { organizationId: order.buyerOrgId, userId: user.id },
  });
  if (member) return 'buyer';
  // QA officers see orders at the inspection stage (the same set as their order list and tasks).
  if (role === 'qa_officer' && ['READY_FOR_QA', 'QA_PASSED', 'QA_REJECTED'].includes(order.status))
    return 'qa';
  if (role === 'driver' && order.routeId) {
    const route = await prisma.route.findUnique({ where: { id: order.routeId } });
    if (route?.driverId === user.id) return 'driver';
  }
  if (role === 'agent') {
    const fp = await prisma.farmerProfile.findUnique({ where: { userId: order.farmerId } });
    if (fp?.onboardedById === user.id) return 'agent';
  }
  throw Errors.notFound('Order');
}

export async function loadOrder(req: FastifyRequest, orderId: string) {
  const order = await req.server.prisma.order.findUnique({ where: { id: orderId } });
  if (!order) throw Errors.notFound('Order');
  const viewer = await orderViewer(req, order);
  return { order, viewer };
}

/** The orders the signed-in user can list (their side of each order). */
export async function orderScope(req: FastifyRequest): Promise<Prisma.OrderWhereInput> {
  const user = requireUser(req);
  switch (roleOf(user)) {
    case 'admin':
      return {};
    case 'farmer':
      return { farmerId: user.id };
    case 'driver':
      return { route: { driverId: user.id } };
    case 'qa_officer':
      return { status: { in: ['READY_FOR_QA', 'QA_PASSED', 'QA_REJECTED'] } };
    case 'agent':
      return { farmer: { farmerProfile: { onboardedById: user.id } } };
    default: {
      const { orgId } = await requireOrg(req, 'BUYER');
      return { buyerOrgId: orgId };
    }
  }
}

/** State-machine actor for a viewer. Agents act for their farmers. */
export function actorFor(viewer: OrderViewer): TransitionActor {
  if (viewer === 'agent') return 'farmer';
  return viewer;
}
