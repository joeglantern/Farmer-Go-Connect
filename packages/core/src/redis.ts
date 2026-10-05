import { env } from '@farmgo/config';
import { Redis, type RedisOptions } from 'ioredis';

export { Redis };

/** Create a Redis connection. BullMQ requires maxRetriesPerRequest=null on its connections. */
export function createRedis(opts: RedisOptions = {}, url = env.REDIS_URL): Redis {
  return new Redis(url, { maxRetriesPerRequest: null, enableReadyCheck: true, lazyConnect: false, ...opts });
}

let shared: Redis | undefined;
/** Process-wide command connection (not for SUBSCRIBE). */
export function getRedis(): Redis {
  shared ??= createRedis();
  return shared;
}

export async function closeRedis(): Promise<void> {
  if (shared) {
    await shared.quit().catch(() => undefined);
    shared = undefined;
  }
}

/** Key/value adapter used by Better Auth secondary storage. */
export function redisKeyValue(redis: Redis) {
  return {
    get: (key: string) => redis.get(`auth:${key}`),
    set: (key: string, value: string, ttl?: number) =>
      ttl ? redis.set(`auth:${key}`, value, 'EX', ttl) : redis.set(`auth:${key}`, value),
    delete: async (key: string) => {
      await redis.del(`auth:${key}`);
    },
    getAndDelete: (key: string) => redis.getdel(`auth:${key}`),
    increment: async (key: string, ttl: number) => {
      const [[, value]] = (await redis
        .multi()
        .incr(`auth:${key}`)
        .expire(`auth:${key}`, ttl, 'NX')
        .exec()) as [[Error | null, number], unknown];
      return value;
    },
  };
}
