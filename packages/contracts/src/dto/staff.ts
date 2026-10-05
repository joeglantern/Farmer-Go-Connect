import { z } from 'zod';
import { page } from '../common.js';
import { KycStatus, OrderStatus, RouteStatus, Unit } from '../enums.js';
import {
  FarmDto,
  FarmerProfileDto,
  InspectionDto,
  ProduceDto,
  RouteDto,
  StopDto,
  SupplyListingDto,
} from './models.js';
import { NullableNumber, NullableString } from './primitives.js';

// ─── B19: staff history ───────────────────────────────────────

/** GET /v1/qa/inspections items: an officer's past inspections. */
export const InspectionHistoryItemDto = InspectionDto.extend({
  orderItem: z.object({
    id: z.string(),
    quantity: z.number(),
    order: z.object({
      id: z.string(),
      code: z.string(),
      status: OrderStatus,
      buyerOrg: z.object({ name: z.string() }),
    }),
    listing: z.object({
      produce: z.object({ name: z.string(), nameSw: z.string(), unit: Unit }),
      farm: z.object({ name: z.string(), county: z.string() }),
    }),
  }),
});
export type InspectionHistoryItemDto = z.infer<typeof InspectionHistoryItemDto>;
export const InspectionHistoryPageDto = page(InspectionHistoryItemDto);

/** GET /v1/driver/routes items: a driver's routes with progress. */
export const DriverRouteItemDto = RouteDto.extend({
  stopsTotal: z.number().int(),
  stopsDone: z.number().int(),
});
export type DriverRouteItemDto = z.infer<typeof DriverRouteItemDto>;
export const DriverRoutePageDto = page(DriverRouteItemDto);

// ─── B20: single-record reads ─────────────────────────────────

/** GET /v1/stops/:id */
export const StopDetailDto = StopDto.extend({
  route: z.object({ id: z.string(), code: z.string(), status: RouteStatus, date: z.string() }),
  order: z.object({
    id: z.string(),
    code: z.string(),
    status: OrderStatus,
    deliveryWindow: NullableString,
    buyerOrg: z.object({ name: z.string(), phone: NullableString }),
    items: z.array(
      z.object({
        quantity: z.number(),
        listing: z.object({ produce: z.object({ name: z.string(), nameSw: z.string(), unit: Unit }) }),
      }),
    ),
  }),
});
export type StopDetailDto = z.infer<typeof StopDetailDto>;

/** GET /v1/agent/farmers/:id */
export const AgentFarmerDetailDto = FarmerProfileDto.extend({
  user: z.object({
    id: z.string(),
    name: z.string(),
    phoneNumber: NullableString,
    county: NullableString,
    phoneNumberVerified: z.boolean().nullable(),
  }),
  farms: z.array(FarmDto.extend({ listings: z.array(SupplyListingDto.extend({ produce: ProduceDto })) })),
  performance: z.object({
    ordersTotal: z.number().int(),
    ordersCompleted: z.number().int(),
    activeListings: z.number().int(),
    qaPassRate: z.number(),
    onTimeRate: z.number(),
    rating: NullableNumber,
    paidOutCents: z.number().int(),
  }),
  kycStatus: KycStatus,
});
export type AgentFarmerDetailDto = z.infer<typeof AgentFarmerDetailDto>;
