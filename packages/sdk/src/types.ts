/**
 * Response types of the FarmGo Connect API, inferred from the response DTO schemas in
 * `@farmgo/contracts` (packages/contracts/src/dto). The API validates every response against
 * the same schemas, so these types cannot drift from the JSON the app receives.
 *
 * Conventions: dates are ISO strings, Prisma Decimals are numbers, BigInts are strings, money is
 * integer KES cents, paginated lists are `{ items, nextCursor }`.
 *
 * The SDK keeps its own short names (`Order`, `OrderDetail`, ...) as aliases so screens read
 * naturally; the `XxxDto` names are also exported from `@farmgo/contracts` directly.
 */
import type {
  AdminDisputeListItemDto,
  AdminOrgListItemDto,
  AdminPayoutListItemDto,
  AdminUserDetailDto,
  AdminUserListItemDto,
  AgentFarmerCreatedDto,
  AgentFarmerDto,
  AuditLogDto,
  BanSetDto,
  CrateDetailDto,
  CrateDto,
  CrateMovementDto,
  CratePageDto,
  CratesCreatedDto,
  CurrentOrgDto,
  DemandBoardRowDto,
  DemandDetailDto,
  DemandDto,
  DemandForecastDto,
  DemandListItemDto,
  DemandWithProduceDto,
  DeviceTokenDto,
  DisputeDto,
  DriverLocationDto,
  FarmDetailDto,
  FarmDto,
  FarmerProfileDto,
  FarmerProfileWithFarmsDto,
  FileUrlDto,
  ForecastDto,
  HarvestReadyDto,
  HealthCheckDto,
  HealthLiveDto,
  HealthReadyDto,
  ImpactReportDto,
  InputOrderCreatedDto,
  InputOrderDto,
  InputOrderListItemDto,
  InputProductDto,
  InputProductListItemDto,
  InspectionDetailDto,
  InspectionDto,
  InspectionResultDto,
  InvoiceDetailDto,
  InvoiceDto,
  InvoiceListItemDto,
  JobQueuedDto,
  KycListItemDto,
  LatestPriceDto,
  ListingDto,
  ListingFarmerDto,
  LocationAcceptedDto,
  MarkReadDto,
  MatchAcceptDto,
  MatchDto,
  MatchListItemDto,
  MeDto,
  MemberDto,
  MessageDto,
  MeUpdatedDto,
  NotificationDto,
  NotificationPageDto,
  NotificationPrefsDto,
  Ok as OkSchema,
  OnboardedOrgDto,
  OpsSummaryDto,
  OrderDetailDto,
  OrderDto,
  OrderEventDto,
  OrderItemDto,
  OrderListItemDto,
  OrderMessageDto,
  OrderViewer as OrderViewerSchema,
  OrganizationDto,
  OrgProfileDto,
  OrgRef as OrgRefSchema,
  OwnListingDto,
  PaymentDetailDto,
  PaymentDto,
  PaymentListItemDto,
  PaymentStartedDto,
  PayoutDto,
  PayoutListItemDto,
  PayoutPageDto,
  PresignDto,
  PriceDto,
  PricePointDto,
  ProduceDto,
  QaTaskDto,
  ReviewDto,
  RoleSetDto,
  RouteDetailDto,
  RouteDto,
  RouteListItemDto,
  RouteStopDto,
  RoutesBuiltDto,
  RouteWithStopsDto,
  SettingsDto,
  StopDto,
  SupplyListingDto,
  TrackingDto,
  UserDto,
  UserRef as UserRefSchema,
} from '@farmgo/contracts';
import type { z } from 'zod';

type Of<S extends z.ZodTypeAny> = z.infer<S>;

/** ISO 8601 date-time string, e.g. `2026-09-26T08:00:00.000Z`. */
export type IsoDateTime = string;
/** Money in KES cents. KES 150.00 = 15000. */
export type Cents = number;
export type Json = unknown;

/** Cursor page, the shape `page()` in contracts produces. */
export interface Page<T> {
  items: T[];
  nextCursor: string | null;
}

// ─── Base models ──────────────────────────────────────────────

export type UserRef = Of<typeof UserRefSchema>;
export type OrgRef = Of<typeof OrgRefSchema>;
export type User = Of<typeof UserDto>;
export type Produce = Of<typeof ProduceDto>;
export type ProduceRef = Pick<Produce, 'id' | 'name' | 'nameSw' | 'unit'>;
export type Farm = Of<typeof FarmDto>;
export type FarmerProfile = Of<typeof FarmerProfileDto>;
export type Organization = Of<typeof OrganizationDto>;
export type OrgProfile = Of<typeof OrgProfileDto>;
export type Member = Of<typeof MemberDto>;
export type SupplyListing = Of<typeof SupplyListingDto>;
export type DemandRequest = Of<typeof DemandDto>;
export type Match = Of<typeof MatchDto>;
export type Order = Of<typeof OrderDto>;
export type OrderItem = Of<typeof OrderItemDto>;
export type OrderEvent = Of<typeof OrderEventDto>;
export type OrderMessage = Of<typeof OrderMessageDto>;
export type QualityInspection = Of<typeof InspectionDto>;
export type Route = Of<typeof RouteDto>;
/** A pickup or drop-off on a route (Prisma model `Delivery`). */
export type Stop = Of<typeof StopDto>;
export type DriverLocation = Of<typeof DriverLocationDto>;
export type Crate = Of<typeof CrateDto>;
export type CrateMovement = Of<typeof CrateMovementDto>;
export type Payment = Of<typeof PaymentDto>;
export type Payout = Of<typeof PayoutDto>;
export type Invoice = Of<typeof InvoiceDto>;
export type Dispute = Of<typeof DisputeDto>;
export type Review = Of<typeof ReviewDto>;
export type PricePoint = Of<typeof PricePointDto>;
export type DemandForecast = Of<typeof DemandForecastDto>;
export type InputProduct = Of<typeof InputProductDto>;
export type InputOrder = Of<typeof InputOrderDto>;
export type Notification = Of<typeof NotificationDto>;
export type NotificationPreference = Of<typeof NotificationPrefsDto>;
export type DeviceToken = Of<typeof DeviceTokenDto>;
export type AuditLog = Of<typeof AuditLogDto>;
export type Ok = Of<typeof OkSchema>;

// ─── Health ───────────────────────────────────────────────────

export type HealthLive = Of<typeof HealthLiveDto>;
export type HealthCheck = Of<typeof HealthCheckDto>;
export type HealthReady = Of<typeof HealthReadyDto>;

// ─── Auth (Better Auth, /api/auth/*; not part of the API's DTOs) ──

export interface AuthUser {
  id: string;
  name: string;
  email: string;
  emailVerified: boolean;
  image: string | null;
  phoneNumber?: string | null;
  phoneNumberVerified?: boolean | null;
  role?: string | null;
  createdAt: IsoDateTime;
  updatedAt: IsoDateTime;
}
/** Bearer token plus the user. Store `token` and hand it to `createApi({ getToken })`. */
export interface AuthSession {
  token: string;
  user: AuthUser;
}
export interface SessionInfo {
  session: {
    id: string;
    token: string;
    userId: string;
    expiresAt: IsoDateTime;
    activeOrganizationId?: string | null;
  };
  user: AuthUser;
}

// ─── Me, onboarding, organizations ────────────────────────────

export type Me = Of<typeof MeDto>;
export type MeUser = Me['user'];
export type MeOrganization = Me['organizations'][number];
export type FarmerProfileWithFarms = Of<typeof FarmerProfileWithFarmsDto>;
export type UpdateMeResult = Of<typeof MeUpdatedDto>;
export type OnboardFarmerResult = FarmerProfile;
export type OnboardOrgResult = Of<typeof OnboardedOrgDto>;
export type AgentCreateFarmerResult = Of<typeof AgentFarmerCreatedDto>;
export type AgentFarmer = Of<typeof AgentFarmerDto>;
export type CurrentOrg = Of<typeof CurrentOrgDto>;

// ─── Uploads ──────────────────────────────────────────────────

export type PresignResult = Of<typeof PresignDto>;
export type FileUrlResult = Of<typeof FileUrlDto>;

// ─── Farms, catalog ───────────────────────────────────────────

export type FarmDetail = Of<typeof FarmDetailDto>;

// ─── Supply ───────────────────────────────────────────────────

export type ListingFarmerPublic = Of<typeof ListingFarmerDto>;
/** Buyer-facing listing (GET /v1/supply and /v1/supply/:id). */
export type ListingPublic = Of<typeof ListingDto>;
/** What `supply.create` and `supply.update` return. */
export type ListingOwn = Of<typeof OwnListingDto>;
export type HarvestReadyResult = Of<typeof HarvestReadyDto>;

// ─── Demand ───────────────────────────────────────────────────

export type DemandListItem = Of<typeof DemandListItemDto>;
export type DemandCreated = Of<typeof DemandWithProduceDto>;
export type DemandDetail = Of<typeof DemandDetailDto>;
export type DemandBoardRow = Of<typeof DemandBoardRowDto>;

// ─── Matches ──────────────────────────────────────────────────

export type MatchListItem = Of<typeof MatchListItemDto>;
export type AcceptMatchResult = Of<typeof MatchAcceptDto>;

// ─── Orders ───────────────────────────────────────────────────

export type OrderViewer = Of<typeof OrderViewerSchema>;
export type OrderListItem = Of<typeof OrderListItemDto>;
export type OrderDetail = Of<typeof OrderDetailDto>;
export type PayResult = Of<typeof PaymentStartedDto>;
export type OrderMessageItem = Of<typeof MessageDto>;
export type TrackingResult = Of<typeof TrackingDto>;

// ─── Quality assurance ────────────────────────────────────────

export type QaTask = Of<typeof QaTaskDto>;
export type InspectionResult = Of<typeof InspectionResultDto>;
export type InspectionDetail = Of<typeof InspectionDetailDto>;

// ─── Logistics ────────────────────────────────────────────────

export type RouteListItem = Of<typeof RouteListItemDto>;
export type BuildRoutesResult = Of<typeof RoutesBuiltDto>;
export type RouteStop = Of<typeof RouteStopDto>;
export type RouteWithStops = Of<typeof RouteWithStopsDto>;
export type RouteDetail = Of<typeof RouteDetailDto>;
export type LocationResult = Of<typeof LocationAcceptedDto>;

// ─── Crates ───────────────────────────────────────────────────

export type CratesCreated = Of<typeof CratesCreatedDto>;
export type CratesPage = Of<typeof CratePageDto>;
export type CrateDetail = Of<typeof CrateDetailDto>;

// ─── Payments ─────────────────────────────────────────────────

export type PaymentListItem = Of<typeof PaymentListItemDto>;
export type PaymentDetail = Of<typeof PaymentDetailDto>;
export type InvoiceListItem = Of<typeof InvoiceListItemDto>;
export type InvoiceDetail = Of<typeof InvoiceDetailDto>;
export type PayoutListItem = Of<typeof PayoutListItemDto>;
export type PayoutsPage = Of<typeof PayoutPageDto>;

// ─── Pricing ──────────────────────────────────────────────────

export type PricePointItem = Of<typeof PriceDto>;
export type LatestPrice = Of<typeof LatestPriceDto>;
export type ForecastItem = Of<typeof ForecastDto>;

// ─── Green inputs ─────────────────────────────────────────────

export type InputProductItem = Of<typeof InputProductListItemDto>;
export type InputOrderCreated = Of<typeof InputOrderCreatedDto>;
export type InputOrderListItem = Of<typeof InputOrderListItemDto>;

// ─── Notifications ────────────────────────────────────────────

export type NotificationsPage = Of<typeof NotificationPageDto>;
export type MarkReadResult = Of<typeof MarkReadDto>;

// ─── Admin ────────────────────────────────────────────────────

export type OpsSummary = Of<typeof OpsSummaryDto>;
export type ImpactReport = Of<typeof ImpactReportDto>;
export type AdminUserListItem = Of<typeof AdminUserListItemDto>;
export type AdminUserDetail = Of<typeof AdminUserDetailDto>;
export type SetRoleResult = Of<typeof RoleSetDto>;
export type BanResult = Of<typeof BanSetDto>;
export type KycPending = Of<typeof KycListItemDto>;
export type AdminOrgItem = Of<typeof AdminOrgListItemDto>;
export type DisputeListItem = Of<typeof AdminDisputeListItemDto>;
/** POST /v1/admin/disputes/:id/resolve returns the resolved dispute. */
export type ResolveDisputeResult = Dispute;
export type AdminPayoutItem = Of<typeof AdminPayoutListItemDto>;
export type PlatformSettings = Of<typeof SettingsDto>;
export type JobRunResult = Of<typeof JobQueuedDto>;
