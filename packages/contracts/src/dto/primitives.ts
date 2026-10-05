import { z } from 'zod';

/**
 * Building blocks for response DTOs. The API serializer converts Prisma Decimal to number,
 * BigInt to string and Date to ISO-8601 strings before these schemas run, so a DTO only ever
 * sees plain JSON values.
 */

/** ISO-8601 date-time string, e.g. "2026-09-26T08:15:00.000Z". */
export const IsoDateTime = z.iso.datetime({ offset: true });
export type IsoDateTime = z.infer<typeof IsoDateTime>;

export const NullableString = z.string().nullable();
export const NullableNumber = z.number().nullable();
export const NullableDateTime = IsoDateTime.nullable();

/**
 * A ready-to-load file URL added by the API next to a stored object key. Public images are a
 * stable storage URL; private files point at `GET /v1/files/<key>` (send the Authorization
 * header). Null when there is no file: clients draw their own fallback.
 */
export const FileUrl = z.string().nullable();
/** URLs for a list of stored photos, in the same order. */
export const FileUrls = z.array(z.string());

/** Prisma Decimal(12,2) quantities arrive as numbers. */
export const DecimalNumber = z.number();

/** Arbitrary JSON column (checklists, score breakdowns, notification payloads). */
export const JsonValue = z.unknown();

/** Minimal user reference embedded in other DTOs. */
export const UserRef = z.object({ id: z.string(), name: z.string() });
export type UserRef = z.infer<typeof UserRef>;

/** Minimal organization reference embedded in other DTOs. */
export const OrgRef = z.object({ id: z.string(), name: z.string() });
export type OrgRef = z.infer<typeof OrgRef>;

/** Prisma `_count` helper output. */
export const count = <K extends string>(...keys: K[]) =>
  z.object(Object.fromEntries(keys.map((k) => [k, z.number().int()])) as Record<K, z.ZodNumber>);
