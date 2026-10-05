import { z } from 'zod';
import { DELIVERY_WINDOW_PATTERN } from '../checkout.js';
import { page } from '../common.js';
import { KycStatus } from '../enums.js';
import { PlatformRole } from '../roles.js';
import {
  AuditLogDto,
  DisputeDto,
  FarmDto,
  FarmerProfileDto,
  InvoiceDto,
  MemberDto,
  OrganizationDto,
  OrgProfileDto,
  PaymentDto,
  PayoutDto,
  UserDto,
} from './models.js';
import { count, IsoDateTime, NullableString } from './primitives.js';

// ─── Dashboards & reports ─────────────────────────────────────

/** GET /v1/admin/summary */
export const OpsSummaryDto = z.object({
  ordersByStatus: z.record(z.string(), z.number().int()),
  openDisputes: z.number().int(),
  failedPayouts: z.number().int(),
  pendingPayments: z.number().int(),
  openDemand: z.number().int(),
  openListings: z.number().int(),
  pendingKyc: z.number().int(),
});
export type OpsSummaryDto = z.infer<typeof OpsSummaryDto>;

/** GET /v1/admin/reports/impact */
export const ImpactReportDto = z.object({
  range: z.object({ from: IsoDateTime, to: IsoDateTime, county: NullableString }),
  farmers: z.object({
    total: z.number().int(),
    newInRange: z.number().int(),
    youthPct: z.number(),
    womenPct: z.number(),
  }),
  trade: z.object({
    orders: z.number().int(),
    activeBuyers: z.number().int(),
    kgTraded: z.number(),
    grossValueCents: z.number(),
    /** Produce sold before it was harvested: a proxy for food loss avoided. */
    preHarvestMatchedKg: z.number(),
    preHarvestMatchedPct: z.number(),
  }),
  farmerIncome: z.object({ paidOutCents: z.number(), farmersPaid: z.number().int() }),
  quality: z.object({ inspected: z.number().int(), passRatePct: z.number() }),
  packaging: z.object({
    activeCrates: z.number().int(),
    crateTrips: z.number().int(),
    crateReturns: z.number().int(),
    returnRatePct: z.number(),
    lost: z.number().int(),
  }),
  logistics: z.object({ routes: z.number().int(), stops: z.number().int(), distanceKm: z.number() }),
  youthJobs: z.object({
    agents: z.number().int(),
    qaOfficers: z.number().int(),
    drivers: z.number().int(),
    admins: z.number().int(),
  }),
});
export type ImpactReportDto = z.infer<typeof ImpactReportDto>;

// ─── Users ────────────────────────────────────────────────────

/** GET /v1/admin/users items */
export const AdminUserListItemDto = z.object({
  id: z.string(),
  name: z.string(),
  email: z.string(),
  phoneNumber: NullableString,
  role: PlatformRole.nullable(),
  county: NullableString,
  banned: z.boolean().nullable(),
  createdAt: IsoDateTime,
  farmerProfile: z
    .object({ id: z.string(), kycStatus: KycStatus, ordersCompleted: z.number().int() })
    .nullable(),
});
export type AdminUserListItemDto = z.infer<typeof AdminUserListItemDto>;

export const AdminUserPageDto = page(AdminUserListItemDto);

/** GET /v1/admin/users/:id */
export const AdminUserDetailDto = UserDto.extend({
  farmerProfile: FarmerProfileDto.extend({ farms: z.array(FarmDto) }).nullable(),
  members: z.array(
    MemberDto.extend({ organization: OrganizationDto.extend({ profile: OrgProfileDto.nullable() }) }),
  ),
  sessions: z.array(
    z.object({
      id: z.string(),
      createdAt: IsoDateTime,
      expiresAt: IsoDateTime,
      ipAddress: NullableString,
      userAgent: NullableString,
    }),
  ),
});
export type AdminUserDetailDto = z.infer<typeof AdminUserDetailDto>;

/** POST /v1/admin/users/:id/role */
export const RoleSetDto = z.object({ id: z.string(), role: PlatformRole.nullable() });
export type RoleSetDto = z.infer<typeof RoleSetDto>;

/** POST /v1/admin/users/:id/ban */
export const BanSetDto = z.object({ id: z.string(), banned: z.boolean().nullable() });
export type BanSetDto = z.infer<typeof BanSetDto>;

/** GET /v1/admin/kyc items */
export const KycListItemDto = FarmerProfileDto.extend({
  user: z.object({ id: z.string(), name: z.string(), phoneNumber: NullableString, county: NullableString }),
});
export type KycListItemDto = z.infer<typeof KycListItemDto>;

export const KycPageDto = page(KycListItemDto);

// ─── Organizations ────────────────────────────────────────────

/** GET /v1/admin/orgs items */
export const AdminOrgListItemDto = OrganizationDto.extend({
  profile: OrgProfileDto.nullable(),
  _count: count('members', 'orders'),
});
export type AdminOrgListItemDto = z.infer<typeof AdminOrgListItemDto>;

export const AdminOrgPageDto = page(AdminOrgListItemDto);

// ─── Disputes & money ─────────────────────────────────────────

/** GET /v1/admin/disputes items */
export const AdminDisputeListItemDto = DisputeDto.extend({
  /** Null for a problem on a green-input order (see inputOrder). */
  order: z
    .object({
      id: z.string(),
      code: z.string(),
      total: z.number().int(),
      buyerOrg: z.object({ name: z.string() }),
    })
    .nullable(),
  inputOrder: z
    .object({ id: z.string(), total: z.number().int(), product: z.object({ name: z.string() }) })
    .nullable(),
  raisedBy: z.object({ name: z.string() }),
});
export type AdminDisputeListItemDto = z.infer<typeof AdminDisputeListItemDto>;

export const AdminDisputePageDto = page(AdminDisputeListItemDto);

/** GET /v1/admin/payouts items */
export const AdminPayoutListItemDto = PayoutDto.extend({
  /** Null for a green-input supplier payout. */
  order: z.object({ code: z.string() }).nullable(),
  farmer: z.object({ name: z.string(), phoneNumber: NullableString }),
});
export type AdminPayoutListItemDto = z.infer<typeof AdminPayoutListItemDto>;

export const AdminPayoutPageDto = page(AdminPayoutListItemDto);

// ─── Settings, audit, jobs ────────────────────────────────────

export const MatchWeightsDto = z.object({
  distance: z.number().min(0).max(1),
  price: z.number().min(0).max(1),
  reliability: z.number().min(0).max(1),
  freshness: z.number().min(0).max(1),
  inclusion: z.number().min(0).max(1),
});

/**
 * Runtime business settings (GET /v1/admin/settings). Also the validation for
 * PUT /v1/admin/settings/:key so a bad value can never be stored.
 */
export const SettingsDto = z.object({
  /** Commission taken from the farmer's payout, in basis points (800 = 8%). */
  commissionBps: z.number().int().min(0).max(10_000),
  /** Flat delivery fee charged to the buyer per order, in cents. */
  deliveryFeeCents: z.number().int().min(0),
  matchRadiusKm: z.number().positive(),
  matchExpiryHours: z.number().positive(),
  prefinanceInvoiceOrders: z.boolean(),
  disputeWindowHours: z.number().min(0),
  crateDepositCents: z.number().int().min(0),
  crateReturnDays: z.number().int().min(0),
  stkCheckDelaySeconds: z.number().int().min(0),
  recurringHorizonDays: z.number().int().min(1),
  matchWeights: MatchWeightsDto,
  /** Delivery windows buyers can choose, e.g. "06:00-08:00" (Africa/Nairobi). */
  deliveryWindows: z.array(z.string().regex(DELIVERY_WINDOW_PATTERN)).min(1),
  /** Orders placed before this hour (Nairobi) can be delivered the next day. */
  nextDayCutoffHour: z.number().int().min(0).max(23),
  /** Supplier products at or below this stock count as low stock. */
  lowStockThreshold: z.number().min(0),
});
export type SettingsDto = z.infer<typeof SettingsDto>;

export const AuditPageDto = page(AuditLogDto);
export type AuditPageDto = z.infer<typeof AuditPageDto>;

/** POST /v1/admin/jobs/:name/run (202) */
export const JobQueuedDto = z.object({ queued: z.string(), available: z.array(z.string()) });
export type JobQueuedDto = z.infer<typeof JobQueuedDto>;

// ─── B28: admin detail and cross-organization money lists ─────

/** GET /v1/admin/orgs/:id */
export const AdminOrgDetailDto = OrganizationDto.extend({
  profile: OrgProfileDto.nullable(),
  members: z.array(
    MemberDto.extend({
      user: z.object({
        id: z.string(),
        name: z.string(),
        email: z.string(),
        phoneNumber: NullableString,
        role: PlatformRole.nullable(),
      }),
    }),
  ),
  stats: z.object({
    ordersTotal: z.number().int(),
    ordersOpen: z.number().int(),
    demandOpen: z.number().int(),
    /** Buyer orgs: what they have spent (order totals, excluding cancelled and rejected). */
    spendCents: z.number().int(),
    invoicesDueCents: z.number().int(),
    /** Supplier orgs: active products and green-input orders received. */
    productsActive: z.number().int(),
    inputOrdersTotal: z.number().int(),
  }),
});
export type AdminOrgDetailDto = z.infer<typeof AdminOrgDetailDto>;

/** GET /v1/admin/disputes/:id */
export const AdminDisputeDetailDto = DisputeDto.extend({
  order: z
    .object({
      id: z.string(),
      code: z.string(),
      status: z.string(),
      total: z.number().int(),
      paymentStatus: z.string(),
      buyerOrg: z.object({ id: z.string(), name: z.string() }),
      farmer: z.object({ id: z.string(), name: z.string() }),
    })
    .nullable(),
  inputOrder: z
    .object({
      id: z.string(),
      status: z.string(),
      total: z.number().int(),
      paymentStatus: z.string(),
      product: z.object({ name: z.string(), supplierOrg: z.object({ id: z.string(), name: z.string() }) }),
      buyer: z.object({ id: z.string(), name: z.string() }),
    })
    .nullable(),
  raisedBy: z.object({ id: z.string(), name: z.string() }),
  resolvedBy: z.object({ id: z.string(), name: z.string() }).nullable(),
});
export type AdminDisputeDetailDto = z.infer<typeof AdminDisputeDetailDto>;

export const AdminPaymentItemDto = PaymentDto.extend({
  /** Who paid: the buyer organization, or the farmer who bought green inputs. */
  payer: z.object({ id: z.string(), name: z.string(), kind: z.enum(['org', 'user']) }).nullable(),
  reference: NullableString,
});
/** GET /v1/admin/payments */
export const AdminPaymentPageDto = page(AdminPaymentItemDto).extend({
  totals: z.object({
    collectedCents: z.number().int(),
    refundedCents: z.number().int(),
    pendingCents: z.number().int(),
    count: z.number().int(),
  }),
});
export type AdminPaymentPageDto = z.infer<typeof AdminPaymentPageDto>;

/** GET /v1/admin/invoices */
export const AdminInvoicePageDto = page(
  InvoiceDto.extend({ buyerOrg: z.object({ id: z.string(), name: z.string() }), _count: count('orders') }),
).extend({
  totals: z.object({
    totalCents: z.number().int(),
    paidCents: z.number().int(),
    dueCents: z.number().int(),
    count: z.number().int(),
  }),
});
export type AdminInvoicePageDto = z.infer<typeof AdminInvoicePageDto>;
