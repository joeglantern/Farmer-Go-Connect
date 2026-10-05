import { env } from '@farmgo/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { Prisma, PrismaClient } from './generated/prisma/client.js';

export * from './generated/prisma/client.js';
export type { Prisma };

export type Tx = Prisma.TransactionClient;
export type DB = PrismaClient | Tx;

export interface PoolOptions {
  /** Connections this process may hold. Replicas x this must stay under Postgres max_connections. */
  max?: number;
  /** Longest a single statement may run before Postgres cancels it (0 = no limit). */
  statementTimeoutMs?: number;
  /** How long to wait for a free connection or a new one. */
  connectTimeoutMs?: number;
}

/** pg pool settings from the environment (DB_POOL_MAX, DB_STATEMENT_TIMEOUT_MS, DB_CONNECT_TIMEOUT_MS). */
export function poolConfig(connectionString: string, o: PoolOptions = {}) {
  const statementTimeout = o.statementTimeoutMs ?? env.DB_STATEMENT_TIMEOUT_MS;
  return {
    connectionString,
    max: o.max ?? env.DB_POOL_MAX,
    connectionTimeoutMillis: o.connectTimeoutMs ?? env.DB_CONNECT_TIMEOUT_MS,
    idleTimeoutMillis: 30_000,
    ...(statementTimeout > 0 ? { statement_timeout: statementTimeout } : {}),
    application_name: process.env.SERVICE_NAME ?? 'farmgo',
  };
}

export function createPrisma(connectionString = env.DATABASE_URL, pool: PoolOptions = {}): PrismaClient {
  const adapter = new PrismaPg(poolConfig(connectionString, pool));
  return new PrismaClient({
    adapter,
    log: env.LOG_LEVEL === 'trace' ? ['query', 'warn', 'error'] : ['warn', 'error'],
  });
}

const globalForPrisma = globalThis as unknown as { __farmgoPrisma?: PrismaClient };

/** Process-wide Prisma client (one pool per process). */
export const prisma: PrismaClient = globalForPrisma.__farmgoPrisma ?? createPrisma();
if (env.NODE_ENV !== 'production') globalForPrisma.__farmgoPrisma = prisma;

/** Convert Prisma.Decimal (or null) to a JS number. Quantities fit comfortably in a double. */
export function num(value: Prisma.Decimal | number | string | null | undefined): number {
  if (value === null || value === undefined) return 0;
  if (typeof value === 'number') return value;
  return Number(value.toString());
}

export const Decimal = Prisma.Decimal;
