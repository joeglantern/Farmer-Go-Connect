import type { FastifyInstance } from 'fastify';
import { bumpUser } from './session-cache.js';

/**
 * Better Auth caches each session together with a copy of its user in Redis. When we change
 * user fields that Better Auth also reads (role, ban, name), push the change through its
 * internal adapter so every cached session is refreshed; otherwise its own endpoints (admin,
 * organization) would keep seeing the old role.
 */
export async function syncAuthUser(app: FastifyInstance, userId: string): Promise<void> {
  const u = await app.prisma.user.findUnique({ where: { id: userId } });
  if (!u) return;
  const ctx = await app.auth.$context;
  await ctx.internalAdapter.updateUser(userId, {
    role: u.role,
    name: u.name,
    banned: u.banned,
    banReason: u.banReason,
    county: u.county,
    preferredLanguage: u.preferredLanguage,
  });
  await bumpUser(app.redis, userId);
}

/** Sign a user out everywhere: database rows and cached sessions. */
export async function revokeAllSessions(app: FastifyInstance, userId: string): Promise<void> {
  const ctx = await app.auth.$context;
  await ctx.internalAdapter.deleteUserSessions(userId);
  await bumpUser(app.redis, userId);
}
