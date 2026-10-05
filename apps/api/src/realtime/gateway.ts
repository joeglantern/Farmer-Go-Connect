import { ClientMessage, channels, WS_CLOSE } from '@farmgo/contracts';
import { AppError, createRedis, replayRealtime } from '@farmgo/core';
import websocket from '@fastify/websocket';
import type { FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';
import { recordLocation } from '../modules/logistics.service.js';
import { loadSession } from '../plugins/auth.js';
import { canSubscribe } from './access.js';
import { Hub } from './hub.js';

/** Subprotocol that carries the bearer token: `Sec-WebSocket-Protocol: farmgo.bearer, <token>`. */
export const BEARER_PROTOCOL = 'farmgo.bearer';

/** The bearer token offered as a WebSocket subprotocol, if any (URL-encoded by the client). */
export function tokenFromProtocols(header: string | string[] | undefined): string | null {
  const values = (Array.isArray(header) ? header.join(',') : (header ?? ''))
    .split(',')
    .map((v) => v.trim())
    .filter(Boolean);
  if (!values.includes(BEARER_PROTOCOL)) return null;
  const token = values.find((v) => v !== BEARER_PROTOCOL);
  if (!token) return null;
  try {
    return decodeURIComponent(token);
  } catch {
    return null;
  }
}

/**
 * wss://<api>/ws, authenticated with the session cookie (web) or a bearer token. Clients send the
 * token, in order of preference, in the `Authorization` header, as the subprotocol pair
 * `farmgo.bearer, <url-encoded token>` (browsers cannot set headers on a WebSocket), or as
 * `?token=` (kept for older clients; redacted from logs). See @farmgo/contracts realtime.ts.
 */
export default fp(
  async (app: FastifyInstance) => {
    await app.register(websocket, {
      options: {
        maxPayload: 16 * 1024,
        // Agree to the bearer subprotocol so browsers accept the upgrade; the token itself is
        // never echoed back.
        handleProtocols: (protocols) => (protocols.has(BEARER_PROTOCOL) ? BEARER_PROTOCOL : false),
      },
    });
    const hub = new Hub(createRedis());
    hub.start();
    app.addHook('onClose', async () => hub.close());
    app.decorate('realtimeHub', hub);

    app.get('/ws', { websocket: true, schema: { hide: true } }, async (socket, req) => {
      // Listen before the first await: a client may send `subscribe` the moment the socket opens,
      // while we are still loading the session and auto-joining (QA-033). Messages are buffered
      // until the connection is ready, then every message is handled strictly in arrival order.
      const early: Buffer[] = [];
      let handle: ((raw: Buffer) => Promise<unknown>) | null = null;
      let queue: Promise<unknown> = Promise.resolve();
      let closed = false;
      const enqueue = (raw: Buffer) => {
        queue = queue.then(() => handle?.(raw)).catch((err) => req.log.error({ err }, 'ws message failed'));
      };
      socket.on('message', (raw: Buffer) => {
        if (handle) enqueue(raw);
        else if (early.length < 50) early.push(raw);
      });
      let onClose = () => {
        closed = true;
      };
      socket.on('close', () => onClose());

      if (!req.user) {
        const token =
          tokenFromProtocols(req.headers['sec-websocket-protocol']) ??
          (req.query as { token?: string }).token;
        if (token) {
          req.headers.authorization = `Bearer ${token}`;
          await loadSession(app.auth, req);
        }
      }
      const user = req.user;
      if (!user || user.banned) {
        socket.close(WS_CLOSE.UNAUTHORIZED, 'unauthorized');
        return;
      }

      if (closed) return;
      const conn = hub.register(socket, user);
      onClose = () => void hub.unregister(conn);
      const auto = [channels.user(user.id)];
      const orgId = req.session?.activeOrganizationId;
      const memberships = await app.prisma.member.findMany({
        where: { userId: user.id },
        select: { organizationId: true },
      });
      for (const m of memberships)
        if (!orgId || m.organizationId === orgId) auto.push(channels.org(m.organizationId));
      if (user.role && user.role !== 'user') auto.push(channels.role(user.role));
      for (const ch of auto) await hub.join(conn, ch);
      conn.send({ op: 'hello', userId: user.id, channels: auto, serverTime: new Date().toISOString() });
      if (closed) {
        void hub.unregister(conn);
        return;
      }

      handle = async (raw: Buffer) => {
        if (!conn.allow()) return conn.send({ op: 'error', code: 'RATE_LIMITED' });
        let parsed: ClientMessage;
        try {
          const r = ClientMessage.safeParse(JSON.parse(raw.toString()));
          if (!r.success)
            return conn.send({ op: 'error', code: 'BAD_MESSAGE', message: r.error.issues[0]?.message });
          parsed = r.data;
        } catch {
          return conn.send({ op: 'error', code: 'BAD_MESSAGE', message: 'Messages must be JSON' });
        }
        try {
          switch (parsed.op) {
            case 'ping':
              conn.alive = true;
              return conn.send({ op: 'pong' });
            case 'subscribe': {
              if (!(await canSubscribe(app.prisma, user, parsed.channel))) {
                return conn.send({ op: 'error', code: 'FORBIDDEN_CHANNEL', channel: parsed.channel });
              }
              await hub.join(conn, parsed.channel);
              conn.send({ op: 'subscribed', channel: parsed.channel });
              if (parsed.lastSeq !== undefined) {
                const { events, complete } = await replayRealtime(app.redis, parsed.channel, parsed.lastSeq);
                for (const e of events)
                  conn.send({
                    op: 'event',
                    channel: e.channel,
                    type: e.type,
                    data: e.data,
                    seq: e.seq,
                    ts: e.ts,
                  });
                // Tell the client to refetch over REST when the buffer could not cover the gap.
                if (!complete)
                  conn.send({
                    op: 'event',
                    channel: parsed.channel,
                    type: 'resync',
                    data: null,
                    seq: parsed.lastSeq,
                    ts: new Date().toISOString(),
                  });
              }
              return;
            }
            case 'unsubscribe':
              await hub.leave(conn, parsed.channel);
              return conn.send({ op: 'unsubscribed', channel: parsed.channel });
            case 'location': {
              if (user.role !== 'driver' && user.role !== 'admin')
                return conn.send({ op: 'error', code: 'FORBIDDEN' });
              const { op: _op, ...ping } = parsed;
              await recordLocation(app.prisma, app.redis, user.id, ping);
              return;
            }
          }
        } catch (err) {
          if (err instanceof AppError)
            return conn.send({ op: 'error', code: 'FORBIDDEN', message: err.message });
          req.log.error({ err }, 'ws message failed');
          return conn.send({ op: 'error', code: 'INTERNAL' });
        }
      };
      for (const raw of early.splice(0)) enqueue(raw);
    });
  },
  { name: 'realtime', dependencies: ['infra', 'auth'] },
);

declare module 'fastify' {
  interface FastifyInstance {
    realtimeHub: Hub;
  }
}
