import { requestPayout } from '@farmgo/core';
import type { FastifyInstance } from 'fastify';
import { drainOutbox } from './helpers.js';

export { checkStkStatus, executePayout, generateInvoices } from '@farmgo/core';

/** Relay events, then create any payouts that became eligible (the worker does both). */
export async function drainAll(app: FastifyInstance) {
  await drainOutbox(app);
  const eligible = await app.prisma.order.findMany({
    where: { status: 'PAID', payout: null },
    select: { id: true },
  });
  for (const o of eligible) await requestPayout(app.prisma, o.id);
}
