import { z } from 'zod';
import { Cents, County, Id, IsoDate, KenyanPhone, Lat, Lng, Quantity } from './common.js';

// ─── Cart & checkout requests (B07) ───────────────────────────

/** "06:00-08:00": a delivery window on the delivery date, Africa/Nairobi time. */
export const DELIVERY_WINDOW_PATTERN = /^([01]\d|2[0-3]):[0-5]\d-([01]\d|2[0-3]):[0-5]\d$/;
export const DeliveryWindow = z.string().regex(DELIVERY_WINDOW_PATTERN, 'Use HH:MM-HH:MM');

/** PUT /v1/cart/items: set a line's quantity (0 removes it). */
export const CartItemInput = z.object({
  listingId: Id,
  quantity: z.number().min(0).max(1_000_000).multipleOf(0.01, 'Use at most two decimal places'),
});
export type CartItemInput = z.infer<typeof CartItemInput>;

export const CheckoutItem = z.object({
  listingId: Id,
  quantity: Quantity,
  /** The price the buyer saw. If the listing's price has changed since, the line is `price_changed`. */
  pricePerUnit: Cents.positive().optional(),
});
export type CheckoutItem = z.infer<typeof CheckoutItem>;

export const CheckoutAddress = z.object({
  line1: z.string().min(2).max(240),
  county: County,
  town: z.string().max(80).optional(),
  lat: Lat.optional(),
  lng: Lng.optional(),
});
export type CheckoutAddress = z.infer<typeof CheckoutAddress>;

export const CheckoutPaymentMethod = z.enum(['MPESA', 'CARD', 'INVOICE']);
export type CheckoutPaymentMethod = z.infer<typeof CheckoutPaymentMethod>;

/**
 * POST /v1/checkout/quote. `items` travel in the body (device cart); omit them to use the
 * server cart. Without an address the organization's own location is used.
 */
export const CheckoutQuoteInput = z.object({
  items: z.array(CheckoutItem).min(1).max(50).optional(),
  addressId: Id.optional(),
  address: CheckoutAddress.optional(),
  deliveryDate: IsoDate,
  deliveryWindow: DeliveryWindow,
});
export type CheckoutQuoteInput = z.infer<typeof CheckoutQuoteInput>;

/** POST /v1/checkout */
export const CheckoutInput = CheckoutQuoteInput.extend({
  paymentMethod: CheckoutPaymentMethod,
  /** M-Pesa number to charge; defaults to the account's phone. */
  phoneNumber: KenyanPhone.optional(),
  notes: z.string().max(500).optional(),
});
export type CheckoutInput = z.infer<typeof CheckoutInput>;

// ─── Saved addresses (B08) ────────────────────────────────────

export const AddressInput = z.object({
  /** e.g. "Home", "Main kitchen", "Westlands branch". */
  label: z.string().min(1).max(60),
  county: County,
  town: z.string().max(80).optional(),
  line1: z.string().min(2).max(240),
  landmark: z.string().max(160).optional(),
  lat: Lat.optional(),
  lng: Lng.optional(),
  /** Gate code, which door, who to ask for. */
  instructions: z.string().max(300).optional(),
  /** Make this the default (the previous default stops being one). */
  isDefault: z.boolean().optional(),
});
export type AddressInput = z.infer<typeof AddressInput>;
export const AddressUpdateInput = AddressInput.partial();

/** GET /v1/delivery/slots. `county` is accepted for future per-county capacity. */
export const DeliverySlotsQuery = z.object({
  from: IsoDate.optional(),
  days: z.coerce.number().int().min(1).max(30).default(7),
  county: County.optional(),
});

/** POST /v1/checkouts/:id/pay: retry a failed, cancelled or timed-out payment. */
export const CheckoutPayInput = z.object({
  phoneNumber: KenyanPhone.optional(),
  /** Switch method on retry (MPESA or CARD); defaults to the checkout's own method. */
  method: z.enum(['MPESA', 'CARD']).optional(),
});
