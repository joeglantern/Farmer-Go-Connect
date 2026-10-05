import { z } from 'zod';

/** POST /v1/uploads/presign: PUT the file to `url` with `headers`, then send `key` in the related request. */
export const PresignDto = z.object({
  key: z.string(),
  url: z.string(),
  method: z.literal('PUT'),
  headers: z.record(z.string(), z.string()),
  expiresIn: z.number().int(),
});
export type PresignDto = z.infer<typeof PresignDto>;

/** POST /v1/uploads/url */
export const FileUrlDto = z.object({ url: z.string(), expiresIn: z.number().int() });
export type FileUrlDto = z.infer<typeof FileUrlDto>;
