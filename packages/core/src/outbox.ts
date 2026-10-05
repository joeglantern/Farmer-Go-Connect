import type { DomainEvents, DomainEventType } from '@farmgo/contracts';
import type { DB, PrismaClient } from '@farmgo/db';
import { logger } from './logger.js';

/**
 * Record a domain event in the transactional outbox. Call with the transaction client so the
 * event commits atomically with the state change. `pg_notify` wakes the relay immediately
 * (Postgres delivers NOTIFY only on commit).
 */
export async function emit<T extends DomainEventType>(
  db: DB,
  type: T,
  payload: DomainEvents[T],
  aggregateId?: string,
): Promise<void> {
  await db.outboxEvent.create({
    data: { type, payload: payload as object, aggregateId: aggregateId ?? null },
  });
  await db.$executeRawUnsafe(`SELECT pg_notify('farmgo_outbox', '')`);
}

export interface OutboxRow {
  id: bigint;
  type: string;
  payload: unknown;
  attempts: number;
}

const MAX_ATTEMPTS = 10;

/**
 * Claim and process one batch of pending outbox events. Uses FOR UPDATE SKIP LOCKED so
 * several relays can run concurrently without double-processing.
 * Returns the number of events handled.
 */
export async function relayOutboxBatch(
  prisma: PrismaClient,
  handle: (row: OutboxRow) => Promise<void>,
  batchSize = 100,
): Promise<number> {
  return prisma.$transaction(
    async (tx) => {
      const rows = await tx.$queryRawUnsafe<OutboxRow[]>(
        `SELECT id, type, payload, attempts FROM "OutboxEvent"
         WHERE "processedAt" IS NULL
         ORDER BY id
         LIMIT $1
         FOR UPDATE SKIP LOCKED`,
        batchSize,
      );
      for (const row of rows) {
        try {
          await handle(row);
          await tx.outboxEvent.update({ where: { id: row.id }, data: { processedAt: new Date() } });
        } catch (err) {
          const attempts = row.attempts + 1;
          const message = err instanceof Error ? err.message : String(err);
          logger.error({ err, eventId: row.id.toString(), type: row.type, attempts }, 'outbox relay failed');
          await tx.outboxEvent.update({
            where: { id: row.id },
            data: {
              attempts,
              lastError: message.slice(0, 1000),
              // Give up after MAX_ATTEMPTS so one poison event cannot block the stream.
              processedAt: attempts >= MAX_ATTEMPTS ? new Date() : null,
            },
          });
        }
      }
      return rows.length;
    },
    { timeout: 30_000 },
  );
}
