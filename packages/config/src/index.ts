import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { config as loadDotenv } from 'dotenv';
import { z } from 'zod';

/** Walk up from cwd to find the monorepo .env so every app/package shares one file. */
function findEnvFile(): string | undefined {
  let dir = process.cwd();
  for (let i = 0; i < 6; i++) {
    const candidate = resolve(dir, '.env');
    if (existsSync(candidate)) return candidate;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return undefined;
}

// Values already in the environment (CI, tests, Docker) always win over the .env file.
{
  const path = findEnvFile();
  if (path) loadDotenv({ path, quiet: true, override: false });
}

const csv = z
  .string()
  .default('')
  .transform((v) =>
    v
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
  );

const bool = z
  .enum(['true', 'false', '1', '0'])
  .default('false')
  .transform((v) => v === 'true' || v === '1');

const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),

  API_PORT: z.coerce.number().int().default(4000),
  API_HOST: z.string().default('0.0.0.0'),
  API_URL: z.url().default('http://localhost:4000'),
  WEB_URL: z.url().default('http://localhost:3000'),
  ADMIN_URL: z.url().default('http://localhost:3001'),
  CORS_ORIGINS: csv,
  MOBILE_SCHEME: z.string().default('farmgo://'),
  TRUST_PROXY: bool,

  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().min(1),

  BETTER_AUTH_SECRET: z.string().min(32),
  BETTER_AUTH_URL: z.url(),

  S3_ENDPOINT: z.url(),
  S3_PUBLIC_ENDPOINT: z.url().optional(),
  S3_REGION: z.string().default('us-east-1'),
  S3_ACCESS_KEY: z.string(),
  S3_SECRET_KEY: z.string(),
  S3_BUCKET_PREFIX: z.string().default('farmgo-'),

  SMS_PROVIDER: z.enum(['console', 'africastalking']).default('console'),
  AT_USERNAME: z.string().default('sandbox'),
  AT_API_KEY: z.string().default(''),
  AT_SENDER_ID: z.string().default(''),
  AT_USSD_CODE: z.string().default('*384*123#'),
  /** Shared secret in the USSD callback URL registered with Africa's Talking (?token=...). */
  AT_USSD_TOKEN: z.string().min(8).default('dev-ussd-token'),
  /** Shared secret in the SMS delivery report URL registered with Africa's Talking (?token=...). */
  AT_DLR_TOKEN: z.string().min(8).default('dev-dlr-token'),
  /** Optional allow-list of Africa's Talking callback IPs. */
  AT_ALLOWED_IPS: csv,

  SMTP_HOST: z.string().default('127.0.0.1'),
  SMTP_PORT: z.coerce.number().int().default(1025),
  SMTP_USER: z.string().default(''),
  SMTP_PASS: z.string().default(''),
  EMAIL_FROM: z.string().default('FarmGo Connect <no-reply@farmgo.co.ke>'),

  PUSH_PROVIDER: z.enum(['console', 'expo']).default('console'),
  EXPO_ACCESS_TOKEN: z.string().default(''),

  MPESA_PROVIDER: z.enum(['mock', 'daraja']).default('mock'),
  MPESA_ENV: z.enum(['sandbox', 'production']).default('sandbox'),
  MPESA_CONSUMER_KEY: z.string().default(''),
  MPESA_CONSUMER_SECRET: z.string().default(''),
  MPESA_SHORTCODE: z.string().default('174379'),
  MPESA_PASSKEY: z.string().default(''),
  MPESA_B2C_SHORTCODE: z.string().default('600000'),
  MPESA_B2C_INITIATOR: z.string().default('testapi'),
  MPESA_B2C_SECURITY_CREDENTIAL: z.string().default(''),
  MPESA_CALLBACK_BASE_URL: z.url().default('http://localhost:4000'),
  MPESA_CALLBACK_TOKEN: z.string().min(8).default('dev-callback-token'),
  MPESA_ALLOWED_IPS: csv,

  /** Card payments through a hosted checkout: pesapal, mock (development) or disabled. */
  CARD_PROVIDER: z.enum(['mock', 'pesapal', 'disabled']).default('mock'),
  PESAPAL_ENV: z.enum(['sandbox', 'live']).default('sandbox'),
  PESAPAL_CONSUMER_KEY: z.string().default(''),
  PESAPAL_CONSUMER_SECRET: z.string().default(''),
  /** The IPN id from Pesapal's RegisterIPN, pointing at <API_URL>/webhooks/pesapal. */
  PESAPAL_IPN_ID: z.string().default(''),

  PLATFORM_COMMISSION_BPS: z.coerce.number().int().min(0).max(10_000).default(800),
  DEFAULT_DELIVERY_FEE_CENTS: z.coerce.number().int().min(0).default(30_000),
  MATCH_RADIUS_KM: z.coerce.number().positive().default(80),

  /**
   * Lets NODE_ENV=production run the mock M-Pesa and card providers. Only for a tester stack
   * where no real money moves; never on the live service.
   */
  ALLOW_MOCK_PROVIDERS: bool,
  /** Marks a deployment as a tester stack. Required alongside ALLOW_MOCK_PROVIDERS. */
  TESTER_STACK: bool,
  /** Serve the API reference at /docs in production too. Off by default. */
  DOCS_PUBLIC: bool,

  /** Postgres pool per process, and the longest a single statement may run. */
  DB_POOL_MAX: z.coerce.number().int().min(1).max(200).default(10),
  DB_STATEMENT_TIMEOUT_MS: z.coerce.number().int().min(0).default(15_000),
  DB_CONNECT_TIMEOUT_MS: z.coerce.number().int().min(0).default(5_000),
  /**
   * HTTP server limits: the whole request including its body, an idle socket, and keep-alive.
   * Keep-alive stays longer than the proxy's idle timeout (Caddy is set to 30s) and the idle
   * socket limit longer than keep-alive, so the proxy never reuses a socket the API just closed.
   */
  HTTP_REQUEST_TIMEOUT_MS: z.coerce.number().int().min(0).default(30_000),
  HTTP_CONNECTION_TIMEOUT_MS: z.coerce.number().int().min(0).default(75_000),
  HTTP_KEEP_ALIVE_TIMEOUT_MS: z.coerce.number().int().min(0).default(65_000),
  /** On SIGTERM, how long /health/ready reports draining before the server stops accepting. */
  SHUTDOWN_DRAIN_MS: z.coerce.number().int().min(0).max(60_000).default(5_000),
  /** How long a resolved session is cached in Redis. 0 turns the cache off. */
  SESSION_CACHE_SECONDS: z.coerce.number().int().min(0).max(300).default(30),

  METRICS_TOKEN: z.string().default(''),
  SENTRY_DSN: z.string().default(''),
  OTEL_EXPORTER_OTLP_ENDPOINT: z.string().default(''),
});

export type Env = z.infer<typeof EnvSchema>;

/** Everything that must be fixed before this configuration may run in production. */
export function productionProblems(env: Env): string[] {
  const problems: string[] = [];
  const devSecret = (v: string) => !v || v.startsWith('dev-') || v.startsWith('change-me');
  if (devSecret(env.BETTER_AUTH_SECRET)) problems.push('BETTER_AUTH_SECRET must be set');
  if (devSecret(env.MPESA_CALLBACK_TOKEN) || env.MPESA_CALLBACK_TOKEN.length < 16)
    problems.push('MPESA_CALLBACK_TOKEN must be a random value of at least 16 characters');
  if (devSecret(env.AT_USSD_TOKEN)) problems.push('AT_USSD_TOKEN must be set');
  if (devSecret(env.AT_DLR_TOKEN)) problems.push('AT_DLR_TOKEN must be set');
  if (devSecret(env.METRICS_TOKEN) || env.METRICS_TOKEN.length < 16)
    problems.push('METRICS_TOKEN must be a random value of at least 16 characters');
  if (env.ALLOW_MOCK_PROVIDERS && !env.TESTER_STACK)
    problems.push(
      'ALLOW_MOCK_PROVIDERS=true needs TESTER_STACK=true as well; it is never for the live service',
    );
  if (!(env.ALLOW_MOCK_PROVIDERS && env.TESTER_STACK)) {
    if (env.MPESA_PROVIDER === 'mock') problems.push('MPESA_PROVIDER=mock is not allowed');
    if (env.CARD_PROVIDER === 'mock') problems.push('CARD_PROVIDER=mock is not allowed');
  }
  if (
    env.CARD_PROVIDER === 'pesapal' &&
    (!env.PESAPAL_CONSUMER_KEY || devSecret(env.PESAPAL_CONSUMER_SECRET) || !env.PESAPAL_IPN_ID)
  )
    problems.push('PESAPAL_CONSUMER_KEY, PESAPAL_CONSUMER_SECRET and PESAPAL_IPN_ID are required');
  return problems;
}

function parseEnv(): Env {
  const parsed = EnvSchema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`).join('\n');
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }
  const env = parsed.data;
  if (env.NODE_ENV === 'production') {
    const problems = productionProblems(env);
    if (problems.length)
      throw new Error(`Production configuration is not safe:\n${problems.map((p) => `  - ${p}`).join('\n')}`);
  }
  return env;
}

/** Parse a configuration from explicit values (tests and tooling). */
export function parseEnvFrom(values: Record<string, string | undefined>): Env {
  return EnvSchema.parse(values);
}

export const env: Env = parseEnv();

export const isProd = env.NODE_ENV === 'production';

/** True when production runs mock payment providers on a tester stack. Logged loudly at startup. */
export const mockPaymentsInProduction =
  isProd &&
  env.TESTER_STACK &&
  env.ALLOW_MOCK_PROVIDERS &&
  (env.MPESA_PROVIDER === 'mock' || env.CARD_PROVIDER === 'mock');

export const MOCK_PAYMENTS_WARNING =
  'TESTER STACK: mock M-Pesa and card providers are on. No real money moves. Never run this configuration for real users.';
export const isTest = env.NODE_ENV === 'test';
