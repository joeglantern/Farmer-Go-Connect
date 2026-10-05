/**
 * Cursor pagination over Prisma `findMany`. Fetch `limit + 1` rows ordered by a unique key and
 * pass them here; the extra row signals another page.
 */
export function paginate<T extends { id: string }>(rows: T[], limit: number) {
  const hasMore = rows.length > limit;
  const items = hasMore ? rows.slice(0, limit) : rows;
  return { items, nextCursor: hasMore ? items[items.length - 1]!.id : null };
}

export function cursorArgs(cursor: string | undefined, limit: number) {
  return {
    take: limit + 1,
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
  };
}

/**
 * Upper bounds for lists that are not paginated. They are far above what a screen shows, and
 * only stop a broad query (all produce, all counties, two years) from loading without limit.
 */
export const LIST_CAP = {
  /** Weekly price rows: 34 produce x 47 counties is about 1,600 a week. */
  prices: 5_000,
  forecasts: 5_000,
  farms: 200,
  addresses: 100,
  produce: 500,
  ownListings: 300,
} as const;
