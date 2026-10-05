/** All amounts are integer KES cents. */

export function lineTotal(quantity: number, pricePerUnitCents: number): number {
  return Math.round(quantity * pricePerUnitCents);
}

export function commissionFor(subtotalCents: number, commissionBps: number): number {
  return Math.round((subtotalCents * commissionBps) / 10_000);
}

export interface OrderTotals {
  subtotal: number;
  deliveryFee: number;
  commission: number;
  /** What the buyer pays: produce + delivery. */
  total: number;
  /** What the farmer receives: produce - commission. */
  farmerNet: number;
}

export function orderTotals(subtotal: number, deliveryFee: number, commissionBps: number): OrderTotals {
  const commission = commissionFor(subtotal, commissionBps);
  return {
    subtotal,
    deliveryFee,
    commission,
    total: subtotal + deliveryFee,
    farmerNet: subtotal - commission,
  };
}

/** Farmer payout after QA, based on accepted quantity. */
export function payoutFor(acceptedSubtotal: number, commissionBps: number) {
  const commission = commissionFor(acceptedSubtotal, commissionBps);
  return { gross: acceptedSubtotal, commission, net: Math.max(0, acceptedSubtotal - commission) };
}

export const formatKes = (cents: number) =>
  `KES ${(cents / 100).toLocaleString('en-KE', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
