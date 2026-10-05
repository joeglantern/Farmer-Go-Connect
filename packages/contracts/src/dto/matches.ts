import { z } from 'zod';
import { page } from '../common.js';
import { DemandDto, MatchDto, ProduceDto, SupplyListingDto } from './models.js';
import { NullableString } from './primitives.js';

/** GET /v1/matches items */
export const MatchListItemDto = MatchDto.extend({
  demand: DemandDto.extend({ produce: ProduceDto }),
  listing: SupplyListingDto.extend({
    farm: z.object({ name: z.string(), county: z.string(), ward: NullableString, isOrganic: z.boolean() }),
  }),
  /** Set once both sides accepted and an order was created. */
  orderItem: z.object({ orderId: z.string() }).nullable(),
});
export type MatchListItemDto = z.infer<typeof MatchListItemDto>;

export const MatchPageDto = page(MatchListItemDto);
export type MatchPageDto = z.infer<typeof MatchPageDto>;

/** POST /v1/matches/:id/accept */
export const MatchAcceptDto = z.object({
  match: MatchDto.nullable(),
  /** The order created when both sides have accepted. */
  orderId: NullableString,
  /** Which side still has to accept, or null when the order exists. */
  waitingFor: z.enum(['buyer', 'farmer']).nullable(),
});
export type MatchAcceptDto = z.infer<typeof MatchAcceptDto>;
