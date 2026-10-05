import type { CheckoutAddress, CheckoutItem, CheckoutPaymentMethod } from '@farmgo/contracts';
import { type DB, num, type Order, type PrismaClient } from '@farmgo/db';
import { AppError, Errors } from '../errors.js';
import { cardEnabled } from '../providers/card.js';
import { fileUrl } from '../providers/storage.js';
import { lineTotal } from './money.js';
import { createOrder } from './orders.js';
import { orderBalance } from './refunds.js';
import { getSetting } from './settings.js';

// ─── Delivery slots (Africa/Nairobi, UTC+3 all year) ──────────

const NAIROBI_OFFSET_MS = 3 * 3600_000;
const DAY_MS = 86_400_000;

/** Calendar date in Nairobi, "YYYY-MM-DD". */
export const nairobiDate = (d: Date) => new Date(d.getTime() + NAIROBI_OFFSET_MS).toISOString().slice(0, 10);

/** 400 when `date` falls on a Nairobi calendar day before today (QA-025). */
export function assertNotPast(date: Date, field: string, now = new Date()) {
  if (nairobiDate(date) < nairobiDate(now)) {
    throw Errors.badRequest('DATE_IN_PAST', `${field} cannot be in the past`, { field });
  }
}

/** Start of a Nairobi calendar day, as a UTC instant. */
export const nairobiDayStart = (date: string) =>
  new Date(Date.parse(`${date}T00:00:00Z`) - NAIROBI_OFFSET_MS);

/**
 * The first date that can still be booked: tomorrow when ordering before the cut-off hour
 * (Nairobi), otherwise the day after.
 */
export function earliestDeliveryDate(now: Date, cutoffHour: number): string {
  const local = new Date(now.getTime() + NAIROBI_OFFSET_MS);
  const days = local.getUTCHours() < cutoffHour ? 1 : 2;
  return nairobiDate(new Date(now.getTime() + days * DAY_MS));
}

const MAX_DAYS_AHEAD = 30;

export interface DeliverySlotDay {
  date: string;
  available: boolean;
  windows: { window: string; available: boolean; reason: string | null }[];
}

/**
 * Bookable delivery dates and windows from `from` (Nairobi date) for `days` days. A day before
 * the earliest bookable date says why (the next-day cut-off), and days past the booking horizon
 * are closed.
 */
export async function deliverySlots(db: DB, a: { from?: Date; days: number; now?: Date }) {
  const now = a.now ?? new Date();
  const [windows, cutoff] = await Promise.all([
    getSetting(db, 'deliveryWindows'),
    getSetting(db, 'nextDayCutoffHour'),
  ]);
  const earliest = earliestDeliveryDate(now, cutoff);
  const latest = nairobiDate(new Date(now.getTime() + MAX_DAYS_AHEAD * DAY_MS));
  const first = nairobiDate(a.from ?? now);
  const out: DeliverySlotDay[] = [];
  for (let i = 0; i < a.days; i++) {
    const date = nairobiDate(new Date(nairobiDayStart(first).getTime() + i * DAY_MS + 12 * 3600_000));
    const reason =
      date < earliest
        ? `Order before ${String(cutoff).padStart(2, '0')}:00 for next-day delivery; the earliest date now is ${earliest}`
        : date > latest
          ? `Deliveries can be booked up to ${MAX_DAYS_AHEAD} days ahead`
          : null;
    out.push({
      date,
      available: reason === null,
      windows: windows.map((w) => ({ window: w, available: reason === null, reason })),
    });
  }
  return { cutoffHour: cutoff, earliestDate: earliest, windows, days: out };
}

/** Throws 400 DELIVERY_SLOT_UNAVAILABLE unless the date and window can be booked. */
export async function assertDeliverySlot(db: DB, deliveryDate: Date, window: string, now = new Date()) {
  const [windows, cutoff] = await Promise.all([
    getSetting(db, 'deliveryWindows'),
    getSetting(db, 'nextDayCutoffHour'),
  ]);
  if (!windows.includes(window)) {
    throw Errors.badRequest(
      'DELIVERY_SLOT_UNAVAILABLE',
      `Choose one of the delivery windows: ${windows.join(', ')}`,
      {
        windows,
      },
    );
  }
  const date = nairobiDate(deliveryDate);
  const earliest = earliestDeliveryDate(now, cutoff);
  const latest = nairobiDate(new Date(now.getTime() + MAX_DAYS_AHEAD * DAY_MS));
  if (date < earliest || date > latest) {
    throw Errors.badRequest(
      'DELIVERY_SLOT_UNAVAILABLE',
      `Deliveries can be booked from ${earliest} to ${latest}`,
      { earliest, latest },
    );
  }
}

// ─── Pricing a cart ───────────────────────────────────────────

export type LineStatus = 'ok' | 'reduced' | 'unavailable' | 'price_changed';

export interface PricedLine {
  listingId: string;
  produceId: string;
  name: string;
  nameSw: string;
  unit: string;
  quantity: number;
  requestedQuantity: number;
  pricePerUnit: number;
  lineTotal: number;
  available: number;
  status: LineStatus;
  photoUrl: string | null;
}

export interface PricedGroup {
  farmId: string;
  farmName: string;
  farmerFirstName: string;
  county: string;
  items: PricedLine[];
  subtotal: number;
}

export interface Problem {
  listingId: string;
  code: string;
  message: string;
}

export interface PricedCart {
  groups: PricedGroup[];
  subtotal: number;
  problems: Problem[];
}

/** Merge repeated listings (a device cart may add the same item twice). */
function mergeItems(items: CheckoutItem[]): CheckoutItem[] {
  const byId = new Map<string, CheckoutItem>();
  for (const i of items) {
    const prev = byId.get(i.listingId);
    byId.set(
      i.listingId,
      prev ? { ...prev, quantity: Math.round((prev.quantity + i.quantity) * 100) / 100 } : i,
    );
  }
  return [...byId.values()];
}

/**
 * Price lines against the listings as they are now, grouped by farm. With a delivery date,
 * lines whose listing is not available on that day are `unavailable`. Never reserves stock.
 */
export async function priceLines(
  db: DB,
  a: { items: CheckoutItem[]; userId: string; deliveryDate?: Date },
): Promise<PricedCart> {
  const items = mergeItems(a.items);
  const listings = await db.supplyListing.findMany({
    where: { id: { in: items.map((i) => i.listingId) } },
    include: {
      produce: true,
      farm: { include: { farmer: { include: { user: { select: { id: true, name: true } } } } } },
    },
  });
  const byId = new Map(listings.map((l) => [l.id, l]));
  const dayStart = a.deliveryDate ? nairobiDayStart(nairobiDate(a.deliveryDate)) : null;
  const dayEnd = dayStart ? new Date(dayStart.getTime() + DAY_MS) : null;

  const groups = new Map<string, PricedGroup>();
  const problems: Problem[] = [];
  for (const item of items) {
    const l = byId.get(item.listingId);
    if (!l) {
      problems.push({
        listingId: item.listingId,
        code: 'LISTING_UNAVAILABLE',
        message: 'This produce is no longer listed',
      });
      continue;
    }
    const available = Math.max(0, num(l.quantityLeft));
    let status: LineStatus = 'ok';
    let quantity = item.quantity;
    const problem = (code: string, message: string) => problems.push({ listingId: l.id, code, message });
    if (l.farm.farmer.userId === a.userId) {
      status = 'unavailable';
      problem('OWN_LISTING', 'You cannot order your own produce');
    } else if (
      !['OPEN', 'PARTIALLY_MATCHED'].includes(l.status) ||
      available <= 0 ||
      l.availableTo < new Date()
    ) {
      status = 'unavailable';
      problem('LISTING_UNAVAILABLE', `${l.produce.name} from ${l.farm.name} is sold out or no longer listed`);
    } else if (dayStart && dayEnd && (l.availableTo < dayStart || l.availableFrom >= dayEnd)) {
      status = 'unavailable';
      problem('NOT_ON_DATE', `${l.produce.name} from ${l.farm.name} is not available on that delivery date`);
    } else if (available < item.quantity) {
      status = 'reduced';
      quantity = available;
      problem(
        'QUANTITY_REDUCED',
        `Only ${available} ${l.produce.unit.toLowerCase()} of ${l.produce.name} left`,
      );
    } else if (item.pricePerUnit !== undefined && item.pricePerUnit !== l.pricePerUnit) {
      status = 'price_changed';
      problem('PRICE_CHANGED', `The price of ${l.produce.name} is now KES ${l.pricePerUnit / 100}`);
    }
    if (status === 'unavailable') quantity = 0;

    let group = groups.get(l.farmId);
    if (!group) {
      group = {
        farmId: l.farmId,
        farmName: l.farm.name,
        farmerFirstName: l.farm.farmer.user.name.split(' ')[0] ?? '',
        county: l.farm.county,
        items: [],
        subtotal: 0,
      };
      groups.set(l.farmId, group);
    }
    const total = lineTotal(quantity, l.pricePerUnit);
    group.items.push({
      listingId: l.id,
      produceId: l.produceId,
      name: l.produce.name,
      nameSw: l.produce.nameSw,
      unit: l.produce.unit,
      quantity,
      requestedQuantity: item.quantity,
      pricePerUnit: l.pricePerUnit,
      lineTotal: total,
      available,
      status,
      photoUrl: fileUrl(l.photos[0] ?? l.produce.imageKey),
    });
    group.subtotal += total;
  }
  const list = [...groups.values()];
  return { groups: list, subtotal: list.reduce((s, g) => s + g.subtotal, 0), problems };
}

/**
 * Split one delivery fee across orders in proportion to their subtotals, rounding by largest
 * remainder so the shares add up to the fee exactly.
 */
export function splitDeliveryFee(fee: number, subtotals: number[]): number[] {
  const total = subtotals.reduce((s, v) => s + v, 0);
  if (subtotals.length === 0) return [];
  if (total <= 0) return subtotals.map((_, i) => (i === 0 ? fee : 0));
  const exact = subtotals.map((v) => (fee * v) / total);
  const shares = exact.map(Math.floor);
  let left = fee - shares.reduce((s, v) => s + v, 0);
  const order = exact
    .map((v, i) => ({ i, frac: v - Math.floor(v) }))
    .sort((a, b) => b.frac - a.frac || a.i - b.i);
  for (const { i } of order) {
    if (left <= 0) break;
    shares[i]! += 1;
    left -= 1;
  }
  return shares;
}

// ─── Buyer context ────────────────────────────────────────────

export interface BuyerContext {
  buyerOrgId: string;
  userId: string;
  paymentTerms: string;
  profileAddress: string | null;
  profileLat: number | null;
  profileLng: number | null;
}

export function paymentMethodsFor(paymentTerms: string): CheckoutPaymentMethod[] {
  return [
    'MPESA',
    ...(cardEnabled() ? (['CARD'] as const) : []),
    ...(paymentTerms === 'PREPAID' ? [] : (['INVOICE'] as const)),
  ];
}

/** Items from the request, or the buyer organization's server cart when omitted. */
export async function resolveItems(
  db: DB,
  buyerOrgId: string,
  items?: CheckoutItem[],
): Promise<CheckoutItem[]> {
  if (items?.length) return items;
  const rows = await db.cartItem.findMany({ where: { buyerOrgId }, orderBy: { createdAt: 'asc' } });
  return rows.map((r) => ({ listingId: r.listingId, quantity: num(r.quantity) }));
}

/** Addresses a buyer may use: their organization's, and their own. */
export const addressScope = (ctx: { buyerOrgId: string; userId: string }) => ({
  OR: [{ orgId: ctx.buyerOrgId }, { orgId: null, userId: ctx.userId }],
});

const addressLine = (a: { line1: string; landmark?: string | null; town?: string | null; county: string }) =>
  [a.line1, a.landmark, a.town, a.county].filter(Boolean).join(', ');

/**
 * Where to deliver: a saved address (`addressId`), an inline address, else the buyer's default
 * saved address, else the organization's own location.
 */
export async function resolveAddress(
  db: DB,
  ctx: BuyerContext,
  a: { addressId?: string; address?: CheckoutAddress },
): Promise<{ deliveryAddress: string | null; deliveryLat: number | null; deliveryLng: number | null }> {
  if (a.addressId) {
    const saved = await db.address.findFirst({ where: { id: a.addressId, ...addressScope(ctx) } });
    if (!saved) throw Errors.badRequest('ADDRESS_NOT_FOUND', 'Choose one of your saved addresses');
    return { deliveryAddress: addressLine(saved), deliveryLat: saved.lat, deliveryLng: saved.lng };
  }
  if (a.address) {
    return {
      deliveryAddress: addressLine(a.address),
      deliveryLat: a.address.lat ?? null,
      deliveryLng: a.address.lng ?? null,
    };
  }
  const fallback = await db.address.findFirst({ where: { ...addressScope(ctx), isDefault: true } });
  if (fallback)
    return { deliveryAddress: addressLine(fallback), deliveryLat: fallback.lat, deliveryLng: fallback.lng };
  return { deliveryAddress: ctx.profileAddress, deliveryLat: ctx.profileLat, deliveryLng: ctx.profileLng };
}

export async function quoteCheckout(
  db: DB,
  ctx: BuyerContext,
  a: {
    items?: CheckoutItem[];
    addressId?: string;
    address?: CheckoutAddress;
    deliveryDate: Date;
    deliveryWindow: string;
  },
) {
  await assertDeliverySlot(db, a.deliveryDate, a.deliveryWindow);
  await resolveAddress(db, ctx, a);
  const items = await resolveItems(db, ctx.buyerOrgId, a.items);
  if (items.length === 0) throw Errors.badRequest('CART_EMPTY', 'Your cart is empty');
  const priced = await priceLines(db, { items, userId: ctx.userId, deliveryDate: a.deliveryDate });
  const fee = priced.subtotal > 0 ? await getSetting(db, 'deliveryFeeCents') : 0;
  return {
    ...priced,
    deliveryFee: fee,
    total: priced.subtotal + fee,
    paymentMethods: paymentMethodsFor(ctx.paymentTerms),
    deliveryDate: a.deliveryDate,
    deliveryWindow: a.deliveryWindow,
  };
}

// ─── Placing a checkout ───────────────────────────────────────

export interface PlaceCheckoutArgs {
  items?: CheckoutItem[];
  addressId?: string;
  address?: CheckoutAddress;
  deliveryDate: Date;
  deliveryWindow: string;
  paymentMethod: CheckoutPaymentMethod;
  notes?: string;
}

const stockChanged = (problems: Problem[]) =>
  new AppError(
    'CHECKOUT_STOCK_CHANGED',
    'Some items changed since you last looked. Review your cart and try again.',
    409,
    { problems },
  );

/**
 * Place a cart checkout in one transaction: re-price every line, reserve all stock (all or
 * nothing), create one order per farmer with the delivery fee split between them, record the
 * checkout, and clear the checked-out lines from the server cart. Payment starts afterwards.
 */
export async function placeCheckout(prisma: PrismaClient, ctx: BuyerContext, a: PlaceCheckoutArgs) {
  if (a.paymentMethod === 'CARD' && !cardEnabled()) {
    throw Errors.badRequest(
      'PAYMENT_METHOD_UNAVAILABLE',
      'Card payments are not available. Pay with M-Pesa.',
    );
  }
  if (a.paymentMethod === 'INVOICE' && ctx.paymentTerms === 'PREPAID') {
    throw Errors.badRequest(
      'PAYMENT_METHOD_UNAVAILABLE',
      'Invoices are for approved credit-terms buyers. Pay with M-Pesa.',
    );
  }
  await assertDeliverySlot(prisma, a.deliveryDate, a.deliveryWindow);
  const address = await resolveAddress(prisma, ctx, a);
  const usedServerCart = !a.items?.length;

  try {
    return await prisma.$transaction(
      async (tx) => {
        const items = await resolveItems(tx, ctx.buyerOrgId, a.items);
        if (items.length === 0) throw Errors.badRequest('CART_EMPTY', 'Your cart is empty');
        const priced = await priceLines(tx, { items, userId: ctx.userId, deliveryDate: a.deliveryDate });
        if (priced.problems.length) throw stockChanged(priced.problems);

        const fee = await getSetting(tx, 'deliveryFeeCents');
        const shares = splitDeliveryFee(
          fee,
          priced.groups.map((g) => g.subtotal),
        );
        const checkout = await tx.checkout.create({
          data: {
            buyerOrgId: ctx.buyerOrgId,
            createdById: ctx.userId,
            subtotal: priced.subtotal,
            deliveryFee: fee,
            total: priced.subtotal + fee,
            paymentMethod: a.paymentMethod,
            deliveryDate: a.deliveryDate,
            deliveryWindow: a.deliveryWindow,
            ...address,
            notes: a.notes,
          },
        });
        const orders: Order[] = [];
        for (const [i, g] of priced.groups.entries()) {
          orders.push(
            await createOrder(tx, {
              buyerOrgId: ctx.buyerOrgId,
              createdById: ctx.userId,
              items: g.items.map((l) => ({
                listingId: l.listingId,
                quantity: l.quantity,
                pricePerUnit: l.pricePerUnit,
              })),
              deliveryFee: shares[i]!,
              deliveryDate: a.deliveryDate,
              deliveryWindow: a.deliveryWindow,
              deliveryAddress: address.deliveryAddress ?? undefined,
              deliveryLat: address.deliveryLat ?? undefined,
              deliveryLng: address.deliveryLng ?? undefined,
              notes: a.notes,
              checkoutId: checkout.id,
            }),
          );
        }
        await tx.cartItem.deleteMany({
          where: {
            buyerOrgId: ctx.buyerOrgId,
            ...(usedServerCart ? {} : { listingId: { in: items.map((i) => i.listingId) } }),
          },
        });
        return { checkout, orders };
      },
      { timeout: 20_000 },
    );
  } catch (err) {
    // Another buyer took the stock between our check and the reservation: nothing was created.
    if (err instanceof AppError && err.code === 'LISTING_UNAVAILABLE') {
      const listingId = (err.details as { listingId?: string } | undefined)?.listingId ?? '';
      throw stockChanged([{ listingId, code: 'LISTING_UNAVAILABLE', message: err.message }]);
    }
    throw err;
  }
}

// ─── Reading a checkout ───────────────────────────────────────

/** The checkout as the app shows it: orders with their payment and refund state, and the latest payment. */
export async function checkoutView(db: DB, checkoutId: string) {
  const checkout = await db.checkout.findUniqueOrThrow({
    where: { id: checkoutId },
    include: {
      orders: {
        orderBy: { createdAt: 'asc' },
        include: {
          items: { take: 1, include: { listing: { select: { farm: { select: { name: true } } } } } },
        },
      },
    },
  });
  const orders = [];
  let balanceDue = 0;
  for (const o of checkout.orders) {
    const bal = await orderBalance(db, o.id);
    const owesNothing = ['CANCELLED', 'QA_REJECTED'].includes(o.status) || o.paymentTerms !== 'PREPAID';
    if (!owesNothing) balanceDue += Math.max(0, o.total - bal.net);
    orders.push({
      id: o.id,
      code: o.code,
      farmName: o.items[0]?.listing.farm.name ?? '',
      total: o.total,
      status: o.status,
      paymentStatus: o.paymentStatus,
      netPaid: bal.net,
      refundedAmount: bal.refunded,
    });
  }
  const latest = await db.payment.findFirst({
    where: { checkoutId, allocatedFromId: null, direction: 'IN' },
    orderBy: { createdAt: 'desc' },
  });
  const method = checkout.paymentMethod as CheckoutPaymentMethod;
  const status: 'PENDING' | 'SUCCESS' | 'FAILED' | 'NOT_REQUIRED' =
    method === 'INVOICE'
      ? 'NOT_REQUIRED'
      : !latest
        ? balanceDue > 0
          ? 'FAILED'
          : 'SUCCESS'
        : latest.status === 'PENDING'
          ? 'PENDING'
          : latest.status === 'SUCCESS'
            ? balanceDue > 0
              ? 'FAILED'
              : 'SUCCESS'
            : 'FAILED';
  return {
    checkoutId: checkout.id,
    orders,
    total: orders.reduce((s, o) => s + o.total, 0),
    balanceDue,
    payment: {
      method,
      paymentId: latest?.id ?? null,
      status,
      checkoutRequestId: latest?.checkoutRequestId ?? null,
      // Card: the hosted page to (re)open while the payment is still pending.
      redirectUrl:
        latest?.method === 'CARD' && status === 'PENDING'
          ? ((latest.raw as { redirectUrl?: string } | null)?.redirectUrl ?? null)
          : null,
      ...(status === 'FAILED' && latest?.resultDesc ? { message: latest.resultDesc } : {}),
    },
    deliveryDate: checkout.deliveryDate,
    deliveryWindow: checkout.deliveryWindow,
    createdAt: checkout.createdAt,
  };
}
