import { defineConfig } from 'vitest/config';

const TEST_DB = process.env.TEST_DATABASE_URL ?? 'postgresql://farmgo:farmgo@localhost:5440/farmgo_test';
const TEST_REDIS = process.env.TEST_REDIS_URL ?? 'redis://localhost:6390/1';

// Integration tests run against a real Postgres + Redis (infra/docker-compose.yml locally,
// service containers in CI). They share one database, so files run one at a time.
export default defineConfig({
  test: {
    globals: true,
    globalSetup: ['./test/global-setup.ts'],
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 60_000,
    env: {
      NODE_ENV: 'test',
      LOG_LEVEL: 'silent',
      DATABASE_URL: TEST_DB,
      REDIS_URL: TEST_REDIS,
      SMS_PROVIDER: 'console',
      PUSH_PROVIDER: 'console',
      MPESA_PROVIDER: 'mock',
      MPESA_CALLBACK_TOKEN: 'test-callback-token',
      AT_USSD_TOKEN: 'test-ussd-token',
      CARD_PROVIDER: 'mock',
      // Tests change users directly in the database; the cache has its own test with it on.
      SESSION_CACHE_SECONDS: '0',
      SKIP_UPLOAD_CHECK: '1',
      BETTER_AUTH_URL: 'http://localhost:4000',
      WEB_URL: 'http://localhost:3000',
      CORS_ORIGINS: 'http://localhost:3000,http://localhost:3001,http://localhost:8081,http://127.0.0.1:8081',
    },
  },
});
