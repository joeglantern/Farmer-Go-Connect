import { z } from 'zod';
import { Language } from '../common.js';
import { DeepLink } from '../deeplinks.js';
import {
  BuyerCategory,
  CrateStatus,
  DemandStatus,
  DisputeReason,
  DisputeStatus,
  Gender,
  InputCategory,
  InputOrderStatus,
  InspectionLocation,
  InvoiceStatus,
  KycStatus,
  ListingStatus,
  MatchStatus,
  OrderStatus,
  OrgType,
  PaymentMethod,
  PaymentStatus,
  PaymentTerms,
  ProduceCategory,
  RouteStatus,
  StopKind,
  StopStatus,
  TxStatus,
  Unit,
} from '../enums.js';
import { PlatformRole } from '../roles.js';
import {
  DecimalNumber,
  FileUrl,
  FileUrls,
  IsoDateTime,
  JsonValue,
  NullableDateTime,
  NullableNumber,
  NullableString,
} from './primitives.js';

/**
 * One DTO per database model, mirroring the Prisma schema (packages/db/prisma/schema.prisma).
 * Route DTOs in the sibling files compose these with `.extend()` for included relations.
 * Anything not listed here is stripped from responses, which is how private fields
 * (M-Pesa raw payloads, session tokens) stay off the wire.
 */

export const UserDto = z.object({
  id: z.string(),
  name: z.string(),
  email: z.string(),
  emailVerified: z.boolean(),
  image: NullableString,
  /** Avatar URL (from `image`). */
  imageUrl: FileUrl,
  phoneNumber: NullableString,
  phoneNumberVerified: z.boolean().nullable(),
  role: PlatformRole.nullable(),
  banned: z.boolean().nullable(),
  banReason: NullableString,
  banExpires: NullableDateTime,
  twoFactorEnabled: z.boolean().nullable(),
  preferredLanguage: Language,
  county: NullableString,
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
});
export type UserDto = z.infer<typeof UserDto>;

export const OrganizationDto = z.object({
  id: z.string(),
  name: z.string(),
  slug: z.string(),
  logo: NullableString,
  metadata: NullableString,
  createdAt: IsoDateTime,
});
export type OrganizationDto = z.infer<typeof OrganizationDto>;

export const MemberDto = z.object({
  id: z.string(),
  organizationId: z.string(),
  userId: z.string(),
  role: z.string(),
  createdAt: IsoDateTime,
});
export type MemberDto = z.infer<typeof MemberDto>;

export const OrgProfileDto = z.object({
  id: z.string(),
  organizationId: z.string(),
  type: OrgType,
  buyerCategory: BuyerCategory.nullable(),
  county: z.string(),
  town: NullableString,
  address: NullableString,
  lat: NullableNumber,
  lng: NullableNumber,
  phone: NullableString,
  email: NullableString,
  kraPin: NullableString,
  paymentTerms: PaymentTerms,
  creditLimit: z.number().int(),
  verified: z.boolean(),
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
});
export type OrgProfileDto = z.infer<typeof OrgProfileDto>;

export const FarmerProfileDto = z.object({
  id: z.string(),
  userId: z.string(),
  dateOfBirth: NullableDateTime,
  gender: Gender,
  mpesaNumber: z.string(),
  nationalIdKey: NullableString,
  kycStatus: KycStatus,
  onboardedById: NullableString,
  groupOrgId: NullableString,
  ordersCompleted: z.number().int(),
  qaPassRate: z.number(),
  onTimeRate: z.number(),
  ratingAvg: NullableNumber,
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
});
export type FarmerProfileDto = z.infer<typeof FarmerProfileDto>;

export const FarmDto = z.object({
  id: z.string(),
  farmerId: z.string(),
  name: z.string(),
  county: z.string(),
  ward: NullableString,
  lat: NullableNumber,
  lng: NullableNumber,
  acreage: NullableNumber,
  isOrganic: z.boolean(),
  photoKey: NullableString,
  photoUrl: FileUrl,
  active: z.boolean(),
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
});
export type FarmDto = z.infer<typeof FarmDto>;

export const ProduceDto = z.object({
  id: z.string(),
  slug: z.string(),
  name: z.string(),
  nameSw: z.string(),
  category: ProduceCategory,
  unit: Unit,
  grades: z.array(z.string()),
  shelfLifeDays: z.number().int(),
  imageKey: NullableString,
  /** Catalog photo, or null until one is uploaded. */
  imageUrl: FileUrl,
  active: z.boolean(),
  createdAt: IsoDateTime,
});
export type ProduceDto = z.infer<typeof ProduceDto>;

export const SupplyListingDto = z.object({
  id: z.string(),
  farmId: z.string(),
  produceId: z.string(),
  quantity: DecimalNumber,
  quantityLeft: DecimalNumber,
  grade: NullableString,
  pricePerUnit: z.number().int(),
  availableFrom: IsoDateTime,
  availableTo: IsoDateTime,
  harvestReady: z.boolean(),
  status: ListingStatus,
  photos: z.array(z.string()),
  photoUrls: FileUrls,
  notes: NullableString,
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
});
export type SupplyListingDto = z.infer<typeof SupplyListingDto>;

export const DemandDto = z.object({
  id: z.string(),
  buyerOrgId: z.string(),
  createdById: z.string(),
  produceId: z.string(),
  quantity: DecimalNumber,
  quantityFilled: DecimalNumber,
  minGrade: NullableString,
  maxPricePerUnit: z.number().int().nullable(),
  neededBy: IsoDateTime,
  recurrence: NullableString,
  recurrenceUntil: NullableDateTime,
  parentId: NullableString,
  county: z.string(),
  deliveryLat: NullableNumber,
  deliveryLng: NullableNumber,
  notes: NullableString,
  status: DemandStatus,
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
});
export type DemandDto = z.infer<typeof DemandDto>;

export const MatchDto = z.object({
  id: z.string(),
  demandId: z.string(),
  listingId: z.string(),
  quantity: DecimalNumber,
  pricePerUnit: z.number().int(),
  score: z.number(),
  scoreBreakdown: JsonValue,
  distanceKm: NullableNumber,
  status: MatchStatus,
  buyerAcceptedAt: NullableDateTime,
  farmerAcceptedAt: NullableDateTime,
  expiresAt: IsoDateTime,
  createdByAdminId: NullableString,
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
});
export type MatchDto = z.infer<typeof MatchDto>;

export const OrderDto = z.object({
  id: z.string(),
  code: z.string(),
  buyerOrgId: z.string(),
  createdById: z.string(),
  farmerId: z.string(),
  status: OrderStatus,
  paymentStatus: PaymentStatus,
  paymentTerms: PaymentTerms,
  subtotal: z.number().int(),
  deliveryFee: z.number().int(),
  commission: z.number().int(),
  total: z.number().int(),
  acceptedSubtotal: z.number().int().nullable(),
  deliveryDate: IsoDateTime,
  deliveryLat: NullableNumber,
  deliveryLng: NullableNumber,
  deliveryAddress: NullableString,
  notes: NullableString,
  cancelReason: NullableString,
  deliveredAt: NullableDateTime,
  receiptConfirmedAt: NullableDateTime,
  invoiceId: NullableString,
  /** Set when the order was placed in a multi-farmer cart checkout. */
  checkoutId: NullableString,
  /** e.g. "06:00-08:00" on deliveryDate (Africa/Nairobi). */
  deliveryWindow: NullableString,
  routeId: NullableString,
  version: z.number().int(),
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
});
export type OrderDto = z.infer<typeof OrderDto>;

export const OrderItemDto = z.object({
  id: z.string(),
  orderId: z.string(),
  matchId: NullableString,
  listingId: z.string(),
  produceId: z.string(),
  quantity: DecimalNumber,
  pricePerUnit: z.number().int(),
  lineTotal: z.number().int(),
});
export type OrderItemDto = z.infer<typeof OrderItemDto>;

export const OrderEventDto = z.object({
  id: z.string(),
  orderId: z.string(),
  from: OrderStatus.nullable(),
  to: OrderStatus,
  actorId: NullableString,
  note: NullableString,
  createdAt: IsoDateTime,
});
export type OrderEventDto = z.infer<typeof OrderEventDto>;

export const OrderMessageDto = z.object({
  id: z.string(),
  orderId: z.string(),
  authorId: z.string(),
  body: z.string(),
  photos: z.array(z.string()),
  photoUrls: FileUrls,
  createdAt: IsoDateTime,
});
export type OrderMessageDto = z.infer<typeof OrderMessageDto>;

export const InspectionDto = z.object({
  id: z.string(),
  orderItemId: z.string(),
  inspectorId: z.string(),
  grade: z.string(),
  passed: z.boolean(),
  acceptedQty: DecimalNumber,
  rejectedQty: DecimalNumber,
  rejectReason: NullableString,
  checklist: JsonValue,
  notes: NullableString,
  photos: z.array(z.string()),
  photoUrls: FileUrls,
  location: InspectionLocation.nullable(),
  inspectedAt: IsoDateTime,
});
export type InspectionDto = z.infer<typeof InspectionDto>;

export const RouteDto = z.object({
  id: z.string(),
  code: z.string(),
  driverId: NullableString,
  date: IsoDateTime,
  county: z.string(),
  status: RouteStatus,
  vehicle: NullableString,
  distanceKm: NullableNumber,
  startedAt: NullableDateTime,
  completedAt: NullableDateTime,
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
});
export type RouteDto = z.infer<typeof RouteDto>;

/** A pickup at a farm or a drop-off at a buyer (Prisma model `Delivery`). */
export const StopDto = z.object({
  id: z.string(),
  routeId: z.string(),
  orderId: z.string(),
  kind: StopKind,
  sequence: z.number().int(),
  lat: NullableNumber,
  lng: NullableNumber,
  address: NullableString,
  status: StopStatus,
  eta: NullableDateTime,
  arrivedAt: NullableDateTime,
  completedAt: NullableDateTime,
  podPhotoKey: NullableString,
  podPhotoUrl: FileUrl,
  signatureKey: NullableString,
  signatureUrl: FileUrl,
  recipientName: NullableString,
  failureReason: NullableString,
  cratesDropped: z.number().int(),
  cratesCollected: z.number().int(),
});
export type StopDto = z.infer<typeof StopDto>;

export const DriverLocationDto = z.object({
  /** BigInt ids are serialized as strings. */
  id: z.string(),
  routeId: z.string(),
  driverId: z.string(),
  lat: z.number(),
  lng: z.number(),
  heading: NullableNumber,
  speedKph: NullableNumber,
  recordedAt: IsoDateTime,
});
export type DriverLocationDto = z.infer<typeof DriverLocationDto>;

export const CrateDto = z.object({
  id: z.string(),
  qrCode: z.string(),
  size: z.string(),
  status: CrateStatus,
  holderUserId: NullableString,
  holderOrgId: NullableString,
  depositCents: z.number().int(),
  lastSeenAt: NullableDateTime,
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
});
export type CrateDto = z.infer<typeof CrateDto>;

export const CrateMovementDto = z.object({
  id: z.string(),
  crateId: z.string(),
  orderId: NullableString,
  deliveryId: NullableString,
  from: CrateStatus,
  to: CrateStatus,
  scannedById: z.string(),
  toUserId: NullableString,
  toOrgId: NullableString,
  note: NullableString,
  createdAt: IsoDateTime,
});
export type CrateMovementDto = z.infer<typeof CrateMovementDto>;

/** Buyer to platform payment (or refund when direction is OUT). The provider's raw payload is never exposed. */
export const PaymentDto = z.object({
  id: z.string(),
  orderId: NullableString,
  invoiceId: NullableString,
  /** Set on a cart checkout's payment (and on its per-order shares). */
  checkoutId: NullableString,
  /** On an order's share of a checkout payment: the checkout payment it came from. */
  allocatedFromId: NullableString,
  /** Collection or refund for a green-input order. */
  inputOrderId: NullableString,
  method: PaymentMethod,
  direction: z.enum(['IN', 'OUT']),
  amount: z.number().int(),
  phoneNumber: NullableString,
  status: TxStatus,
  mpesaReceipt: NullableString,
  checkoutRequestId: NullableString,
  merchantRequestId: NullableString,
  resultCode: NullableString,
  resultDesc: NullableString,
  idempotencyKey: z.string(),
  initiatedById: NullableString,
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
});
export type PaymentDto = z.infer<typeof PaymentDto>;

export const PayoutDto = z.object({
  id: z.string(),
  /** The produce order, or null for a green-input supplier payout (see inputOrderId). */
  orderId: NullableString,
  inputOrderId: NullableString,
  farmerId: z.string(),
  phoneNumber: z.string(),
  grossAmount: z.number().int(),
  commission: z.number().int(),
  amount: z.number().int(),
  status: TxStatus,
  mpesaReceipt: NullableString,
  conversationId: NullableString,
  originatorConversationId: NullableString,
  resultCode: NullableString,
  resultDesc: NullableString,
  attempts: z.number().int(),
  idempotencyKey: z.string(),
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
});
export type PayoutDto = z.infer<typeof PayoutDto>;

export const InvoiceDto = z.object({
  id: z.string(),
  number: z.string(),
  buyerOrgId: z.string(),
  periodStart: IsoDateTime,
  periodEnd: IsoDateTime,
  subtotal: z.number().int(),
  total: z.number().int(),
  amountPaid: z.number().int(),
  status: InvoiceStatus,
  issuedAt: NullableDateTime,
  dueAt: NullableDateTime,
  pdfKey: NullableString,
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
});
export type InvoiceDto = z.infer<typeof InvoiceDto>;

export const DisputeDto = z.object({
  id: z.string(),
  /** The produce order, or null for a problem reported on a green-input order. */
  orderId: NullableString,
  inputOrderId: NullableString,
  raisedById: z.string(),
  reason: DisputeReason,
  description: z.string(),
  photos: z.array(z.string()),
  photoUrls: FileUrls,
  status: DisputeStatus,
  refundAmount: z.number().int().nullable(),
  resolution: NullableString,
  resolvedById: NullableString,
  resolvedAt: NullableDateTime,
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
});
export type DisputeDto = z.infer<typeof DisputeDto>;

export const ReviewDto = z.object({
  id: z.string(),
  orderId: z.string(),
  authorId: z.string(),
  targetUserId: NullableString,
  targetOrgId: NullableString,
  rating: z.number().int(),
  comment: NullableString,
  createdAt: IsoDateTime,
});
export type ReviewDto = z.infer<typeof ReviewDto>;

export const PricePointDto = z.object({
  id: z.string(),
  produceId: z.string(),
  county: z.string(),
  week: IsoDateTime,
  avgPrice: z.number().int(),
  minPrice: z.number().int(),
  maxPrice: z.number().int(),
  volume: DecimalNumber,
  sampleSize: z.number().int(),
  createdAt: IsoDateTime,
});
export type PricePointDto = z.infer<typeof PricePointDto>;

export const DemandForecastDto = z.object({
  id: z.string(),
  produceId: z.string(),
  county: z.string(),
  week: IsoDateTime,
  forecastQty: DecimalNumber,
  method: z.string(),
  createdAt: IsoDateTime,
});
export type DemandForecastDto = z.infer<typeof DemandForecastDto>;

export const InputProductDto = z.object({
  id: z.string(),
  supplierOrgId: z.string(),
  name: z.string(),
  description: NullableString,
  category: InputCategory,
  unit: Unit,
  pricePerUnit: z.number().int(),
  stock: DecimalNumber,
  isOrganic: z.boolean(),
  photos: z.array(z.string()),
  photoUrls: FileUrls,
  county: z.string(),
  active: z.boolean(),
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
});
export type InputProductDto = z.infer<typeof InputProductDto>;

export const InputOrderDto = z.object({
  id: z.string(),
  productId: z.string(),
  buyerId: z.string(),
  quantity: DecimalNumber,
  pricePerUnit: z.number().int(),
  total: z.number().int(),
  status: InputOrderStatus,
  /** Paid by M-Pesa when ordering and held until delivery. */
  paymentStatus: PaymentStatus,
  deliveryNote: NullableString,
  dispatchedAt: NullableDateTime,
  deliveredAt: NullableDateTime,
  receiptConfirmedAt: NullableDateTime,
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
});
export type InputOrderDto = z.infer<typeof InputOrderDto>;

export const NotificationDto = z.object({
  id: z.string(),
  userId: z.string(),
  type: z.string(),
  title: z.string(),
  body: z.string(),
  /** Includes `route` and `params` (see `link`). */
  data: JsonValue,
  /** Where tapping the notification goes; null for notifications from before deep links. */
  link: DeepLink.nullable(),
  channels: z.array(z.string()),
  readAt: NullableDateTime,
  createdAt: IsoDateTime,
});
export type NotificationDto = z.infer<typeof NotificationDto>;

export const NotificationPrefsDto = z.object({
  userId: z.string(),
  sms: z.boolean(),
  push: z.boolean(),
  email: z.boolean(),
  quietFrom: z.number().int().nullable(),
  quietTo: z.number().int().nullable(),
  /** Absent until the user has saved preferences once. */
  updatedAt: IsoDateTime.optional(),
});
export type NotificationPrefsDto = z.infer<typeof NotificationPrefsDto>;

export const DeviceTokenDto = z.object({
  id: z.string(),
  userId: z.string(),
  token: z.string(),
  platform: z.enum(['ios', 'android', 'web']),
  createdAt: IsoDateTime,
  lastSeenAt: IsoDateTime,
});
export type DeviceTokenDto = z.infer<typeof DeviceTokenDto>;

export const AuditLogDto = z.object({
  /** BigInt ids are serialized as strings. */
  id: z.string(),
  actorId: NullableString,
  action: z.string(),
  entity: z.string(),
  entityId: z.string(),
  before: JsonValue,
  after: JsonValue,
  ip: NullableString,
  createdAt: IsoDateTime,
});
export type AuditLogDto = z.infer<typeof AuditLogDto>;
