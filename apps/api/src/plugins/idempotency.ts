import fp from 'fastify-plugin';

const TTL_SECONDS = 24 * 3600;
/** Scoped to the caller and the route, so reusing a key on another endpoint never replays a stranger response. */
const key = (userId: string, route: string, k: string) => `idem:${userId}:${route}:${k}`;

/**
 * Offline-first clients send an `Idempotency-Key` header with every write so a request
 * retried after a dropped connection is applied once. The first response is replayed for
 * repeats; a repeat while the first is still running gets 409.
 */
export default fp(
  async (app) => {
    app.addHook('preHandler', async (req, reply) => {
      const idem = req.headers['idempotency-key'];
      if (typeof idem !== 'string' || !req.user || !['POST', 'PATCH', 'PUT', 'DELETE'].includes(req.method))
        return;
      if (idem.length > 100)
        return reply.status(400).send({
          error: { code: 'BAD_IDEMPOTENCY_KEY', message: 'Idempotency-Key is too long', requestId: req.id },
        });
      const k = key(req.user.id, `${req.method} ${req.routeOptions.url ?? req.url}`, idem);
      const claimed = await app.redis.set(
        k,
        JSON.stringify({ state: 'pending', route: req.routeOptions.url }),
        'EX',
        TTL_SECONDS,
        'NX',
      );
      if (claimed) {
        (req as unknown as { idemKey?: string }).idemKey = k;
        return;
      }
      const stored = JSON.parse((await app.redis.get(k)) ?? '{}') as {
        state?: string;
        status?: number;
        body?: string;
      };
      if (stored.state === 'done') {
        reply.header('Idempotent-Replay', 'true').header('content-type', 'application/json; charset=utf-8');
        return reply.status(stored.status ?? 200).send(stored.body);
      }
      return reply.status(409).send({
        error: {
          code: 'IDEMPOTENCY_IN_PROGRESS',
          message: 'This request is already being processed',
          requestId: req.id,
        },
      });
    });

    app.addHook('onSend', async (req, reply, payload) => {
      const k = (req as unknown as { idemKey?: string }).idemKey;
      if (!k) return payload;
      if (reply.statusCode >= 500) {
        await app.redis.del(k); // allow a retry after a server error
      } else {
        await app.redis.set(
          k,
          JSON.stringify({ state: 'done', status: reply.statusCode, body: String(payload ?? '') }),
          'EX',
          TTL_SECONDS,
        );
      }
      return payload;
    });
  },
  { name: 'idempotency', dependencies: ['infra', 'auth'] },
);
