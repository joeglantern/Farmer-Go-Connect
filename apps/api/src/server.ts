import './telemetry.js';
import { env } from '@farmgo/config';
import { announceTesterStack, closeQueues, ensureBuckets, logger } from '@farmgo/core';
import { buildApp, docsEnabledFor } from './app.js';

process.env.SERVICE_NAME ??= 'farmgo-api';

async function main() {
  announceTesterStack();
  await ensureBuckets().catch((err) =>
    logger.warn({ err }, 'could not verify storage buckets; uploads may fail'),
  );
  const app = await buildApp();
  await app.listen({ port: env.API_PORT, host: env.API_HOST });
  if (docsEnabledFor(env)) app.log.info(`API docs at ${env.API_URL}/docs`);

  let shuttingDown = false;
  const shutdown = async (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    app.log.info({ signal }, 'shutting down');
    const drainMs = env.SHUTDOWN_DRAIN_MS;
    const force = setTimeout(() => process.exit(1), drainMs + 20_000);
    force.unref();
    // Fail readiness first and keep serving while the proxy notices, so no request is dropped.
    app.lifecycle.draining = true;
    await new Promise((resolve) => setTimeout(resolve, drainMs));
    await app.close(); // stops accepting connections, finishes in-flight requests, closes Redis and Prisma
    await closeQueues();
    process.exit(0);
  };
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
}

main().catch((err) => {
  logger.fatal({ err }, 'API failed to start');
  process.exit(1);
});
