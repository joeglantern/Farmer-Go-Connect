import { z } from 'zod';
import { CheckoutPaymentMethod } from '../checkout.js';
import { OrderStatus, PaymentStatus, Unit } from '../enums.js';
import { FileUrl, IsoDateTime, NullableString } from './primitives.js';

/**
 * How a line compares with the listing now: `reduced` means less is left than asked (the line
 * is capped at what is available), `unavailable` means it cannot be bought for that date, and
 * `price_changed` means the price differs from the one the buyer saw.
 */
export const LineStatus = z.enum(['ok', 'reduced', 'unavailable', 'price_changed']);
export type LineStatus = z.infer<typeof LineStatus>;

export const CheckoutLineDto = z.object({
  listingId: z.string(),
  produceId: z.string(),
  name: z.string(),
  nameSw: z.string(),
  unit: Unit,
  /** Quantity that will be ordered (capped at what is available when `reduced`, 0 when unavailable). */
  quantity: z.number(),
  /** Quantity the buyer asked for. */
  requestedQuantity: z.number(),
  /** Current price per unit, in cents. */
  pricePerUnit: z.number().int(),
  lineTotal: z.number().int(),
  /** Quantity still available on the listing. */
  available: z.number(),
  status: LineStatus,
  /** First listing photo, else the catalog image, else null. */
  photoUrl: FileUrl,
});
export type CheckoutLineDto = z.infer<typeof CheckoutLineDto>;

/** One farmer's produce: it becomes one order at checkout. */
export const CheckoutGroupDto = z.object({
  farmId: z.string(),
  farmName: z.string(),
  farmerFirstName: z.string(),
  county: z.string(),
  items: z.array(CheckoutLineDto),
  subtotal: z.number().int(),
});
export type CheckoutGroupDto = z.infer<typeof CheckoutGroupDto>;

export const CheckoutProblemDto = z.object({
  listingId: z.string(),
  /** LISTING_UNAVAILABLE | NOT_ON_DATE | QUANTITY_REDUCED | PRICE_CHANGED | OWN_LISTING */
  code: z.string(),
  message: z.string(),
});
export type CheckoutProblemDto = z.infer<typeof CheckoutProblemDto>;

/** GET /v1/cart and the cart writes. */
export const CartDto = z.object({
  groups: z.array(CheckoutGroupDto),
  subtotal: z.number().int(),
  itemCount: z.number().int(),
  problems: z.array(CheckoutProblemDto),
});
export type CartDto = z.infer<typeof CartDto>;

/** POST /v1/orders/:id/reorder: the order's items back in the cart at today's prices. */
export const ReorderResultDto = z.object({
  cart: CartDto,
  added: z.array(
    z.object({ listingId: z.string(), name: z.string(), quantity: z.number(), reduced: z.boolean() }),
  ),
  /** Items that could not be added: the listing closed, sold out, or is your own. */
  skipped: z.array(z.object({ listingId: z.string(), name: z.string(), reason: z.string() })),
});
export type ReorderResultDto = z.infer<typeof ReorderResultDto>;

/** POST /v1/checkout/quote */
export const CheckoutQuoteDto = z.object({
  groups: z.array(CheckoutGroupDto),
  subtotal: z.number().int(),
  /** One delivery fee per checkout, whatever the number of farmers. */
  deliveryFee: z.number().int(),
  total: z.number().int(),
  /** Methods this buyer can use (INVOICE only for credit-terms buyers). */
  paymentMethods: z.array(CheckoutPaymentMethod),
  problems: z.array(CheckoutProblemDto),
  deliveryDate: IsoDateTime,
  deliveryWindow: z.string(),
});
export type CheckoutQuoteDto = z.infer<typeof CheckoutQuoteDto>;

export const CheckoutOrderDto = z.object({
  id: z.string(),
  code: z.string(),
  farmName: z.string(),
  /** What the buyer owes for this order: accepted produce plus its share of delivery. */
  total: z.number().int(),
  status: OrderStatus,
  paymentStatus: PaymentStatus,
  /** Paid on this order net of refunds; the order still owes `total - netPaid` when positive. */
  netPaid: z.number().int(),
  /** Money returned to the buyer on this order (cancellation, rejected produce, disputes). */
  refundedAmount: z.number().int(),
});
export type CheckoutOrderDto = z.infer<typeof CheckoutOrderDto>;

export const CheckoutPaymentDto = z.object({
  method: CheckoutPaymentMethod,
  paymentId: NullableString,
  /** FAILED covers failed, cancelled and timed-out M-Pesa requests: offer "Try again". */
  status: z.enum(['PENDING', 'SUCCESS', 'FAILED', 'NOT_REQUIRED']),
  checkoutRequestId: NullableString.optional(),
  redirectUrl: NullableString.optional(),
  message: z.string().optional(),
});
export type CheckoutPaymentDto = z.infer<typeof CheckoutPaymentDto>;

/** A saved delivery address. `orgId` is set when it belongs to the buyer organization. */
export const AddressDto = z.object({
  id: z.string(),
  orgId: NullableString,
  userId: z.string(),
  label: z.string(),
  county: z.string(),
  town: NullableString,
  line1: z.string(),
  landmark: NullableString,
  lat: z.number().nullable(),
  lng: z.number().nullable(),
  instructions: NullableString,
  isDefault: z.boolean(),
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
});
export type AddressDto = z.infer<typeof AddressDto>;
export const AddressListDto = z.array(AddressDto);

/** GET /v1/delivery/slots */
export const DeliverySlotsDto = z.object({
  /** Orders before this hour (Nairobi) can be delivered the next day. */
  cutoffHour: z.number().int(),
  /** First bookable date now, "YYYY-MM-DD" (Nairobi). */
  earliestDate: z.string(),
  windows: z.array(z.string()),
  days: z.array(
    z.object({
      date: z.string(),
      available: z.boolean(),
      windows: z.array(
        z.object({ window: z.string(), available: z.boolean(), reason: z.string().nullable() }),
      ),
    }),
  ),
});
export type DeliverySlotsDto = z.infer<typeof DeliverySlotsDto>;

/** POST /v1/checkout (201), GET /v1/checkouts/:id, POST /v1/checkouts/:id/pay (202) */
export const CheckoutResultDto = z.object({
  checkoutId: z.string(),
  orders: z.array(CheckoutOrderDto),
  /** Sum of the orders' current totals. */
  total: z.number().int(),
  /** Still owed across the checkout (0 once paid in full or for invoice buyers until invoiced). */
  balanceDue: z.number().int(),
  payment: CheckoutPaymentDto,
  deliveryDate: IsoDateTime,
  deliveryWindow: NullableString,
  createdAt: IsoDateTime,
});
export type CheckoutResultDto = z.infer<typeof CheckoutResultDto>;
