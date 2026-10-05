import { env, MOCK_PAYMENTS_WARNING, mockPaymentsInProduction } from '@farmgo/config';
import pino from 'pino';

/** Query parameters that can carry a secret (webhook tokens, the WebSocket token, OTPs). */
const SECRET_PARAMS = /^(token|access_token|auth|code|otp|secret|signature|key|password|apikey|api_key)$/i;

/** The URL with every secret-looking query value replaced, safe to log. */
export function redactUrl(url: string | undefined): string | undefined {
  if (!url) return url;
  const q = url.indexOf('?');
  if (q === -1) return url;
  const query = url
    .slice(q + 1)
    .split('&')
    .map((pair) => {
      const eq = pair.indexOf('=');
      const name = eq === -1 ? pair : pair.slice(0, eq);
      let decoded = name;
      try {
        decoded = decodeURIComponent(name);
      } catch {}
      return eq !== -1 && SECRET_PARAMS.test(decoded) ? `${name}=[redacted]` : pair;
    })
    .join('&');
  return `${url.slice(0, q)}?${query}`;
}

interface LoggableRequest {
  id?: string;
  method?: string;
  url?: string;
  host?: string;
  hostname?: string;
  ip?: string;
  socket?: { remotePort?: number };
}

export const loggerOptions: pino.LoggerOptions = {
  level: env.LOG_LEVEL,
  redact: {
    paths: [
      'req.headers.authorization',
      'req.headers.cookie',
      'req.headers["sec-websocket-protocol"]',
      'headers.authorization',
      'headers.cookie',
      '*.password',
      '*.code',
      '*.otp',
      '*.token',
      '*.SecurityCredential',
    ],
    censor: '[redacted]',
  },
  serializers: {
    // Fastify logs every request URL; webhook and WebSocket tokens travel in the query string.
    req: (req: LoggableRequest) => ({
      method: req.method,
      url: redactUrl(req.url),
      host: req.host ?? req.hostname,
      remoteAddress: req.ip,
      remotePort: req.socket?.remotePort,
    }),
  },
  base: { service: process.env.SERVICE_NAME ?? 'farmgo' },
};

export const logger = pino(loggerOptions);
export type Logger = pino.Logger;

/**
 * A tester stack runs mock payment providers under NODE_ENV=production. Say so at startup and
 * every 15 minutes, so it is impossible to miss in the logs.
 */
export function announceTesterStack(log: pino.Logger = logger) {
  if (!mockPaymentsInProduction) return;
  log.warn({ testerStack: true }, MOCK_PAYMENTS_WARNING);
  setInterval(() => log.warn({ testerStack: true }, MOCK_PAYMENTS_WARNING), 15 * 60_000).unref();
}
