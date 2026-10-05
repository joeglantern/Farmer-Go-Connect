import { z } from 'zod';
import { page } from '../common.js';
import { OrderStatus, PaymentMethod, TxStatus } from '../enums.js';
import { InvoiceDto, OrderDto, PaymentDto, PayoutDto } from './models.js';
import { count, IsoDateTime, NullableString } from './primitives.js';

/** GET /v1/payments items */
export const PaymentListItemDto = PaymentDto.extend({
  order: z.object({ id: z.string(), code: z.string() }).nullable(),
  invoice: z.object({ id: z.string(), number: z.string() }).nullable(),
});
export type PaymentListItemDto = z.infer<typeof PaymentListItemDto>;

export const PaymentPageDto = page(PaymentListItemDto);
export type PaymentPageDto = z.infer<typeof PaymentPageDto>;

/** GET /v1/payments/:id */
export const PaymentDetailDto = PaymentDto.extend({
  order: OrderDto.nullable(),
  invoice: InvoiceDto.nullable(),
});
export type PaymentDetailDto = z.infer<typeof PaymentDetailDto>;

/** GET /v1/invoices items */
export const InvoiceListItemDto = InvoiceDto.extend({ _count: count('orders') });
export type InvoiceListItemDto = z.infer<typeof InvoiceListItemDto>;

export const InvoicePageDto = page(InvoiceListItemDto);
export type InvoicePageDto = z.infer<typeof InvoicePageDto>;

/** GET /v1/invoices/:id */
export const InvoiceDetailDto = InvoiceDto.extend({
  orders: z.array(
    z.object({
      id: z.string(),
      code: z.string(),
      total: z.number().int(),
      deliveryDate: IsoDateTime,
      status: OrderStatus,
    }),
  ),
  payments: z.array(
    z.object({
      id: z.string(),
      amount: z.number().int(),
      status: TxStatus,
      method: PaymentMethod,
      mpesaReceipt: NullableString,
      createdAt: IsoDateTime,
    }),
  ),
});
export type InvoiceDetailDto = z.infer<typeof InvoiceDetailDto>;

/** GET /v1/earnings: money actually paid out, per Nairobi calendar month, newest first. */
export const EarningsDto = z.object({
  months: z.array(
    z.object({
      /** "YYYY-MM" */
      month: z.string(),
      grossCents: z.number().int(),
      commissionCents: z.number().int(),
      netCents: z.number().int(),
      orders: z.number().int(),
    }),
  ),
  totals: z.object({
    grossCents: z.number().int(),
    commissionCents: z.number().int(),
    netCents: z.number().int(),
    orders: z.number().int(),
  }),
  /** Settling: payouts being sent plus paid orders waiting for the buyer's window or a problem to close. */
  pendingCents: z.number().int(),
});
export type EarningsDto = z.infer<typeof EarningsDto>;

/** GET /v1/payouts items */
export const PayoutListItemDto = PayoutDto.extend({
  /** Null for a green-input supplier payout (see inputOrderId). */
  order: z.object({ id: z.string(), code: z.string(), deliveryDate: IsoDateTime }).nullable(),
  /** Set for a green-input supplier payout. */
  inputOrder: z
    .object({ id: z.string(), total: z.number().int(), product: z.object({ name: z.string() }) })
    .nullable()
    .optional(),
});
export type PayoutListItemDto = z.infer<typeof PayoutListItemDto>;

/** GET /v1/payouts */
export const PayoutPageDto = page(PayoutListItemDto).extend({
  /** Sum of successful payouts to this farmer, all time. */
  totalPaidCents: z.number().int(),
  payoutsCount: z.number().int(),
  /** Successful payouts this calendar month (Nairobi). */
  paidThisMonthCents: z.number().int(),
  /** Payouts created and being sent. */
  pendingCents: z.number().int(),
  /** Money held: paid orders not yet paid out (buyer window open or a problem reported). */
  heldCents: z.number().int(),
});
export type PayoutPageDto = z.infer<typeof PayoutPageDto>;
