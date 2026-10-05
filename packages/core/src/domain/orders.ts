import { MAX_CENTS } from '@farmgo/contracts';
import { type DB, num, type Order } from '@farmgo/db';
import { AppError, Errors } from '../errors.js';
import { emit } from '../outbox.js';
import { nextOrderCode } from './codes.js';
import { fillDemand, reserveListing } from './inventory.js';
import { lineTotal, orderTotals } from './money.js';
import { getSetting } from './settings.js';

export interface OrderLineArgs {
  listingId: string;
  quantity: number;
  /** Agreed price; defaults to the listing price. */
  pricePerUnit?: number;
  /** Set when the line comes from an accepted match. */
  matchId?: string;
  demandId?: string;
}

export interface CreateOrderArgs {
  buyerOrgId: string;
  createdById: string;
  /** Single-listing order (direct order, accepted match). */
  listingId?: string;
  quantity?: number;
  pricePerUnit?: number;
  matchId?: string;
  demandId?: string;
  /** Several lines from the same farmer (cart checkout). Used instead of listingId/quantity. */
  items?: OrderLineArgs[];
  deliveryDate?: Date;
  deliveryWindow?: string;
  deliveryAddress?: string;
  deliveryLat?: number;
  deliveryLng?: number;
  notes?: string;
  /** This order's share of a checkout's delivery fee; defaults to the flat fee setting. */
  deliveryFee?: number;
  checkoutId?: string;
  /** Matched orders are already agreed by the farmer, so they start CONFIRMED. */
  initialStatus?: 'PENDING' | 'CONFIRMED';
}

/**
 * Create an order with one farmer. Reserves every line's quantity atomically (all or nothing,
 * since this runs inside the caller's transaction), prices the order (produce + delivery fee,
 * commission taken from the farmer), and records the creation event.
 */
export async function createOrder(tx: DB, a: CreateOrderArgs): Promise<Order> {
  const lines: OrderLineArgs[] =
    a.items ??
    (a.listingId && a.quantity !== undefined
      ? [
          {
            listingId: a.listingId,
            quantity: a.quantity,
            pricePerUnit: a.pricePerUnit,
            matchId: a.matchId,
            demandId: a.demandId,
          },
        ]
      : []);
  if (lines.length === 0) throw Errors.badRequest('ORDER_EMPTY', 'Add at least one item');

  const buyerOrg = await tx.organization.findUnique({
    where: { id: a.buyerOrgId },
    include: { profile: true },
  });
  if (buyerOrg?.profile?.type !== 'BUYER') {
    throw Errors.forbidden('Only buyer organizations can place orders');
  }

  const listings = [];
  for (const line of lines) {
    const listing = await tx.supplyListing.findUnique({
      where: { id: line.listingId },
      include: { farm: { include: { farmer: true } } },
    });
    if (!listing) throw Errors.notFound('Listing');
    if (listing.farm.farmer.userId === a.createdById) {
      throw Errors.badRequest('SELF_ORDER', 'You cannot order your own produce');
    }
    listings.push(listing);
  }
  const farmerId = listings[0]!.farm.farmer.userId;
  if (listings.some((l) => l.farm.farmer.userId !== farmerId)) {
    throw Errors.badRequest('MIXED_FARMERS', 'An order holds produce from one farmer only');
  }

  let subtotal = 0;
  const itemRows = [];
  for (const [i, line] of lines.entries()) {
    const listing = listings[i]!;
    const reserved = await reserveListing(tx, listing.id, line.quantity);
    if (!reserved) {
      throw new AppError(
        'LISTING_UNAVAILABLE',
        `Only ${num(listing.quantityLeft)} left on this listing, or it is no longer open`,
        409,
        { listingId: listing.id },
      );
    }
    if (line.demandId) await fillDemand(tx, line.demandId, line.quantity);
    const price = line.pricePerUnit ?? listing.pricePerUnit;
    const total = lineTotal(line.quantity, price);
    subtotal += total;
    itemRows.push({
      listingId: listing.id,
      produceId: listing.produceId,
      matchId: line.matchId,
      quantity: line.quantity,
      pricePerUnit: price,
      lineTotal: total,
    });
  }
  if (subtotal > MAX_CENTS / 2) {
    throw Errors.badRequest('ORDER_TOO_LARGE', 'This order is too large. Split it into smaller orders.');
  }

  const [defaultFee, commissionBps] = await Promise.all([
    getSetting(tx, 'deliveryFeeCents'),
    getSetting(tx, 'commissionBps'),
  ]);
  const totals = orderTotals(subtotal, a.deliveryFee ?? defaultFee, commissionBps);

  const first = listings[0]!;
  const deliveryDate =
    a.deliveryDate ?? (first.availableFrom > new Date() ? first.availableFrom : new Date());
  const profile = buyerOrg.profile;

  const order = await tx.order.create({
    data: {
      code: await nextOrderCode(tx),
      buyerOrgId: a.buyerOrgId,
      createdById: a.createdById,
      farmerId,
      status: a.initialStatus ?? 'PENDING',
      paymentTerms: profile.paymentTerms,
      subtotal: totals.subtotal,
      deliveryFee: totals.deliveryFee,
      commission: totals.commission,
      total: totals.total,
      deliveryDate,
      deliveryWindow: a.deliveryWindow,
      deliveryAddress: a.deliveryAddress ?? profile.address,
      deliveryLat: a.deliveryLat ?? profile.lat,
      deliveryLng: a.deliveryLng ?? profile.lng,
      notes: a.notes,
      checkoutId: a.checkoutId,
      items: { create: itemRows },
      events: {
        create: [
          { from: null, to: 'PENDING', actorId: a.createdById, note: 'Order placed' },
          ...(a.initialStatus === 'CONFIRMED'
            ? [
                {
                  from: 'PENDING' as const,
                  to: 'CONFIRMED' as const,
                  note: 'Confirmed through accepted match',
                },
              ]
            : []),
        ],
      },
    },
  });

  await emit(
    tx,
    'order.created',
    { orderId: order.id, buyerOrgId: order.buyerOrgId, farmerId: order.farmerId, code: order.code },
    order.id,
  );
  return order;
}
