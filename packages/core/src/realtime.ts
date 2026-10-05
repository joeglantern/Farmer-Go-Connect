import type { RealtimeEnvelope } from '@farmgo/contracts';
import type { Redis } from 'ioredis';

/** Redis pub/sub channel for a realtime channel name. */
export const pubsubKey = (channel: string) => `rt:ch:${channel}`;
const bufferKey = (channel: string) => `rt:buf:${channel}`;
const seqKey = (channel: string) => `rt:seq:${channel}`;
const BUFFER_LEN = 200;
const BUFFER_TTL_SECONDS = 60 * 60;

/**
 * Publish an event to one or more realtime channels. Each channel has its own gap-free,
 * monotonically increasing sequence, and keeps a short buffer so reconnecting clients can
 * catch up by sending the last `seq` they saw on that channel.
 */
export async function publishRealtime(
  redis: Redis,
  channels: string[],
  type: string,
  data: unknown,
): Promise<void> {
  const unique = [...new Set(channels)];
  if (unique.length === 0) return;
  const incr = redis.pipeline();
  for (const channel of unique) {
    incr.incr(seqKey(channel));
    incr.expire(seqKey(channel), 7 * 24 * 3600);
  }
  const results = (await incr.exec()) ?? [];
  const ts = new Date().toISOString();
  const pipe = redis.pipeline();
  unique.forEach((channel, i) => {
    const seq = Number(results[i * 2]?.[1] ?? 0);
    const envelope: RealtimeEnvelope = { channel, type, data, seq, ts };
    const json = JSON.stringify(envelope);
    pipe.zadd(bufferKey(channel), seq, json);
    pipe.zremrangebyrank(bufferKey(channel), 0, -(BUFFER_LEN + 1));
    pipe.expire(bufferKey(channel), BUFFER_TTL_SECONDS);
    pipe.publish(pubsubKey(channel), json);
  });
  await pipe.exec();
}

/**
 * Events on `channel` with seq > lastSeq. `complete` is false when the buffer no longer holds
 * everything the client missed; the client should then refetch over REST.
 */
export async function replayRealtime(
  redis: Redis,
  channel: string,
  lastSeq: number,
): Promise<{ events: RealtimeEnvelope[]; complete: boolean; currentSeq: number }> {
  const [raw, current] = await Promise.all([
    redis.zrangebyscore(bufferKey(channel), `(${lastSeq}`, '+inf'),
    redis.get(seqKey(channel)),
  ]);
  const currentSeq = Number(current ?? 0);
  const events = raw.map((r) => JSON.parse(r) as RealtimeEnvelope);
  const missed = currentSeq - lastSeq;
  const complete = missed <= 0 || events.length === missed;
  return { events, complete, currentSeq };
}
