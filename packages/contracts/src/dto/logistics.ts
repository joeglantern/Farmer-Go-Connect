import { z } from 'zod';
import { page } from '../common.js';
import { OrderStatus, Unit } from '../enums.js';
import { DriverLocationDto, RouteDto, StopDto } from './models.js';
import { count, NullableString } from './primitives.js';

/** GET /v1/routes items (admin) */
export const RouteListItemDto = RouteDto.extend({
  driver: z.object({ id: z.string(), name: z.string() }).nullable(),
  _count: count('stops'),
});
export type RouteListItemDto = z.infer<typeof RouteListItemDto>;

export const RoutePageDto = page(RouteListItemDto);
export type RoutePageDto = z.infer<typeof RoutePageDto>;

/** POST /v1/routes/build (201) */
export const RoutesBuiltDto = z.object({ created: z.number().int(), routes: z.array(RouteDto) });
export type RoutesBuiltDto = z.infer<typeof RoutesBuiltDto>;

/** What the driver sees per stop: the order, who it is for and what is in it. */
export const RouteStopOrderDto = z.object({
  id: z.string(),
  code: z.string(),
  status: OrderStatus,
  deliveryWindow: NullableString,
  /** `phone` is the buyer's contact for drop-offs (null on pickups). */
  buyerOrg: z.object({ name: z.string(), phone: NullableString }),
  items: z.array(
    z.object({
      quantity: z.number(),
      listing: z.object({ produce: z.object({ name: z.string(), nameSw: z.string(), unit: Unit }) }),
    }),
  ),
});

export const RouteStopDto = StopDto.extend({ order: RouteStopOrderDto });
export type RouteStopDto = z.infer<typeof RouteStopDto>;

/** GET /v1/routes/today items */
export const RouteWithStopsDto = RouteDto.extend({
  driver: z.object({ id: z.string(), name: z.string(), phoneNumber: NullableString }).nullable(),
  stops: z.array(RouteStopDto),
});
export type RouteWithStopsDto = z.infer<typeof RouteWithStopsDto>;

export const RouteListDto = z.array(RouteWithStopsDto);

/** GET /v1/routes/:id */
export const RouteDetailDto = RouteWithStopsDto.extend({ lastLocation: DriverLocationDto.nullable() });
export type RouteDetailDto = z.infer<typeof RouteDetailDto>;

/** POST /v1/routes/:id/location */
export const LocationAcceptedDto = z.object({
  /** False when the ping was throttled (one per driver every 5 seconds). */
  accepted: z.boolean(),
});
export type LocationAcceptedDto = z.infer<typeof LocationAcceptedDto>;
