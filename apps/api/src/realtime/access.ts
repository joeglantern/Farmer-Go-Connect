import type { PrismaClient } from '@farmgo/db';
import type { SessionUser } from '../types.js';

/**
 * Whether a user may subscribe to a realtime channel. Mirrors the REST access rules so a
 * socket never sees data its owner could not fetch.
 */
export async function canSubscribe(
  prisma: PrismaClient,
  user: SessionUser,
  channel: string,
): Promise<boolean> {
  const [kind, id, extra] = channel.split(':');
  const role = user.role ?? 'user';
  if (!kind || !id) return false;
  if (role === 'admin') return true;

  switch (kind) {
    case 'user':
      return id === user.id;
    case 'org':
      return !!(await prisma.member.findFirst({ where: { organizationId: id, userId: user.id } }));
    case 'order': {
      const order = await prisma.order.findUnique({
        where: { id },
        select: {
          farmerId: true,
          buyerOrgId: true,
          route: { select: { driverId: true } },
          farmer: { select: { farmerProfile: { select: { onboardedById: true } } } },
        },
      });
      if (!order) return false;
      if (order.farmerId === user.id) return true;
      if (order.route?.driverId === user.id) return true;
      if (role === 'qa_officer') return true;
      if (role === 'agent' && order.farmer.farmerProfile?.onboardedById === user.id) return true;
      return !!(await prisma.member.findFirst({
        where: { organizationId: order.buyerOrgId, userId: user.id },
      }));
    }
    case 'route': {
      const route = await prisma.route.findUnique({ where: { id }, select: { driverId: true } });
      return route?.driverId === user.id;
    }
    case 'role':
      // role:{role} and role:{role}:{county}; staff may follow any county for their role.
      void extra;
      return id === role;
    case 'demand':
    case 'prices':
      return true; // public, aggregated information
    default:
      return false;
  }
}
