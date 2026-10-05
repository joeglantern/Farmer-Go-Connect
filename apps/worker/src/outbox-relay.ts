import { env } from '@farmgo/config';
import { logger, relayOutboxBatch, routeEvent } from '@farmgo/core';
import type { PrismaClient } from '@farmgo/db';
import type { Redis } from 'ioredis';
import pg from 'pg';

const POLL_MS = 1_000;

/**
 * Relays committed outbox events to Redis (WebSockets) and job queues. Wakes immediately on
 * Postgres NOTIFY and polls as a fallback, so events flow even if the LISTEN connection drops.
 * Safe to run on several workers at once (rows are claimed with SKIP LOCKED).
 */
export class OutboxRelay {
  private running = false;
  private pending = false;
  private timer?: NodeJS.Timeout;
  private listener?: pg.Client;
  private stopped = false;

  constructor(
    private readonly prisma: PrismaClient,
    private readonly redis: Redis,
  ) {}

  async start() {
    await this.listen();
    this.timer = setInterval(() => void this.drain(), POLL_MS);
    void this.drain();
    logger.info('outbox relay started');
  }

  private async listen() {
    try {
      const client = new pg.Client({ connectionString: env.DATABASE_URL });
      client.on('error', (err) => {
        logger.warn({ err }, 'outbox LISTEN connection lost; relying on polling until it reconnects');
        this.listener = undefined;
        if (!this.stopped) setTimeout(() => void this.listen(), 5_000);
      });
      await client.connect();
      await client.query('LISTEN farmgo_outbox');
      client.on('notification', () => void this.drain());
      this.listener = client;
    } catch (err) {
      logger.warn({ err }, 'could not LISTEN for outbox events; polling only');
      if (!this.stopped) setTimeout(() => void this.listen(), 5_000);
    }
  }

  /** Process batches until the outbox is empty. Coalesces overlapping wake-ups. */
  async drain(): Promise<void> {
    if (this.running) {
      this.pending = true;
      return;
    }
    this.running = true;
    try {
      do {
        this.pending = false;
        let n: number;
        do {
          n = await relayOutboxBatch(this.prisma, (row) => routeEvent(this.prisma, this.redis, row));
        } while (n > 0 && !this.stopped);
      } while (this.pending && !this.stopped);
    } catch (err) {
      logger.error({ err }, 'outbox relay batch failed');
    } finally {
      this.running = false;
    }
  }

  async stop() {
    this.stopped = true;
    if (this.timer) clearInterval(this.timer);
    await this.listener?.end().catch(() => undefined);
    while (this.running) await new Promise((r) => setTimeout(r, 50));
  }
}
