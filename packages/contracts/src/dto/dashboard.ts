import { z } from 'zod';
import { OrderStatus, RouteStatus } from '../enums.js';
import { FavoriteDto } from './favorites.js';
import { IsoDateTime, NullableNumber, NullableString } from './primitives.js';

/** "This month" is the calendar month in Nairobi. Money is integer KES cents. */

/** GET /v1/dashboard/farmer */
export const FarmerDashboardDto = z.object({
  activeListings: z.number().int(),
  ordersReceived: z.object({ allTime: z.number().int(), thisMonth: z.number().int() }),
  /** Net amounts paid out to the farmer (successful payouts). */
  sales: z.object({ allTimeCents: z.number().int(), thisMonthCents: z.number().int() }),
  rating: NullableNumber,
  qaPassRate: z.number(),
  /** Things waiting on the farmer. */
  actions: z.object({
    matchesWaiting: z.number().int(),
    ordersToConfirm: z.number().int(),
    harvestsDue48h: z.number().int(),
    payoutsPending: z.number().int(),
    /**
     * Money on the way to the farmer: pending payouts plus the expected net (accepted or ordered
     * produce minus commission) of live orders not yet paid out.
     */
    payoutsPendingCents: z.number().int(),
  }),
});
export type FarmerDashboardDto = z.infer<typeof FarmerDashboardDto>;

export const DashboardOrderDto = z.object({
  id: z.string(),
  code: z.string(),
  status: OrderStatus,
  total: z.number().int(),
  deliveryDate: IsoDateTime,
  farmerName: z.string(),
});

/** GET /v1/dashboard/buyer */
export const BuyerDashboardDto = z.object({
  totalOrders: z.number().int(),
  /** What the buyer's orders this month cost (cancelled and rejected orders excluded). */
  thisMonthSpend: z.number().int(),
  /** Orders not yet settled or closed, newest first (up to 5). */
  activeOrders: z.array(DashboardOrderDto),
  matchesWaiting: z.number().int(),
  upcomingRequirements: z.array(
    z.object({ id: z.string(), produceName: z.string(), quantity: z.number(), neededBy: IsoDateTime }),
  ),
  invoicesDue: z.object({ count: z.number().int(), amountCents: z.number().int() }),
  /** Up to 6 favorite categories and farmers, newest first, each with an image where one exists. */
  favorites: z.array(FavoriteDto),
});
export type BuyerDashboardDto = z.infer<typeof BuyerDashboardDto>;

/** GET /v1/dashboard/supplier */
export const SupplierDashboardDto = z.object({
  activeProducts: z.number().int(),
  lowStockProducts: z.number().int(),
  /** Products at or below this stock count as low (admin setting). */
  lowStockThreshold: z.number(),
  ordersToHandle: z.number().int(),
  ordersThisMonth: z.number().int(),
  salesThisMonthCents: z.number().int(),
  paidOutAllTimeCents: z.number().int(),
});
export type SupplierDashboardDto = z.infer<typeof SupplierDashboardDto>;

/** GET /v1/dashboard/agent */
export const AgentDashboardDto = z.object({
  farmersOnboarded: z.object({ allTime: z.number().int(), thisMonth: z.number().int() }),
  listingsCreated: z.object({ allTime: z.number().int(), thisMonth: z.number().int() }),
  pendingKyc: z.number().int(),
});
export type AgentDashboardDto = z.infer<typeof AgentDashboardDto>;

/** GET /v1/dashboard/driver */
export const DriverDashboardDto = z.object({
  routes: z.array(
    z.object({
      id: z.string(),
      code: z.string(),
      status: RouteStatus,
      county: z.string(),
      stopsTotal: z.number().int(),
      stopsDone: z.number().int(),
      distanceKm: NullableNumber,
      nextStop: z.object({ id: z.string(), kind: z.string(), address: NullableString }).nullable(),
    }),
  ),
});
export type DriverDashboardDto = z.infer<typeof DriverDashboardDto>;

/** GET /v1/dashboard/qa */
export const QaDashboardDto = z.object({
  tasksByCounty: z.array(z.object({ county: z.string(), tasks: z.number().int() })),
  inspectedToday: z.number().int(),
  passRateThisMonth: NullableNumber,
});
export type QaDashboardDto = z.infer<typeof QaDashboardDto>;
