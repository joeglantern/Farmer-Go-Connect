import { isProd } from '@farmgo/config';
import { AppError } from '@farmgo/core';
import * as Sentry from '@sentry/node';
import type { FastifyError } from 'fastify';
import fp from 'fastify-plugin';
import { hasZodFastifySchemaValidationErrors, isResponseSerializationError } from 'fastify-type-provider-zod';

type PrismaLikeError = { code?: string; meta?: Record<string, unknown>; name?: string };

/** One error shape for every failure: { error: { code, message, requestId, details? } }. */
export default fp(
  async (app) => {
    app.setErrorHandler((err: FastifyError & PrismaLikeError, req, reply) => {
      const requestId = req.id;
      const send = (status: number, code: string, message: string, details?: unknown) =>
        reply
          .status(status)
          .send({ error: { code, message, requestId, ...(details === undefined ? {} : { details }) } });

      if (err instanceof AppError) return send(err.httpStatus, err.code, err.message, err.details);

      if (hasZodFastifySchemaValidationErrors(err)) {
        // Messages are English; clients translate from `code` and each issue's `code` (QA-032).
        return send(400, 'VALIDATION_ERROR', 'Some fields are missing or invalid', {
          issues: err.validation.map((v) => {
            const issue = (v.params as { issue?: { path?: unknown[]; code?: string } })?.issue;
            return {
              path: v.instancePath || issue?.path?.join('.'),
              code: issue?.code ?? v.keyword,
              message: v.message,
            };
          }),
        });
      }
      if (isResponseSerializationError(err)) {
        req.log.error({ err, issues: err.cause.issues }, 'response did not match schema');
        return send(500, 'INTERNAL', 'Something went wrong on our side');
      }

      // Prisma known request errors
      if (err.code === 'P2002') {
        return send(409, 'ALREADY_EXISTS', 'A record with these details already exists', {
          target: err.meta?.target,
        });
      }
      if (err.code === 'P2025') return send(404, 'NOT_FOUND', 'Record not found');
      if (err.code === 'P2003') return send(400, 'INVALID_REFERENCE', 'A referenced record does not exist');

      if (err.statusCode === 429)
        return send(429, 'RATE_LIMITED', 'Too many requests. Slow down and try again shortly.');
      if (err.statusCode && err.statusCode < 500) {
        return send(err.statusCode, err.code ?? 'BAD_REQUEST', err.message);
      }

      req.log.error({ err }, 'unhandled error');
      Sentry.captureException(err);
      return send(500, 'INTERNAL', isProd ? 'Something went wrong on our side' : err.message);
    });

    app.setNotFoundHandler((req, reply) =>
      reply.status(404).send({
        error: {
          code: 'ROUTE_NOT_FOUND',
          message: `${req.method} ${req.url} does not exist`,
          requestId: req.id,
        },
      }),
    );
  },
  { name: 'errors' },
);
