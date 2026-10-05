/**
 * Observability bootstrap. Imported first by server.ts so instrumentation patches modules
 * before they load. Both parts are no-ops unless configured.
 *   SENTRY_DSN                    -> error reporting
 *   OTEL_EXPORTER_OTLP_ENDPOINT   -> traces (Fastify, HTTP, Prisma, ioredis) to Tempo/Grafana
 */
import { env } from '@farmgo/config';
import * as Sentry from '@sentry/node';

if (env.SENTRY_DSN) {
  Sentry.init({ dsn: env.SENTRY_DSN, environment: env.NODE_ENV, tracesSampleRate: 0.1 });
}

if (env.OTEL_EXPORTER_OTLP_ENDPOINT) {
  const [{ NodeSDK }, { getNodeAutoInstrumentations }, { OTLPTraceExporter }, { PrismaInstrumentation }] =
    await Promise.all([
      import('@opentelemetry/sdk-node'),
      import('@opentelemetry/auto-instrumentations-node'),
      import('@opentelemetry/exporter-trace-otlp-http'),
      import('@prisma/instrumentation'),
    ]);
  const sdk = new NodeSDK({
    serviceName: process.env.SERVICE_NAME ?? 'farmgo-api',
    traceExporter: new OTLPTraceExporter({ url: `${env.OTEL_EXPORTER_OTLP_ENDPOINT}/v1/traces` }),
    instrumentations: [
      getNodeAutoInstrumentations({ '@opentelemetry/instrumentation-fs': { enabled: false } }),
      new PrismaInstrumentation(),
    ],
  });
  sdk.start();
  process.once('SIGTERM', () => void sdk.shutdown());
}
