import type {
  AdminDisputeDetailDto,
  AdminDisputeListItemDto,
  AdminDisputePageDto,
  AdminInvoicePageDto,
  AdminOrgDetailDto,
  AdminOrgListItemDto,
  AdminOrgPageDto,
  AdminPaymentPageDto,
  AdminPayoutPageDto,
  AdminUserDetailDto,
  AdminUserPageDto,
  AuditPageDto,
  BanSetDto,
  CrateDetailDto,
  CratePageDto,
  CratesCreatedDto,
  DisputeDto,
  FarmerProfileDto,
  FileUrlDto,
  ImpactReportDto,
  JobQueuedDto,
  KycPageDto,
  OpsSummaryDto,
  OrderDetailDto,
  OrderPageDto,
  OrgProfileDto,
  PaymentDto,
  PayoutDto,
  ProduceDto,
  RoleSetDto,
  RouteDetailDto,
  RouteDto,
  RoutePageDto,
  RoutesBuiltDto,
  SettingsDto,
} from '@farmgo/contracts';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, type Query } from '../../lib/api';

type Z<T> = T extends { _output: infer O } ? O : never;
export type OpsSummary = Z<typeof OpsSummaryDto>;
export type ImpactReport = Z<typeof ImpactReportDto>;
export type AdminUserPage = Z<typeof AdminUserPageDto>;
export type AdminUserRow = AdminUserPage['items'][number];
export type AdminUserDetail = Z<typeof AdminUserDetailDto>;
export type KycPage = Z<typeof KycPageDto>;
export type KycRow = KycPage['items'][number];
export type AdminOrgPage = Z<typeof AdminOrgPageDto>;
export type AdminOrgRow = Z<typeof AdminOrgListItemDto>;
export type AdminDisputePage = Z<typeof AdminDisputePageDto>;
export type AdminDisputeRow = Z<typeof AdminDisputeListItemDto>;
export type AdminDisputeDetail = Z<typeof AdminDisputeDetailDto>;
export type AdminOrgDetail = Z<typeof AdminOrgDetailDto>;
export type AdminPaymentPage = Z<typeof AdminPaymentPageDto>;
export type AdminPaymentRow = AdminPaymentPage['items'][number];
export type AdminInvoicePage = Z<typeof AdminInvoicePageDto>;
export type AdminInvoiceRow = AdminInvoicePage['items'][number];

/**
 * What a dispute is about: a produce order (code and buyer) or a green-input order (product
 * name and the farmer who bought it). Works for list rows and the detail.
 */
export function disputeSubject(d: AdminDisputeRow | AdminDisputeDetail): {
  kind: 'order' | 'input';
  code: string;
  party: string;
  total: number;
} {
  if (d.order)
    return { kind: 'order', code: d.order.code, party: d.order.buyerOrg.name, total: d.order.total };
  const io = d.inputOrder;
  const buyer = io && 'buyer' in io ? io.buyer.name : d.raisedBy.name;
  return { kind: 'input', code: io?.product.name ?? '', party: buyer, total: io?.total ?? 0 };
}
export type AdminPayoutPage = Z<typeof AdminPayoutPageDto>;
export type AdminPayoutRow = AdminPayoutPage['items'][number];
export type RoutePage = Z<typeof RoutePageDto>;
export type RouteRow = RoutePage['items'][number];
export type RouteDetail = Z<typeof RouteDetailDto>;
export type CratePage = Z<typeof CratePageDto>;
export type CrateRow = CratePage['items'][number];
export type CrateDetail = Z<typeof CrateDetailDto>;
export type Produce = Z<typeof ProduceDto>;
export type Settings = Z<typeof SettingsDto>;
export type AuditPage = Z<typeof AuditPageDto>;
export type AuditRow = AuditPage['items'][number];
export type OrderPage = Z<typeof OrderPageDto>;
export type OrderRow = OrderPage['items'][number];
export type OrderDetail = Z<typeof OrderDetailDto>;

/** Query keys start with the resource so realtime invalidation in data/realtime.ts reaches them. */
export const adminKeys = {
  summary: ['dashboard', 'admin', 'summary'] as const,
  impact: (range: ImpactRange) => ['dashboard', 'admin', 'impact', range] as const,
  users: (f: UserFilters) => ['adminUsers', f] as const,
  user: (id: string) => ['adminUser', id] as const,
  kyc: ['adminKyc'] as const,
  orgs: ['adminOrgs'] as const,
  disputes: (open: boolean) => ['disputes', { open }] as const,
  payouts: (status?: string) => ['payouts', 'admin', { status: status ?? 'all' }] as const,
  routes: (f: RouteFilters) => ['routes', 'admin', f] as const,
  route: (id: string) => ['routes', id] as const,
  crates: (status?: string) => ['crates', { status: status ?? 'all' }] as const,
  crate: (qr: string) => ['crates', 'one', qr] as const,
  produce: ['produce', 'admin'] as const,
  settings: ['adminSettings'] as const,
  audit: (f: AuditFilters) => ['adminAudit', f] as const,
  orders: (f: OrderFilters) => ['orders', 'admin', f] as const,
  drivers: ['adminUsers', { role: 'driver', limit: 100 }] as const,
  fileUrl: (key: string) => ['fileUrl', key] as const,
};

const PAGE = 25;

function pageQuery<T extends { nextCursor: string | null }>(
  key: readonly unknown[],
  path: string,
  query: Query,
  enabled = true,
) {
  return {
    queryKey: key,
    enabled,
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam, signal }: { pageParam: string | undefined; signal: AbortSignal }) =>
      api.get<T>(path, { ...query, cursor: pageParam, limit: PAGE }, signal),
    getNextPageParam: (last: T) => last.nextCursor ?? undefined,
  };
}

// ─── Overview ─────────────────────────────────────────────────

export function useOpsSummary() {
  return useQuery({
    queryKey: adminKeys.summary,
    queryFn: () => api.get<OpsSummary>('/v1/admin/summary'),
    refetchInterval: 60_000,
  });
}

export type ImpactRange = {
  from?: string;
  to?: string;
  county?: string;
};

export function useImpactReport(range: ImpactRange) {
  return useQuery({
    queryKey: adminKeys.impact(range),
    queryFn: () =>
      api.get<ImpactReport>('/v1/admin/reports/impact', {
        from: range.from,
        to: range.to,
        county: range.county,
      }),
  });
}

// ─── People ───────────────────────────────────────────────────

export type UserFilters = {
  q?: string;
  role?: string;
  county?: string;
};

export function useAdminUsers(filters: UserFilters) {
  return useInfiniteQuery(pageQuery<AdminUserPage>(adminKeys.users(filters), '/v1/admin/users', filters));
}

export function useAdminUser(id: string | undefined) {
  return useQuery({
    queryKey: adminKeys.user(id ?? ''),
    enabled: !!id,
    queryFn: () => api.get<AdminUserDetail>(`/v1/admin/users/${id}`),
  });
}

export function useKycQueue() {
  return useInfiniteQuery(pageQuery<KycPage>(adminKeys.kyc, '/v1/admin/kyc', {}));
}

export function useAdminOrgs() {
  return useInfiniteQuery(pageQuery<AdminOrgPage>(adminKeys.orgs, '/v1/admin/orgs', {}));
}

/** GET /v1/admin/orgs/:id (B28): profile, members and activity stats. */
export function useAdminOrg(id: string | undefined) {
  return useQuery({
    queryKey: ['adminOrg', id],
    enabled: !!id,
    queryFn: () => api.get<AdminOrgDetail>(`/v1/admin/orgs/${id}`),
  });
}

/** Drivers for the assign sheet. */
export function useDrivers(q?: string) {
  return useQuery({
    queryKey: [...adminKeys.drivers, q ?? ''],
    queryFn: () =>
      api.get<AdminUserPage>('/v1/admin/users', { role: 'driver', q: q || undefined, limit: 100 }),
  });
}

/** Short-lived URL for a private file (KYC ID scans, proof of delivery). */
export function useFileUrl(key: string | null | undefined) {
  return useQuery({
    queryKey: adminKeys.fileUrl(key ?? ''),
    enabled: !!key,
    staleTime: 10 * 60_000,
    queryFn: () => api.post<Z<typeof FileUrlDto>>('/v1/uploads/url', { key }),
  });
}

// ─── Money ────────────────────────────────────────────────────

export function useAdminDisputes(open: boolean) {
  return useInfiniteQuery(
    pageQuery<AdminDisputePage>(adminKeys.disputes(open), '/v1/admin/disputes', { open: open || undefined }),
  );
}

/** GET /v1/admin/disputes/:id (B28), for produce and green-input disputes alike. */
export function useAdminDispute(id: string | undefined) {
  return useQuery({
    queryKey: ['dispute', id],
    enabled: !!id,
    queryFn: () => api.get<AdminDisputeDetail>(`/v1/admin/disputes/${id}`),
  });
}

export function useOrderDetail(id: string | undefined) {
  return useQuery({
    queryKey: ['order', id],
    enabled: !!id,
    queryFn: () => api.get<OrderDetail>(`/v1/orders/${id}`),
  });
}

export type MoneyFilters = { status?: string; orgId?: string; from?: string; to?: string };

/** GET /v1/admin/payments (B28): every organization's payments with totals for the filter. */
export function useAdminPayments(filters: MoneyFilters) {
  return useInfiniteQuery(
    pageQuery<AdminPaymentPage>(['payments', 'admin', filters], '/v1/admin/payments', filters),
  );
}

/** GET /v1/admin/invoices (B28): every buyer's invoices with totals for the filter. */
export function useAdminInvoices(filters: MoneyFilters) {
  return useInfiniteQuery(
    pageQuery<AdminInvoicePage>(['invoices', 'admin', filters], '/v1/admin/invoices', filters),
  );
}

export function useAdminPayouts(status?: 'PENDING' | 'SUCCESS' | 'FAILED') {
  return useInfiniteQuery(
    pageQuery<AdminPayoutPage>(adminKeys.payouts(status), '/v1/admin/payouts', { status }),
  );
}

// ─── Orders (table the Lead mounts) ───────────────────────────

export type OrderFilters = {
  status?: string;
  from?: string;
  to?: string;
};

export function useAdminOrders(filters: OrderFilters) {
  return useInfiniteQuery(pageQuery<OrderPage>(adminKeys.orders(filters), '/v1/orders', filters));
}

// ─── Logistics ────────────────────────────────────────────────

export type RouteFilters = {
  date?: string;
  county?: string;
};

export function useAdminRoutes(filters: RouteFilters) {
  return useInfiniteQuery(pageQuery<RoutePage>(adminKeys.routes(filters), '/v1/routes', filters));
}

export function useRoute(id: string | undefined) {
  return useQuery({
    queryKey: adminKeys.route(id ?? ''),
    enabled: !!id,
    queryFn: () => api.get<RouteDetail>(`/v1/routes/${id}`),
  });
}

export function useCrates(status?: string) {
  return useInfiniteQuery(pageQuery<CratePage>(adminKeys.crates(status), '/v1/crates', { status }));
}

export function useCrate(qrCode: string | undefined) {
  return useQuery({
    queryKey: adminKeys.crate(qrCode ?? ''),
    enabled: !!qrCode,
    queryFn: () => api.get<CrateDetail>(`/v1/crates/${encodeURIComponent(qrCode ?? '')}`),
  });
}

// ─── Catalog, settings, audit ─────────────────────────────────

export function useCatalog(q?: string, category?: string) {
  return useQuery({
    queryKey: [...adminKeys.produce, { q: q ?? '', category: category ?? '' }],
    queryFn: () => api.get<Produce[]>('/v1/produce', { q: q || undefined, category: category || undefined }),
  });
}

export function useSettings() {
  return useQuery({ queryKey: adminKeys.settings, queryFn: () => api.get<Settings>('/v1/admin/settings') });
}

export type AuditFilters = {
  entity?: string;
  entityId?: string;
};

export function useAuditLog(filters: AuditFilters) {
  return useInfiniteQuery(pageQuery<AuditPage>(adminKeys.audit(filters), '/v1/admin/audit', filters));
}

/** Jobs an admin may run now (mirrors RUNNABLE_JOBS in the API; the response confirms the list). */
export const RUNNABLE_JOBS = [
  'expand-recurring',
  'aggregate-weekly',
  'expire-demand',
  'expire-matches',
  'reconcile',
  'settle-delivered',
  'invoice-generate',
  'invoice-overdue',
  'build-routes',
  'rollup-price-index',
  'forecast-demand',
  'harvest-reminder',
  'crate-return-nudge',
  'reliability-refresh',
] as const;
export type JobName = (typeof RUNNABLE_JOBS)[number];

// ─── Mutations ────────────────────────────────────────────────

function useInvalidate() {
  const qc = useQueryClient();
  return (...keys: (readonly unknown[])[]) => {
    for (const k of keys) void qc.invalidateQueries({ queryKey: k });
  };
}

export function useAdminMutations() {
  const invalidate = useInvalidate();
  return {
    setRole: useMutation({
      mutationFn: (a: { id: string; role: string }) =>
        api.post<Z<typeof RoleSetDto>>(`/v1/admin/users/${a.id}/role`, { role: a.role }),
      onSuccess: (_d, a) => invalidate(adminKeys.user(a.id), ['adminUsers']),
    }),
    ban: useMutation({
      mutationFn: (a: { id: string; banned: boolean; reason: string }) =>
        api.post<Z<typeof BanSetDto>>(`/v1/admin/users/${a.id}/ban`, { banned: a.banned, reason: a.reason }),
      onSuccess: (_d, a) => invalidate(adminKeys.user(a.id), ['adminUsers']),
    }),
    reviewKyc: useMutation({
      mutationFn: (a: {
        farmerProfileId: string;
        status: 'VERIFIED' | 'REJECTED';
        note?: string;
        userId: string;
      }) =>
        api.post<Z<typeof FarmerProfileDto>>(`/v1/admin/farmers/${a.farmerProfileId}/kyc`, {
          status: a.status,
          note: a.note || undefined,
        }),
      onSuccess: (_d, a) => invalidate(adminKeys.user(a.userId), adminKeys.kyc, adminKeys.summary),
    }),
    verifyOrg: useMutation({
      mutationFn: (a: { id: string; verified: boolean; paymentTerms?: string; creditLimit?: number }) =>
        api.post<Z<typeof OrgProfileDto>>(`/v1/admin/orgs/${a.id}/verify`, {
          verified: a.verified,
          paymentTerms: a.paymentTerms,
          creditLimit: a.creditLimit,
        }),
      onSuccess: (_d, a) => invalidate(['adminOrg', a.id], adminKeys.orgs),
    }),
    reviewDispute: useMutation({
      mutationFn: (a: { id: string }) => api.post<Z<typeof DisputeDto>>(`/v1/admin/disputes/${a.id}/review`),
      onSuccess: (_d, a) => invalidate(['dispute', a.id], ['disputes'], adminKeys.summary),
    }),
    resolveDispute: useMutation({
      mutationFn: (a: {
        id: string;
        outcome: 'REFUND' | 'NO_REFUND';
        refundAmount?: number;
        resolution: string;
      }) =>
        api.post<Z<typeof DisputeDto>>(`/v1/admin/disputes/${a.id}/resolve`, {
          outcome: a.outcome,
          refundAmount: a.outcome === 'REFUND' ? a.refundAmount : undefined,
          resolution: a.resolution,
        }),
      onSuccess: (_d, a) =>
        invalidate(['dispute', a.id], ['disputes'], ['orders'], ['order'], adminKeys.summary),
    }),
    retryPayout: useMutation({
      mutationFn: (a: { orderId: string }) =>
        api.post<Z<typeof PayoutDto> | null>(`/v1/admin/payouts/${a.orderId}/retry`),
      onSuccess: () => invalidate(['payouts'], adminKeys.summary),
    }),
    manualPayment: useMutation({
      mutationFn: (a: {
        orderId?: string;
        invoiceId?: string;
        amount: number;
        method: 'BANK_TRANSFER' | 'CASH';
        reference: string;
      }) => api.post<Z<typeof PaymentDto>>('/v1/admin/payments/manual', a),
      onSuccess: () => invalidate(['payments'], ['orders'], ['invoices'], adminKeys.summary),
    }),
    saveSetting: useMutation({
      mutationFn: (a: { key: keyof Settings; value: unknown }) =>
        api.put<Settings>(`/v1/admin/settings/${a.key}`, { value: a.value }),
      onSuccess: () => invalidate(adminKeys.settings, ['adminAudit']),
    }),
    runJob: useMutation({
      mutationFn: (a: { name: JobName }) => api.post<Z<typeof JobQueuedDto>>(`/v1/admin/jobs/${a.name}/run`),
      onSuccess: () => invalidate(['adminAudit']),
    }),
    createProduce: useMutation({
      mutationFn: (body: Record<string, unknown>) => api.post<Produce>('/v1/produce', body),
      onSuccess: () => invalidate(['produce']),
    }),
    updateProduce: useMutation({
      mutationFn: (a: { id: string; body: Record<string, unknown> }) =>
        api.patch<Produce>(`/v1/produce/${a.id}`, a.body),
      onSuccess: () => invalidate(['produce']),
    }),
    buildRoutes: useMutation({
      mutationFn: (a: { date: string; county?: string }) =>
        api.post<Z<typeof RoutesBuiltDto>>('/v1/routes/build', a),
      onSuccess: () => invalidate(['routes'], ['orders']),
    }),
    assignDriver: useMutation({
      mutationFn: (a: { routeId: string; driverId: string; vehicle?: string }) =>
        api.post<Z<typeof RouteDto>>(`/v1/routes/${a.routeId}/assign`, {
          driverId: a.driverId,
          vehicle: a.vehicle || undefined,
        }),
      onSuccess: (_d, a) => invalidate(adminKeys.route(a.routeId), ['routes']),
    }),
    startRoute: useMutation({
      mutationFn: (a: { routeId: string }) => api.post<Z<typeof RouteDto>>(`/v1/routes/${a.routeId}/start`),
      onSuccess: (_d, a) => invalidate(adminKeys.route(a.routeId), ['routes']),
    }),
    createCrates: useMutation({
      mutationFn: (a: { count: number; size?: string; depositCents?: number }) =>
        api.post<Z<typeof CratesCreatedDto>>('/v1/crates', a),
      onSuccess: () => invalidate(['crates']),
    }),
  };
}
