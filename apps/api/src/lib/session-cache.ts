import { createHash } from 'node:crypto';
import type { FastifyRequest } from 'fastify';
import type { Redis } from 'ioredis';
import type { SessionInfo, SessionUser } from '../types.js';

/**
 * A short Redis cache of resolved sessions (Better Auth session plus the fresh user row), keyed
 * by a hash of the credential. Every user has a generation number; anything that changes the
 * user, their sessions or their role bumps it, and entries from an older generation are ignored.
 * Sign-out, bans, role changes and onboarding therefore apply on the next request.
 */
const ENTRY = (hash: string) => `sess:c:${hash}`;
const GEN = (userId: string) => `sess:gen:${userId}`;

interface Entry {
  gen: string;
  user: SessionUser;
  session: SessionInfo;
}

const SESSION_COOKIES = ['farmgo.session_token', '__Secure-farmgo.session_token'];

/** Hash of whatever identifies the session on this request, or null when there is none. */
export function credentialHash(req: FastifyRequest): string | null {
  const auth = req.headers.authorization ?? '';
  const cookie = req.headers.cookie ?? '';
  const sessionCookie = cookie
    .split(';')
    .map((c) => c.trim())
    .find((c) => SESSION_COOKIES.some((name) => c.startsWith(`${name}=`)));
  if (!auth && !sessionCookie) return null;
  return createHash('sha256')
    .update(`${auth}\n${sessionCookie ?? ''}`)
    .digest('hex');
}

const DATE_FIELDS = new Set(['createdAt', 'updatedAt', 'expiresAt', 'banExpires', 'dateOfBirth']);
const revive = (key: string, value: unknown) =>
  DATE_FIELDS.has(key) && typeof value === 'string' ? new Date(value) : value;

export async function readSession(redis: Redis, hash: string): Promise<Entry | null> {
  const raw = await redis.get(ENTRY(hash));
  if (!raw) return null;
  const entry = JSON.parse(raw, revive) as Entry;
  const expires = (entry.session as { expiresAt?: Date }).expiresAt;
  if (expires && expires.getTime() <= Date.now()) return null;
  const gen = (await redis.get(GEN(entry.user.id))) ?? '0';
  return gen === entry.gen ? entry : null;
}

/** The user's current generation; read it before resolving the session, then store with it. */
export async function currentGen(redis: Redis, userId: string) {
  return (await redis.get(GEN(userId))) ?? '0';
}

export async function writeSession(
  redis: Redis,
  hash: string,
  value: { gen: string; user: SessionUser; session: SessionInfo },
  ttlSeconds: number,
) {
  await redis.set(ENTRY(hash), JSON.stringify(value), 'EX', ttlSeconds);
}

/** Invalidate every cached session of this user. */
export async function bumpUser(redis: Redis, userId: string) {
  await redis
    .multi()
    .incr(GEN(userId))
    .expire(GEN(userId), 7 * 86_400)
    .exec();
}
