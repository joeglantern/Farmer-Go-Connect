import { z } from 'zod';

/** GET /health/live */
export const HealthLiveDto = z.object({ status: z.literal('ok') });
export type HealthLiveDto = z.infer<typeof HealthLiveDto>;

export const HealthCheckDto = z.object({
  ok: z.boolean(),
  ms: z.number().int(),
  error: z.string().optional(),
});

/** GET /health/ready (200 ok, 503 degraded, or 503 draining while the process shuts down) */
export const HealthReadyDto = z.object({
  status: z.enum(['ok', 'degraded', 'draining']),
  checks: z.object({ database: HealthCheckDto, redis: HealthCheckDto, storage: HealthCheckDto }),
  websocketClients: z.number().int(),
});
export type HealthReadyDto = z.infer<typeof HealthReadyDto>;
