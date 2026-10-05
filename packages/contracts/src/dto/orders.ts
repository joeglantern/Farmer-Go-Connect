import { z } from 'zod';
import { page } from '../common.js';
import { BuyerCategory, OrderStatus, RouteStatus, TxStatus } from '../enums.js';
import { PlatformRole } from '../roles.js';
import {
  DisputeDto,
  DriverLocationDto,
  InspectionDto,
  OrderDto,
  OrderEventDto,
  OrderItemDto,
  OrderMessageDto,
  PaymentDto,
  PayoutDto,
  ProduceDto,
  ReviewDto,
  StopDto,
  SupplyListingDto,
} from './models.js';
import { IsoDateTime, NullableString, OrgRef, UserRef } from './primitives.js';

/** How the signed-in user relates to an order. */
export const OrderViewer = z.enum(['buyer', 'farmer', 'qa', 'driver', 'admin', 'agent']);
export type OrderViewer = z.infer<typeof OrderViewer>;

/** GET /v1/orders items */
export const OrderListItemDto = OrderDto.extend({
  items: z.array(OrderItemDto.extend({ listing: SupplyListingDto.extend({ produce: ProduceDto }) })),
  buyerOrg: OrgRef,
  farmer: UserRef,
});
export type OrderListItemDto = z.infer<typeof OrderListItemDto>;

export const OrderPageDto = page(OrderListItemDto);
export type OrderPageDto = z.infer<typeof OrderPageDto>;

export const OrderDetailItemDto = OrderItemDto.extend({
  listing: SupplyListingDto.extend({
    produce: ProduceDto,
    farm: z.object({ name: z.string(), county: z.string(), ward: NullableString }),
  }),
  inspection: InspectionDto.nullable(),
});

export const OrderRouteDto = z.object({
  id: z.string(),
  code: z.string(),
  status: RouteStatus,
  driver: z.object({ id: z.string(), name: z.string(), phoneNumber: NullableString }).nullable(),
});

/** GET /v1/orders/:id */
export const OrderDetailDto = OrderDto.extend({
  items: z.array(OrderDetailItemDto),
  events: z.array(OrderEventDto),
  buyerOrg: OrgRef.extend({
    profile: z
      .object({
        county: z.string(),
        town: NullableString,
        address: NullableString,
        buyerCategory: BuyerCategory.nullable(),
      })
      .nullable(),
  }),
  farmer: UserRef,
  stops: z.array(StopDto),
  payments: z.array(PaymentDto),
  /** Never present for buyers. */
  payout: PayoutDto.nullable().optional(),
  disputes: z.array(DisputeDto),
  reviews: z.array(ReviewDto),
  route: OrderRouteDto.nullable(),
  viewer: OrderViewer,
  /** Statuses the caller may move this order to, from the shared state machine. */
  allowedTransitions: z.array(OrderStatus),
});
export type OrderDetailDto = z.infer<typeof OrderDetailDto>;

/** POST /v1/orders/:id/pay and /v1/invoices/:id/pay (202) */
export const PaymentStartedDto = z.object({
  paymentId: z.string(),
  status: TxStatus,
  checkoutRequestId: NullableString.optional(),
  /** Card payments: open this hosted checkout page; the app is sent back to farmgo://payment-return. */
  redirectUrl: NullableString.optional(),
  message: z.string(),
});
export type PaymentStartedDto = z.infer<typeof PaymentStartedDto>;

/** Order chat message with its author. */
export const MessageDto = OrderMessageDto.extend({
  author: z.object({ id: z.string(), name: z.string(), role: PlatformRole.nullable() }),
});
export type MessageDto = z.infer<typeof MessageDto>;

export const MessageListDto = z.array(MessageDto);
export type MessageListDto = z.infer<typeof MessageListDto>;

/** GET /v1/conversations items: one thread per order the caller can see. */
export const ConversationDto = z.object({
  orderId: z.string(),
  orderCode: z.string(),
  orderStatus: OrderStatus,
  /** Who the caller talks to: the farmer for buyers, the buyer organization for everyone else. */
  other: z.object({
    id: z.string(),
    name: z.string(),
    avatarUrl: z.string().nullable(),
    /** `farmer` for a farmer, `buyer` for a buyer organization. */
    role: z.string().nullable(),
  }),
  lastMessage: z
    .object({ body: z.string(), authorId: z.string(), createdAt: IsoDateTime, hasPhotos: z.boolean() })
    .nullable(),
  /** Messages from others since the caller last opened the thread. */
  unreadCount: z.number().int(),
  /** Latest of the last message and the order's last change: the list is sorted by this, newest first. */
  updatedAt: IsoDateTime,
});
export type ConversationDto = z.infer<typeof ConversationDto>;

export const ConversationListDto = z.array(ConversationDto);

/** GET /v1/me/badges: counts for tab badges. */
export const BadgesDto = z.object({
  notificationsUnread: z.number().int(),
  messagesUnread: z.number().int(),
});
export type BadgesDto = z.infer<typeof BadgesDto>;

/** GET /v1/orders/:id/tracking */
export const TrackingDto = z.object({
  route: z
    .object({
      id: z.string(),
      code: z.string(),
      status: RouteStatus,
      driver: z.object({ name: z.string(), phoneNumber: NullableString }).nullable(),
    })
    .nullable(),
  stops: z.array(StopDto),
  /** When the buyer expects it: the delivery date and window (Nairobi). */
  deliveryDate: IsoDateTime,
  deliveryWindow: NullableString,
  /** Latest GPS ping while the route is in progress, else null. */
  lastLocation: DriverLocationDto.nullable(),
});
export type TrackingDto = z.infer<typeof TrackingDto>;
