import { z } from 'zod';
import { LocationPing } from './inputs.js';

/**
 * WebSocket protocol for wss://<api>/ws
 *
 * Channels:
 *   user:{userId}              personal events (auto-joined)
 *   org:{orgId}                organization events (auto-joined for the active org)
 *   order:{orderId}            order status, chat, live delivery tracking
 *   route:{routeId}            driver route updates
 *   role:{role}                broadcast to a staff role (e.g. role:qa_officer)
 *   role:{role}:{county}       role broadcast scoped to a county
 *   demand:{county}            aggregated demand board updates for farmers
 *   prices:{county}            price index updates
 */
export const Channel = z
  .string()
  .max(120)
  .regex(/^(user|org|order|route|role|demand|prices):[A-Za-z0-9_' -]+(:[A-Za-z0-9_' -]+)?$/);

export const ClientMessage = z.discriminatedUnion('op', [
  z.object({
    op: z.literal('subscribe'),
    channel: Channel,
    lastSeq: z.number().int().nonnegative().optional(),
  }),
  z.object({ op: z.literal('unsubscribe'), channel: Channel }),
  z.object({ op: z.literal('ping') }),
  z.object({ op: z.literal('location') }).extend(LocationPing.shape),
]);
export type ClientMessage = z.infer<typeof ClientMessage>;

export type ServerMessage =
  | { op: 'hello'; userId: string; channels: string[]; serverTime: string }
  | { op: 'subscribed'; channel: string }
  | { op: 'unsubscribed'; channel: string }
  | { op: 'event'; channel: string; type: string; data: unknown; seq: number; ts: string }
  | { op: 'pong' }
  | { op: 'error'; code: WsErrorCode; message?: string; channel?: string };

export type WsErrorCode = 'BAD_MESSAGE' | 'FORBIDDEN_CHANNEL' | 'RATE_LIMITED' | 'FORBIDDEN' | 'INTERNAL';

/** Envelope published on Redis and delivered to sockets. */
export interface RealtimeEnvelope {
  channel: string;
  type: string;
  data: unknown;
  seq: number;
  ts: string;
}

export const WS_CLOSE = {
  UNAUTHORIZED: 4401,
  FORBIDDEN: 4403,
  HEARTBEAT_TIMEOUT: 4408,
  SERVER_SHUTDOWN: 4503,
} as const;

export const channels = {
  user: (id: string) => `user:${id}`,
  org: (id: string) => `org:${id}`,
  order: (id: string) => `order:${id}`,
  route: (id: string) => `route:${id}`,
  role: (role: string, county?: string) => (county ? `role:${role}:${county}` : `role:${role}`),
  demand: (county: string) => `demand:${county}`,
  prices: (county: string) => `prices:${county}`,
};
