import type { DB } from '@farmgo/db';

/**
 * Atomically take `qty` from a listing's remaining quantity. Returns false if the listing is
 * not open or does not have enough left (so concurrent orders can never oversell).
 */
export async function reserveListing(db: DB, listingId: string, qty: number): Promise<boolean> {
  const n = await db.$executeRawUnsafe(
    `UPDATE "SupplyListing"
        SET "quantityLeft" = "quantityLeft" - $2::numeric,
            status = (CASE WHEN "quantityLeft" - $2::numeric <= 0 THEN 'FULLY_MATCHED' ELSE 'PARTIALLY_MATCHED' END)::"ListingStatus",
            "updatedAt" = now()
      WHERE id = $1
        AND status IN ('OPEN', 'PARTIALLY_MATCHED')
        AND "quantityLeft" >= $2::numeric`,
    listingId,
    qty,
  );
  return n === 1;
}

/** Return quantity to a listing (order cancelled). Expired/cancelled listings stay closed. */
export async function releaseListing(db: DB, listingId: string, qty: number): Promise<void> {
  await db.$executeRawUnsafe(
    `UPDATE "SupplyListing"
        SET "quantityLeft" = LEAST(quantity, "quantityLeft" + $2::numeric),
            status = (CASE
                        WHEN status IN ('EXPIRED', 'CANCELLED', 'DRAFT') THEN status::text
                        WHEN LEAST(quantity, "quantityLeft" + $2::numeric) >= quantity THEN 'OPEN'
                        ELSE 'PARTIALLY_MATCHED' END)::"ListingStatus",
            "updatedAt" = now()
      WHERE id = $1`,
    listingId,
    qty,
  );
}

/** Count `qty` towards a demand request and update its status. */
export async function fillDemand(db: DB, demandId: string, qty: number): Promise<void> {
  await db.$executeRawUnsafe(
    `UPDATE "DemandRequest"
        SET "quantityFilled" = "quantityFilled" + $2::numeric,
            status = (CASE
                        WHEN status IN ('CANCELLED', 'EXPIRED') THEN status::text
                        WHEN "quantityFilled" + $2::numeric >= quantity THEN 'FILLED'
                        ELSE 'PARTIALLY_FILLED' END)::"DemandStatus",
            "updatedAt" = now()
      WHERE id = $1`,
    demandId,
    qty,
  );
}

/** Undo `fillDemand` (order cancelled or rejected at QA) so the demand can be matched again. */
export async function unfillDemand(db: DB, demandId: string, qty: number): Promise<void> {
  await db.$executeRawUnsafe(
    `UPDATE "DemandRequest"
        SET "quantityFilled" = GREATEST(0, "quantityFilled" - $2::numeric),
            status = (CASE
                        WHEN status IN ('CANCELLED', 'EXPIRED') THEN status::text
                        WHEN GREATEST(0, "quantityFilled" - $2::numeric) <= 0 THEN 'OPEN'
                        ELSE 'PARTIALLY_FILLED' END)::"DemandStatus",
            "updatedAt" = now()
      WHERE id = $1`,
    demandId,
    qty,
  );
}
