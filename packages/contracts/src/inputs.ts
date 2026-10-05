import { z } from 'zod';
import {
  BoolParam,
  Cents,
  County,
  DateOfBirth,
  GeoPoint,
  Id,
  IsoDate,
  KenyanPhone,
  Language,
  Lat,
  Lng,
  ObjectKey,
  Pagination,
  Photos,
  Quantity,
} from './common.js';
import {
  BuyerCategory,
  CrateStatus,
  DemandStatus,
  DisputeReason,
  Gender,
  InputCategory,
  InputOrderStatus,
  InspectionLocation,
  KycStatus,
  ListingStatus,
  MatchStatus,
  OrderStatus,
  PaymentTerms,
  ProduceCategory,
  RouteStatus,
  Unit,
} from './enums.js';
import { PlatformRole } from './roles.js';

// ─── Profile & onboarding ─────────────────────────────────────

export const FarmInput = z.object({
  name: z.string().min(2).max(120),
  county: County,
  ward: z.string().max(80).optional(),
  lat: Lat.optional(),
  lng: Lng.optional(),
  acreage: z.number().positive().max(100_000).optional(),
  isOrganic: z.boolean().default(false),
  /** Upload to the `produce-photos` bucket first (POST /v1/uploads/presign). */
  photoKey: ObjectKey.optional(),
});
export type FarmInput = z.infer<typeof FarmInput>;
export const FarmUpdateInput = FarmInput.partial().extend({
  active: z.boolean().optional(),
  /** Send null to clear the farm's pin. */
  lat: Lat.nullable().optional(),
  lng: Lng.nullable().optional(),
});

export const OnboardFarmerInput = z.object({
  name: z.string().min(2).max(120),
  county: County,
  gender: Gender.default('UNDISCLOSED'),
  dateOfBirth: DateOfBirth.optional(),
  mpesaNumber: KenyanPhone.optional(),
  preferredLanguage: Language.optional(),
  groupOrgId: Id.optional(),
  farm: FarmInput.optional(),
});
export type OnboardFarmerInput = z.infer<typeof OnboardFarmerInput>;

/** Field agent registers a farmer who may not own a smartphone. */
export const AgentCreateFarmerInput = OnboardFarmerInput.extend({ phoneNumber: KenyanPhone });
export type AgentCreateFarmerInput = z.infer<typeof AgentCreateFarmerInput>;

export const OnboardBuyerInput = z.object({
  name: z.string().min(2).max(120).optional(),
  businessName: z.string().min(2).max(160),
  buyerCategory: BuyerCategory,
  county: County,
  town: z.string().max(80).optional(),
  address: z.string().max(240).optional(),
  lat: Lat.optional(),
  lng: Lng.optional(),
  phone: KenyanPhone.optional(),
  email: z.email().optional(),
  kraPin: z.string().max(20).optional(),
});
export type OnboardBuyerInput = z.infer<typeof OnboardBuyerInput>;

/** An individual or family buying fresh produce for home. Always prepaid; no KRA PIN or team. */
export const OnboardHouseholdInput = z.object({
  name: z.string().min(2).max(120),
  county: County,
  town: z.string().max(80).optional(),
  address: z.string().max(240).optional(),
  lat: Lat.optional(),
  lng: Lng.optional(),
  phone: KenyanPhone.optional(),
});
export type OnboardHouseholdInput = z.infer<typeof OnboardHouseholdInput>;

export const OnboardSupplierInput = z.object({
  name: z.string().min(2).max(120).optional(),
  businessName: z.string().min(2).max(160),
  county: County,
  town: z.string().max(80).optional(),
  address: z.string().max(240).optional(),
  lat: Lat.optional(),
  lng: Lng.optional(),
  phone: KenyanPhone.optional(),
});
export type OnboardSupplierInput = z.infer<typeof OnboardSupplierInput>;

export const UpdateMeInput = z.object({
  name: z.string().min(2).max(120).optional(),
  preferredLanguage: Language.optional(),
  county: County.optional(),
  image: ObjectKey.optional(),
});

export const UpdateFarmerProfileInput = z.object({
  gender: Gender.optional(),
  dateOfBirth: DateOfBirth.optional(),
  mpesaNumber: KenyanPhone.optional(),
  nationalIdKey: ObjectKey.optional(),
});

export const UpdateOrgProfileInput = OnboardBuyerInput.omit({
  name: true,
  businessName: true,
  buyerCategory: true,
})
  .partial()
  .extend({ buyerCategory: BuyerCategory.optional() });

// ─── Catalog ──────────────────────────────────────────────────

export const ProduceInput = z.object({
  slug: z
    .string()
    .regex(/^[a-z0-9-]+$/)
    .max(60),
  name: z.string().min(2).max(80),
  nameSw: z.string().min(2).max(80),
  category: ProduceCategory,
  unit: Unit,
  grades: z.array(z.string().max(8)).min(1).max(6).default(['A', 'B', 'C']),
  shelfLifeDays: z.number().int().min(1).max(365).default(7),
  imageKey: ObjectKey.optional(),
  active: z.boolean().default(true),
});
export const ProduceUpdateInput = ProduceInput.partial();
export const ProduceQuery = z.object({
  q: z.string().max(60).optional(),
  category: ProduceCategory.optional(),
});

// ─── Supply ───────────────────────────────────────────────────

const listingBase = z.object({
  farmId: Id,
  produceId: Id,
  quantity: Quantity,
  grade: z.string().max(8).optional(),
  pricePerUnit: Cents.positive(),
  availableFrom: IsoDate,
  availableTo: IsoDate,
  photos: Photos,
  notes: z.string().max(500).optional(),
  status: z.enum(['DRAFT', 'OPEN']).default('OPEN'),
});
export const CreateListingInput = listingBase.refine((v) => v.availableTo >= v.availableFrom, {
  message: 'availableTo must be on or after availableFrom',
  path: ['availableTo'],
});
export type CreateListingInput = z.infer<typeof CreateListingInput>;
export const UpdateListingInput = listingBase
  .omit({ farmId: true, produceId: true, status: true })
  .partial()
  .extend({ status: z.enum(['DRAFT', 'OPEN', 'CANCELLED']).optional() });
export type UpdateListingInput = z.infer<typeof UpdateListingInput>;
export const ListingQuery = Pagination.extend({
  produceId: Id.optional(),
  county: County.optional(),
  from: IsoDate.optional(),
  to: IsoDate.optional(),
  status: ListingStatus.optional(),
  mine: BoolParam.optional(),
  upcoming: BoolParam.optional(),
  /** Search produce names (English or Kiswahili) and farm names; typo tolerant. */
  q: z.string().trim().min(1).max(60).optional(),
  /** An app category tile slug (GET /v1/categories), e.g. "vegetables". */
  category: z.string().max(40).optional(),
  /** Only listings from organic farms. */
  organic: BoolParam.optional(),
  /** Default `soonest`. `nearest` measures from lat/lng, else your default address, else your organization. */
  sort: z.enum(['nearest', 'price_asc', 'price_desc', 'newest', 'soonest']).optional(),
  lat: z.coerce.number().min(-90).max(90).optional(),
  lng: z.coerce.number().min(-180).max(180).optional(),
});
export type ListingQuery = z.infer<typeof ListingQuery>;

// ─── Demand ───────────────────────────────────────────────────

export const RRule = z
  .string()
  .max(200)
  .regex(
    /^FREQ=(DAILY|WEEKLY|MONTHLY)(;[A-Z]+=[A-Z0-9,+-]+)*$/,
    'Must be an RRULE such as FREQ=WEEKLY;BYDAY=MO',
  );

export const CreateDemandInput = z.object({
  produceId: Id,
  quantity: Quantity,
  minGrade: z.string().max(8).optional(),
  maxPricePerUnit: Cents.positive().optional(),
  neededBy: IsoDate,
  recurrence: RRule.optional(),
  recurrenceUntil: IsoDate.optional(),
  county: County.optional(),
  deliveryLat: Lat.optional(),
  deliveryLng: Lng.optional(),
  notes: z.string().max(500).optional(),
});
export type CreateDemandInput = z.infer<typeof CreateDemandInput>;
export const UpdateDemandInput = CreateDemandInput.omit({ produceId: true })
  .partial()
  .extend({
    /**
     * CANCELLED ends it; PAUSED takes it out of matching and the board (a recurring requirement
     * stops spawning dates); OPEN resumes a paused one.
     */
    status: z.enum(['CANCELLED', 'PAUSED', 'OPEN']).optional(),
  });
export type UpdateDemandInput = z.infer<typeof UpdateDemandInput>;
export const DemandQuery = Pagination.extend({
  status: DemandStatus.optional(),
  produceId: Id.optional(),
  recurringOnly: BoolParam.optional(),
});
export const DemandBoardQuery = z.object({
  county: County.optional(),
  produceId: Id.optional(),
  weeks: z.coerce.number().int().min(1).max(12).default(4),
  /** Farmers: only produce you have on offer, with the listings that could fill each row. */
  mine: BoolParam.optional(),
});

// ─── Matches ──────────────────────────────────────────────────

export const MatchQuery = Pagination.extend({
  status: MatchStatus.optional(),
  demandId: Id.optional(),
  listingId: Id.optional(),
});
export const MatchOverrideInput = z.object({
  demandId: Id,
  listingId: Id,
  quantity: Quantity,
  pricePerUnit: Cents.positive().optional(),
});

// ─── Orders ───────────────────────────────────────────────────

/** Buyer orders directly from a supply listing (outside the matching flow). */
export const CreateOrderInput = z.object({
  listingId: Id,
  quantity: Quantity,
  deliveryDate: IsoDate.optional(),
  /** One of the delivery windows (GET /v1/delivery/slots), e.g. "08:00-10:00". */
  deliveryWindow: z
    .string()
    .regex(/^([01]\d|2[0-3]):[0-5]\d-([01]\d|2[0-3]):[0-5]\d$/)
    .optional(),
  deliveryAddress: z.string().max(240).optional(),
  deliveryLat: Lat.optional(),
  deliveryLng: Lng.optional(),
  notes: z.string().max(500).optional(),
});
export type CreateOrderInput = z.infer<typeof CreateOrderInput>;
export const OrderQuery = Pagination.extend({
  status: OrderStatus.optional(),
  /** `active`: ACTIVE_ORDER_STATUSES; `past`: every other status. Combines with `status`. */
  scope: z.enum(['active', 'past']).optional(),
  from: IsoDate.optional(),
  to: IsoDate.optional(),
});
export const TransitionInput = z.object({ to: OrderStatus, note: z.string().max(500).optional() });
export const CancelOrderInput = z.object({ reason: z.string().min(3).max(500) });
export const PayOrderInput = z.object({
  /** MPESA (STK push, default) or CARD (hosted checkout: open `redirectUrl`). */
  method: z.enum(['MPESA', 'CARD']).default('MPESA'),
  phoneNumber: KenyanPhone.optional(),
});
export const MessageInput = z.object({ body: z.string().min(1).max(2000), photos: Photos });

// ─── Quality assurance ────────────────────────────────────────

export const InspectionInput = z
  .object({
    orderItemId: Id,
    grade: z.string().max(8),
    passed: z.boolean(),
    acceptedQty: z.number().nonnegative(),
    rejectedQty: z.number().nonnegative().default(0),
    rejectReason: z.string().max(500).optional(),
    checklist: z.record(z.string(), z.union([z.boolean(), z.string(), z.number()])).optional(),
    notes: z.string().max(1000).optional(),
    photos: Photos,
    location: InspectionLocation.default('FARM_GATE'),
  })
  .refine((v) => v.passed || !!v.rejectReason, {
    message: 'rejectReason is required when failing',
    path: ['rejectReason'],
  });
export type InspectionInput = z.infer<typeof InspectionInput>;
export const InspectionHistoryQuery = Pagination.extend({ passed: BoolParam.optional() });
export const DriverRouteQuery = Pagination.extend({ status: RouteStatus.optional() });
export const QaTaskQuery = z.object({
  /** A county, or `all`. Omit for the officer's own county. */
  county: z.union([County, z.literal('all')]).optional(),
});

// ─── Logistics ────────────────────────────────────────────────

export const BuildRoutesInput = z.object({ date: IsoDate, county: County.optional() });
export const AssignDriverInput = z.object({ driverId: Id, vehicle: z.string().max(40).optional() });
export const CompleteStopInput = z.object({
  podPhotoKey: ObjectKey.optional(),
  signatureKey: ObjectKey.optional(),
  recipientName: z.string().max(120).optional(),
  crateQrCodes: z.array(z.string().max(64)).max(200).default([]),
  cratesCollectedQrCodes: z.array(z.string().max(64)).max(200).default([]),
});
export type CompleteStopInput = z.infer<typeof CompleteStopInput>;
export const FailStopInput = z.object({ reason: z.string().min(3).max(300) });
export const LocationPing = z.object({
  routeId: Id,
  lat: Lat,
  lng: Lng,
  heading: z.number().min(0).max(360).optional(),
  speedKph: z.number().min(0).max(250).optional(),
});
export type LocationPing = z.infer<typeof LocationPing>;
export const RouteQuery = Pagination.extend({ date: IsoDate.optional(), county: County.optional() });

// ─── Crates ───────────────────────────────────────────────────

export const CreateCratesInput = z.object({
  count: z.number().int().min(1).max(1000),
  size: z.string().max(20).default('STANDARD'),
  depositCents: Cents.default(0),
});
export const CrateAction = z.enum([
  'ISSUE_TO_FARMER',
  'LOAD',
  'DELIVER_TO_BUYER',
  'RETURN',
  'MARK_LOST',
  'RETIRE',
]);
export type CrateAction = z.infer<typeof CrateAction>;
export const ScanCrateInput = z.object({
  qrCode: z.string().min(1).max(64),
  action: CrateAction,
  orderId: Id.optional(),
  deliveryId: Id.optional(),
  toUserId: Id.optional(),
  toOrgId: Id.optional(),
  note: z.string().max(300).optional(),
});
export type ScanCrateInput = z.infer<typeof ScanCrateInput>;
export const CrateQuery = Pagination.extend({ status: CrateStatus.optional(), holderOrgId: Id.optional() });

// ─── Pricing ──────────────────────────────────────────────────

export const PriceQuery = z.object({
  produceId: Id.optional(),
  county: County.optional(),
  weeks: z.coerce.number().int().min(1).max(104).default(12),
});
export const ForecastQuery = z.object({
  produceId: Id.optional(),
  county: County.optional(),
  weeks: z.coerce.number().int().min(1).max(12).default(4),
});

// ─── Green inputs marketplace ─────────────────────────────────

export const InputProductInput = z.object({
  name: z.string().min(2).max(120),
  description: z.string().max(1000).optional(),
  category: InputCategory,
  unit: Unit,
  pricePerUnit: Cents.positive(),
  stock: z.number().nonnegative(),
  isOrganic: z.boolean().default(true),
  photos: Photos,
  county: County,
});
export const InputProductUpdate = InputProductInput.partial().extend({ active: z.boolean().optional() });
export const InputProductQuery = Pagination.extend({
  category: InputCategory.optional(),
  county: County.optional(),
  q: z.string().max(60).optional(),
  /** Suppliers: your own products, including inactive ones. */
  mine: BoolParam.optional(),
});
export const InputOrderQuery = Pagination.extend({
  /** `seller`: orders for my products; `buyer`: orders I placed. Omit for both. */
  as: z.enum(['seller', 'buyer']).optional(),
});
export const InputOrderInput = z.object({
  quantity: Quantity,
  deliveryNote: z.string().max(300).optional(),
  /** M-Pesa number to charge; defaults to the account's phone. */
  phoneNumber: KenyanPhone.optional(),
});
export const InputOrderTransitionInput = z.object({ to: InputOrderStatus });

// ─── Disputes & reviews ───────────────────────────────────────

export const RaiseDisputeInput = z.object({
  reason: DisputeReason,
  description: z.string().min(10).max(2000),
  photos: Photos,
});
export const ResolveDisputeInput = z.object({
  outcome: z.enum(['REFUND', 'NO_REFUND']),
  refundAmount: Cents.optional(),
  resolution: z.string().min(3).max(2000),
});
export const ReviewInput = z.object({
  rating: z.number().int().min(1).max(5),
  comment: z.string().max(1000).optional(),
});

// ─── Notifications ────────────────────────────────────────────

export const NotificationQuery = Pagination.extend({ unreadOnly: BoolParam.optional() });
export const MarkReadInput = z.object({ ids: z.array(Id).max(200).optional(), all: z.boolean().optional() });
export const NotificationPrefsInput = z.object({
  sms: z.boolean().optional(),
  push: z.boolean().optional(),
  email: z.boolean().optional(),
  quietFrom: z.number().int().min(0).max(23).nullable().optional(),
  quietTo: z.number().int().min(0).max(23).nullable().optional(),
});
export const RegisterDeviceInput = z.object({
  token: z.string().min(10).max(300),
  platform: z.enum(['ios', 'android', 'web']),
});

// ─── Uploads ──────────────────────────────────────────────────

export const UPLOAD_BUCKETS = [
  'produce-photos',
  'qa-evidence',
  'proof-of-delivery',
  'kyc',
  'chat',
  'avatars',
] as const;
export const UploadBucket = z.enum(UPLOAD_BUCKETS);
export type UploadBucket = z.infer<typeof UploadBucket>;
export const PresignInput = z.object({
  bucket: UploadBucket,
  contentType: z.enum(['image/jpeg', 'image/png', 'image/webp', 'application/pdf']),
  size: z
    .number()
    .int()
    .positive()
    .max(10 * 1024 * 1024),
});
export const PresignGetInput = z.object({ key: ObjectKey });

// ─── Admin ────────────────────────────────────────────────────

export const PayoutQuery = Pagination.extend({
  /** `supplier`: payouts for your green-input sales (default: your farmer payouts). */
  as: z.enum(['farmer', 'supplier']).optional(),
});

export const EarningsQuery = z.object({
  months: z.coerce.number().int().min(1).max(24).default(6),
  /** `supplier`: green-input sales (default: farmer sales). */
  as: z.enum(['farmer', 'supplier']).optional(),
});

/** Cross-organization money lists (admin). */
export const AdminMoneyQuery = Pagination.extend({
  status: z.string().max(20).optional(),
  orgId: Id.optional(),
  from: IsoDate.optional(),
  to: IsoDate.optional(),
});

export const AdminUserQuery = Pagination.extend({
  role: PlatformRole.optional(),
  q: z.string().max(80).optional(),
  county: County.optional(),
});
export const SetRoleInput = z.object({ role: PlatformRole });
export const KycReviewInput = z.object({
  status: KycStatus.extract(['VERIFIED', 'REJECTED']),
  note: z.string().max(300).optional(),
});
export const VerifyOrgInput = z.object({
  verified: z.boolean(),
  paymentTerms: PaymentTerms.optional(),
  creditLimit: Cents.optional(),
});
export const SettingInput = z.object({ value: z.unknown() });
export const ReportQuery = z.object({
  from: IsoDate.optional(),
  to: IsoDate.optional(),
  county: County.optional(),
});
export const AuditQuery = Pagination.extend({
  cursor: z
    .string()
    .regex(/^\d{1,19}$/, 'cursor must be a number')
    .optional(),
  entity: z.string().max(40).optional(),
  entityId: Id.optional(),
});

export const GeoQuery = GeoPoint.extend({ radiusKm: z.coerce.number().positive().max(500).default(50) });
