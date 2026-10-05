import type { Auth, AuthSession } from '@farmgo/auth';
import type { PrismaClient } from '@farmgo/db';
import type { Redis } from 'ioredis';

export type SessionUser = AuthSession['user'] & { role?: string | null; phoneNumber?: string | null };
export type SessionInfo = AuthSession['session'] & { activeOrganizationId?: string | null };

declare module 'fastify' {
  interface FastifyInstance {
    prisma: PrismaClient;
    redis: Redis;
    auth: Auth;
    /** Set when shutdown starts: /health/ready answers 503 so the proxy stops sending traffic. */
    lifecycle: { draining: boolean };
    /** Seconds a resolved session stays in the Redis cache (0 = off). */
    sessionCacheSeconds: number;
    /** False while Redis (the rate limiter's store) is unreachable: auth and money routes refuse. */
    rateLimitStoreReady: () => boolean;
  }
  interface FastifyRequest {
    user: SessionUser | null;
    session: SessionInfo | null;
  }
}
