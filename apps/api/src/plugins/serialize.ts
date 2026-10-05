import { fileUrl } from '@farmgo/core';
import fp from 'fastify-plugin';

function isDecimal(v: unknown): v is { toNumber(): number } {
  return (
    typeof v === 'object' &&
    v !== null &&
    typeof (v as { toNumber?: unknown }).toNumber === 'function' &&
    typeof (v as { toFixed?: unknown }).toFixed === 'function' &&
    'd' in (v as object)
  );
}

/** Stored object-key fields and the URL field the API adds next to each (see `fileUrl`). */
const KEY_TO_URL: readonly [key: string, url: string][] = [
  ['imageKey', 'imageUrl'],
  ['photoKey', 'photoUrl'],
  ['podPhotoKey', 'podPhotoUrl'],
  ['signatureKey', 'signatureUrl'],
];

/**
 * Add a ready-to-load URL beside every stored file reference so clients never assemble storage
 * URLs: `imageKey` gains `imageUrl`, `photos` gains `photoUrls`, a user's `image` gains `imageUrl`,
 * and so on. Missing files become null (or an empty list), never a placeholder.
 */
function addFileUrls(out: Record<string, unknown>) {
  // Only real stored values (a key string or null): the OpenAPI document also has properties with
  // these names whose values are schema objects.
  const isKey = (v: unknown): v is string | null => v === null || typeof v === 'string';
  for (const [key, url] of KEY_TO_URL) {
    if (key in out && !(url in out) && isKey(out[key])) out[url] = fileUrl(out[key]);
  }
  if (Array.isArray(out.photos) && !('photoUrls' in out) && out.photos.every((k) => typeof k === 'string')) {
    out.photoUrls = (out.photos as unknown[])
      .map((k) => (typeof k === 'string' ? fileUrl(k) : null))
      .filter((u): u is string => u !== null);
  }
  // User avatar: Better Auth's `image` column holds our object key (or an external URL).
  if ('image' in out && !('imageUrl' in out) && (out.image === null || typeof out.image === 'string')) {
    out.imageUrl = fileUrl(out.image as string | null);
  }
}

/**
 * Deep-convert Prisma Decimal to number, BigInt to string and Date to an ISO-8601 string, and add
 * file URLs, so payloads are plain JSON before the Zod response schemas (`@farmgo/contracts`
 * DTOs) run.
 */
export function toPlain(value: unknown): unknown {
  if (value === null || value === undefined) return value;
  if (typeof value === 'bigint') return value.toString();
  if (value instanceof Date) return value.toISOString();
  if (isDecimal(value)) return value.toNumber();
  if (Array.isArray(value)) return value.map(toPlain);
  if (typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) out[k] = toPlain(v);
    addFileUrls(out);
    return out;
  }
  return value;
}

export default fp(
  async (app) => {
    app.addHook('preSerialization', async (_req, _reply, payload) => toPlain(payload));
  },
  { name: 'serialize' },
);
