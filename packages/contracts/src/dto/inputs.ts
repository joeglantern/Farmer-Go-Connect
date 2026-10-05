import { z } from 'zod';
import { page } from '../common.js';
import { Unit } from '../enums.js';
import { InputOrderDto, InputProductDto } from './models.js';
import { NullableString, OrgRef } from './primitives.js';

/** GET /v1/inputs items and GET /v1/inputs/:id */
export const InputProductListItemDto = InputProductDto.extend({ supplierOrg: OrgRef });
export type InputProductListItemDto = z.infer<typeof InputProductListItemDto>;

export const InputProductPageDto = page(InputProductListItemDto);
export type InputProductPageDto = z.infer<typeof InputProductPageDto>;

/** The M-Pesa prompt started for an input order, or why it could not start. */
export const InputOrderPaymentDto = z.object({
  paymentId: NullableString,
  status: z.enum(['PENDING', 'FAILED']),
  message: z.string(),
});

/** POST /v1/inputs/:id/order (201) */
export const InputOrderCreatedDto = InputOrderDto.extend({
  product: InputProductDto,
  /** Pay with POST /v1/input-orders/:id/pay if this failed. */
  payment: InputOrderPaymentDto,
});
export type InputOrderCreatedDto = z.infer<typeof InputOrderCreatedDto>;

/** GET /v1/input-orders items */
export const InputOrderListItemDto = InputOrderDto.extend({
  product: z.object({ id: z.string(), name: z.string(), unit: Unit, supplierOrgId: z.string() }),
  buyer: z.object({ id: z.string(), name: z.string(), phoneNumber: NullableString }),
});
export type InputOrderListItemDto = z.infer<typeof InputOrderListItemDto>;

export const InputOrderPageDto = page(InputOrderListItemDto);
export type InputOrderPageDto = z.infer<typeof InputOrderPageDto>;
