import { z } from 'zod';
import { Id } from '../common.js';
import { FileUrl, IsoDateTime, NullableString } from './primitives.js';

export const FavoriteKind = z.enum(['LISTING', 'FARMER', 'PRODUCE', 'CATEGORY']);
export type FavoriteKind = z.infer<typeof FavoriteKind>;

/**
 * POST /v1/favorites. `targetId` is a listing id, a farmer profile id, a produce id, or an app
 * category slug (GET /v1/categories) depending on `kind`.
 */
export const FavoriteInput = z.object({ kind: FavoriteKind, targetId: Id });
export const FavoriteQuery = z.object({ kind: FavoriteKind.optional() });

/** A favorite with what the app needs to draw it. */
export const FavoriteDto = z.object({
  id: z.string(),
  kind: FavoriteKind,
  targetId: z.string(),
  title: z.string(),
  titleSw: NullableString,
  subtitle: NullableString,
  imageUrl: FileUrl,
  /** False when the listing closed, the farmer left, or the produce was withdrawn. */
  available: z.boolean(),
  createdAt: IsoDateTime,
});
export type FavoriteDto = z.infer<typeof FavoriteDto>;
export const FavoriteListDto = z.array(FavoriteDto);
