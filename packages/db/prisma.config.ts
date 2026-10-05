import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { config as loadDotenv } from 'dotenv';
import { defineConfig } from 'prisma/config';

// Only DATABASE_URL matters here, so load the monorepo .env if present (local development)
// without validating the rest of the app's configuration. `prisma generate` needs no database,
// e.g. in Docker builds; migrate commands get DATABASE_URL from the environment.
const rootEnv = resolve(import.meta.dirname, '../../.env');
if (existsSync(rootEnv)) loadDotenv({ path: rootEnv, quiet: true, override: false });

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
    // Seeding lives in apps/api (it needs Better Auth to hash passwords): pnpm db:seed
  },
  datasource: {
    url: process.env.DATABASE_URL ?? 'postgresql://unset@localhost:5432/unset',
  },
});
