import { createBullBoard } from '@bull-board/api';
import { BullMQAdapter } from '@bull-board/api/bullMQAdapter';
import { FastifyAdapter } from '@bull-board/fastify';
import { getQueue, QUEUE_NAMES } from '@farmgo/core';
import fp from 'fastify-plugin';

/** Bull Board at /admin/queues (admins only): job status, retries and the dead-letter view. */
export default fp(
  async (app) => {
    const serverAdapter = new FastifyAdapter();
    serverAdapter.setBasePath('/admin/queues');
    createBullBoard({
      queues: QUEUE_NAMES.map((n) => new BullMQAdapter(getQueue(n))),
      serverAdapter,
      options: { uiConfig: { boardTitle: 'FarmGo jobs' } },
    });
    await app.register(async (scoped) => {
      scoped.addHook('onRequest', async (req, reply) => {
        if (req.user?.role !== 'admin') {
          return reply
            .status(403)
            .send({ error: { code: 'FORBIDDEN', message: 'Admins only', requestId: req.id } });
        }
      });
      await scoped.register(serverAdapter.registerPlugin(), { prefix: '/admin/queues' });
    });
  },
  { name: 'queue-board', dependencies: ['auth'] },
);
