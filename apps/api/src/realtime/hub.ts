import type { RealtimeEnvelope, ServerMessage } from '@farmgo/contracts';
import { WS_CLOSE } from '@farmgo/contracts';
import { logger, pubsubKey } from '@farmgo/core';
import type { Redis } from 'ioredis';
import type { WebSocket } from 'ws';
import type { SessionUser } from '../types.js';

const HEARTBEAT_MS = 25_000;
const MSG_BUDGET = 30; // messages per window per connection
const MSG_WINDOW_MS = 10_000;

export class Connection {
  readonly channels = new Set<string>();
  alive = true;
  private budget = MSG_BUDGET;
  private windowStart = Date.now();

  constructor(
    readonly socket: WebSocket,
    readonly user: SessionUser,
  ) {}

  send(msg: ServerMessage) {
    if (this.socket.readyState === this.socket.OPEN) this.socket.send(JSON.stringify(msg));
  }

  /** Simple per-connection rate limit. */
  allow(): boolean {
    const now = Date.now();
    if (now - this.windowStart > MSG_WINDOW_MS) {
      this.windowStart = now;
      this.budget = MSG_BUDGET;
    }
    return this.budget-- > 0;
  }
}

/**
 * Local registry of sockets per channel, bridged to Redis pub/sub so events published by any
 * API node or the worker reach sockets on this node. Redis subscriptions are ref-counted:
 * a node only subscribes to channels at least one of its sockets cares about.
 */
export class Hub {
  private readonly byChannel = new Map<string, Set<Connection>>();
  private readonly conns = new Set<Connection>();
  private heartbeat?: NodeJS.Timeout;

  constructor(private readonly sub: Redis) {
    sub.on('message', (redisChannel: string, message: string) => {
      const channel = redisChannel.slice('rt:ch:'.length);
      const targets = this.byChannel.get(channel);
      if (!targets?.size) return;
      let env: RealtimeEnvelope;
      try {
        env = JSON.parse(message) as RealtimeEnvelope;
      } catch {
        return;
      }
      for (const c of targets)
        c.send({ op: 'event', channel, type: env.type, data: env.data, seq: env.seq, ts: env.ts });
    });
  }

  start() {
    this.heartbeat = setInterval(() => {
      for (const c of this.conns) {
        if (!c.alive) {
          c.socket.close(WS_CLOSE.HEARTBEAT_TIMEOUT, 'heartbeat timeout');
          continue;
        }
        c.alive = false;
        try {
          c.socket.ping();
        } catch {
          /* socket already closing */
        }
      }
    }, HEARTBEAT_MS);
    this.heartbeat.unref();
  }

  register(socket: WebSocket, user: SessionUser): Connection {
    const c = new Connection(socket, user);
    this.conns.add(c);
    socket.on('pong', () => {
      c.alive = true;
    });
    return c;
  }

  async join(c: Connection, channel: string) {
    if (c.channels.has(channel)) return;
    c.channels.add(channel);
    let set = this.byChannel.get(channel);
    if (!set) {
      set = new Set();
      this.byChannel.set(channel, set);
      await this.sub.subscribe(pubsubKey(channel));
    }
    set.add(c);
  }

  async leave(c: Connection, channel: string) {
    if (!c.channels.delete(channel)) return;
    const set = this.byChannel.get(channel);
    if (!set) return;
    set.delete(c);
    if (set.size === 0) {
      this.byChannel.delete(channel);
      await this.sub
        .unsubscribe(pubsubKey(channel))
        .catch((err) => logger.warn({ err }, 'unsubscribe failed'));
    }
  }

  async unregister(c: Connection) {
    this.conns.delete(c);
    for (const ch of [...c.channels]) await this.leave(c, ch);
  }

  get size() {
    return this.conns.size;
  }

  async close() {
    if (this.heartbeat) clearInterval(this.heartbeat);
    for (const c of this.conns) c.socket.close(WS_CLOSE.SERVER_SHUTDOWN, 'server shutting down');
    await this.sub.quit().catch(() => undefined);
  }
}
