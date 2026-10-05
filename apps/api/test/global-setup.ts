import { execSync } from 'node:child_process';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Redis } from 'ioredis';
import pg from 'pg';

const TEST_DB = process.env.TEST_DATABASE_URL ?? 'postgresql://farmgo:farmgo@localhost:5440/farmgo_test';
const TEST_REDIS = process.env.TEST_REDIS_URL ?? 'redis://localhost:6390/1';

/** Migrate the test database, empty every table and the test Redis db before the run. */
export default async function setup() {
  if (!/test/.test(TEST_DB))
    throw new Error(`Refusing to reset a database that is not a test database: ${TEST_DB}`);
  execSync('npx prisma migrate deploy', {
    cwd: resolve(fileURLToPath(new URL('.', import.meta.url)), '../../../packages/db'),
    env: { ...process.env, DATABASE_URL: TEST_DB },
    stdio: 'pipe',
  });

  const client = new pg.Client({ connectionString: TEST_DB });
  await client.connect();
  const { rows } = await client.query<{ tablename: string }>(
    `SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename NOT IN ('_prisma_migrations', 'spatial_ref_sys')`,
  );
  if (rows.length)
    await client.query(`TRUNCATE ${rows.map((r) => `"${r.tablename}"`).join(', ')} RESTART IDENTITY CASCADE`);
  await client.end();

  const redis = new Redis(TEST_REDIS);
  await redis.flushdb();
  await redis.quit();
}
