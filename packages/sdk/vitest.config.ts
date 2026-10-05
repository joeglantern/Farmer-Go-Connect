import { defineConfig } from 'vitest/config';

const TEST_DB = process.env.TEST_DATABASE_URL ?? 'postgresql://farmgo:farmgo@localhost:5440/farmgo_test';
const TEST_REDIS = process.env.TEST_REDIS_URL ?? 'redis://localhost:6390/1';

// Unit tests (src/**/*.test.ts) mock fetch and WebSocket. The integration test (test/**) boots the
// real API against the shared test database, so files run one at a time and the run waits for the
// API's own test task (see packages/sdk/turbo.json) to avoid two runs truncating the same database.
export default defineConfig({
  test: {
    include: ['src/**/*.test.ts', 'test/**/*.test.ts'],
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
      SKIP_UPLOAD_CHECK: '1',
      BETTER_AUTH_URL: 'http://localhost:4000',
      WEB_URL: 'http://localhost:3000',
    },
  },
});
