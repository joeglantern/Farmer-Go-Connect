import { z } from 'zod';
import { page } from '../common.js';
import { NotificationDto } from './models.js';

/** GET /v1/notifications */
export const NotificationPageDto = page(NotificationDto).extend({
  /** Unread count across the whole inbox, not just this page. */
  unread: z.number().int(),
});
export type NotificationPageDto = z.infer<typeof NotificationPageDto>;

/** POST /v1/notifications/read */
export const MarkReadDto = z.object({ updated: z.number().int() });
export type MarkReadDto = z.infer<typeof MarkReadDto>;
