import {
  AdminDisputePageDto,
  AdminOrgPageDto,
  AdminPayoutPageDto,
  AdminUserDetailDto,
  AdminUserPageDto,
  AdminUserQuery,
  AuditPageDto,
  AuditQuery,
  BanSetDto,
  BoolParam,
  Cents,
  DisputeDto,
  FarmerProfileDto,
  IdParams,
  ImpactReportDto,
  JobQueuedDto,
  KycPageDto,
  KycReviewInput,
  MatchDto,
  MatchOverrideInput,
  OpsSummaryDto,
  OrgProfileDto,
  Pagination,
  PaymentDto,
  PayoutDto,
  ReportQuery,
  ResolveDisputeInput,
  RoleSetDto,
  SetRoleInput,
  SettingInput,
  SettingsDto,
  VerifyOrgInput,
} from '@farmgo/contracts';
import {
  audit,
  createManualMatch,
  Errors,
  enqueue,
  getAllSettings,
  impactReport,
  isSettingKey,
  opsSummary,
  type QueueName,
  recordManualPayment,
  resolveDispute,
  retryPayout,
  setSetting,
} from '@farmgo/core';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { revokeAllSessions, syncAuthUser } from '../lib/auth-sync.js';
import { requirePermission } from '../lib/guards.js';
import { cursorArgs, paginate } from '../lib/pagination.js';
import { accepted, created, ok, typed } from '../lib/route.js';

/** Scheduled jobs an admin may run on demand. */
const RUNNABLE_JOBS: Record<string, [QueueName, string]> = {
  'expand-recurring': ['demand', 'expand-recurring'],
  'aggregate-weekly': ['demand', 'aggregate-weekly'],
  'expire-demand': ['demand', 'expire-demand'],
  'expire-matches': ['matching', 'expire-matches'],
  reconcile: ['payments', 'reconcile'],
  'settle-delivered': ['payments', 'settle-delivered'],
  'invoice-generate': ['payments', 'invoice-generate'],
  'invoice-overdue': ['payments', 'invoice-overdue'],
  'build-routes': ['logistics', 'build-routes'],
  'rollup-price-index': ['pricing', 'rollup-price-index'],
  'forecast-demand': ['pricing', 'forecast-demand'],
  'harvest-reminder': ['reminders', 'harvest-reminder'],
  'crate-return-nudge': ['reminders', 'crate-return-nudge'],
  'reliability-refresh': ['reminders', 'reliability-refresh'],
};

export default async function adminRoutes(app: FastifyInstance) {
  const r = typed(app);
  const admin = (req: Parameters<typeof requirePermission>[0]) => requirePermission(req, { user: ['list'] });

  // ─── Dashboards & reports ─────────────────────────────────
  r.get(
    '/v1/admin/summary',
    { schema: { tags: ['admin'], summary: 'Operations summary', response: ok(OpsSummaryDto) } },
    async (req) => {
      requirePermission(req, { report: ['read'] });
      return opsSummary(app.prisma);
    },
  );

  r.get(
    '/v1/admin/reports/impact',
    {
      schema: {
        tags: ['admin'],
        summary: 'Impact metrics for EYAAM and funders',
        querystring: ReportQuery,
        response: ok(ImpactReportDto),
      },
    },
    async (req) => {
      requirePermission(req, { report: ['read'] });
      return impactReport(app.prisma, req.query);
    },
  );

  // ─── Users ────────────────────────────────────────────────
  r.get(
    '/v1/admin/users',
    {
      schema: {
        tags: ['admin'],
        summary: 'Search users',
        querystring: AdminUserQuery,
        response: ok(AdminUserPageDto),
      },
    },
    async (req) => {
      admin(req);
      const q = req.query;
      const rows = await app.prisma.user.findMany({
        where: {
          ...(q.role ? { role: q.role } : {}),
          ...(q.county ? { county: q.county } : {}),
          ...(q.q
            ? {
                OR: [
                  { name: { contains: q.q, mode: 'insensitive' } },
                  { email: { contains: q.q, mode: 'insensitive' } },
                  { phoneNumber: { contains: q.q } },
                ],
              }
            : {}),
        },
        select: {
          id: true,
          name: true,
          email: true,
          phoneNumber: true,
          role: true,
          county: true,
          banned: true,
          createdAt: true,
          farmerProfile: { select: { id: true, kycStatus: true, ordersCompleted: true } },
        },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        ...cursorArgs(q.cursor, q.limit),
      });
      return paginate(rows, q.limit);
    },
  );

  r.get(
    '/v1/admin/users/:id',
    {
      schema: { tags: ['admin'], summary: 'User detail', params: IdParams, response: ok(AdminUserDetailDto) },
    },
    async (req) => {
      admin(req);
      const u = await app.prisma.user.findUnique({
        where: { id: req.params.id },
        include: {
          farmerProfile: { include: { farms: true } },
          members: { include: { organization: { include: { profile: true } } } },
          sessions: {
            select: { id: true, createdAt: true, expiresAt: true, ipAddress: true, userAgent: true },
          },
        },
      });
      if (!u) throw Errors.notFound('User');
      return u;
    },
  );

  r.post(
    '/v1/admin/users/:id/role',
    {
      schema: {
        tags: ['admin'],
        summary: 'Assign a platform role (e.g. agent, qa_officer, driver)',
        params: IdParams,
        body: SetRoleInput,
        response: ok(RoleSetDto),
      },
    },
    async (req) => {
      const actor = requirePermission(req, { user: ['set-role'] });
      const before = await app.prisma.user.findUnique({ where: { id: req.params.id } });
      if (!before) throw Errors.notFound('User');
      if (before.id === actor.id && req.body.role !== 'admin')
        throw Errors.badRequest('SELF_DEMOTE', 'You cannot remove your own admin role');
      const u = await app.prisma.user.update({
        where: { id: req.params.id },
        data: { role: req.body.role },
        select: { id: true, role: true },
      });
      await syncAuthUser(app, u.id);
      await audit(app.prisma, {
        actorId: actor.id,
        action: 'user.set_role',
        entity: 'User',
        entityId: u.id,
        before: { role: before.role },
        after: { role: u.role },
        ip: req.ip,
      });
      return u;
    },
  );

  r.post(
    '/v1/admin/users/:id/ban',
    {
      schema: {
        tags: ['admin'],
        summary: 'Suspend or reinstate a user',
        params: IdParams,
        body: z.object({ reason: z.string().min(3).max(300), banned: z.boolean().default(true) }),
        response: ok(BanSetDto),
      },
    },
    async (req) => {
      const actor = requirePermission(req, { user: ['ban'] });
      if (req.params.id === actor.id) throw Errors.badRequest('SELF_BAN', 'You cannot ban yourself');
      const u = await app.prisma.user.update({
        where: { id: req.params.id },
        data: { banned: req.body.banned, banReason: req.body.banned ? req.body.reason : null },
        select: { id: true, banned: true },
      });
      await syncAuthUser(app, u.id);
      if (req.body.banned) await revokeAllSessions(app, u.id);
      await audit(app.prisma, {
        actorId: actor.id,
        action: req.body.banned ? 'user.ban' : 'user.unban',
        entity: 'User',
        entityId: u.id,
        after: req.body,
        ip: req.ip,
      });
      return u;
    },
  );

  r.post(
    '/v1/admin/farmers/:id/kyc',
    {
      schema: {
        tags: ['admin'],
        summary: 'Approve or reject a farmer ID check',
        params: IdParams,
        body: KycReviewInput,
        response: ok(FarmerProfileDto),
      },
    },
    async (req) => {
      const actor = requirePermission(req, { farmer: ['kyc'] });
      const fp = await app.prisma.farmerProfile.update({
        where: { id: req.params.id },
        data: { kycStatus: req.body.status },
      });
      await audit(app.prisma, {
        actorId: actor.id,
        action: 'farmer.kyc',
        entity: 'FarmerProfile',
        entityId: fp.id,
        after: req.body,
      });
      return fp;
    },
  );

  r.get(
    '/v1/admin/kyc',
    {
      schema: {
        tags: ['admin'],
        summary: 'Farmer ID checks waiting for review',
        querystring: Pagination,
        response: ok(KycPageDto),
      },
    },
    async (req) => {
      requirePermission(req, { farmer: ['kyc'] });
      const rows = await app.prisma.farmerProfile.findMany({
        where: { kycStatus: 'SUBMITTED' },
        include: { user: { select: { id: true, name: true, phoneNumber: true, county: true } } },
        orderBy: { id: 'asc' },
        ...cursorArgs(req.query.cursor, req.query.limit),
      });
      return paginate(rows, req.query.limit);
    },
  );

  // ─── Organizations ────────────────────────────────────────
  r.get(
    '/v1/admin/orgs',
    {
      schema: {
        tags: ['admin'],
        summary: 'All organizations',
        querystring: Pagination,
        response: ok(AdminOrgPageDto),
      },
    },
    async (req) => {
      admin(req);
      const rows = await app.prisma.organization.findMany({
        include: { profile: true, _count: { select: { members: true, orders: true } } },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        ...cursorArgs(req.query.cursor, req.query.limit),
      });
      return paginate(rows, req.query.limit);
    },
  );

  r.post(
    '/v1/admin/orgs/:id/verify',
    {
      schema: {
        tags: ['admin'],
        summary: 'Verify a buyer and set credit terms',
        params: IdParams,
        body: VerifyOrgInput,
        response: ok(OrgProfileDto),
      },
    },
    async (req) => {
      const actor = admin(req);
      const current = await app.prisma.orgProfile.findUnique({ where: { organizationId: req.params.id } });
      if (!current) throw Errors.notFound('Organization');
      const credit = (req.body.paymentTerms && req.body.paymentTerms !== 'PREPAID') || !!req.body.creditLimit;
      if (credit && current.type !== 'BUYER') {
        throw Errors.badRequest(
          'CREDIT_TERMS_NOT_APPLICABLE',
          'Payment terms apply to buyer organizations only',
        );
      }
      if (credit && current.buyerCategory === 'HOUSEHOLD') {
        throw Errors.badRequest(
          'HOUSEHOLD_PREPAID_ONLY',
          'Households always pay in advance; they cannot buy on credit',
        );
      }
      const p = await app.prisma.orgProfile.update({
        where: { organizationId: req.params.id },
        data: req.body,
      });
      await audit(app.prisma, {
        actorId: actor.id,
        action: 'org.verify',
        entity: 'Organization',
        entityId: req.params.id,
        after: req.body,
      });
      return p;
    },
  );

  // ─── Marketplace operations ───────────────────────────────
  r.post(
    '/v1/admin/matches',
    {
      schema: {
        tags: ['admin'],
        summary: 'Create or override a match manually',
        body: MatchOverrideInput,
        response: created(MatchDto),
      },
    },
    async (req, reply) => {
      const actor = requirePermission(req, { match: ['override'] });
      const m = await app.prisma.$transaction((tx) =>
        createManualMatch(tx, { ...req.body, adminId: actor.id }),
      );
      await audit(app.prisma, {
        actorId: actor.id,
        action: 'match.override',
        entity: 'Match',
        entityId: m.id,
        after: req.body,
      });
      return reply.status(201).send(m);
    },
  );

  r.get(
    '/v1/admin/disputes',
    {
      schema: {
        tags: ['admin'],
        summary: 'Disputes (open only with ?open=true)',
        querystring: Pagination.extend({ open: BoolParam.optional() }),
        response: ok(AdminDisputePageDto),
      },
    },
    async (req) => {
      requirePermission(req, { order: ['transition-any'] });
      const rows = await app.prisma.dispute.findMany({
        where: req.query.open ? { status: { in: ['OPEN', 'UNDER_REVIEW'] } } : {},
        include: {
          order: { select: { id: true, code: true, total: true, buyerOrg: { select: { name: true } } } },
          inputOrder: { select: { id: true, total: true, product: { select: { name: true } } } },
          raisedBy: { select: { name: true } },
        },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        ...cursorArgs(req.query.cursor, req.query.limit),
      });
      return paginate(rows, req.query.limit);
    },
  );

  r.post(
    '/v1/admin/disputes/:id/review',
    {
      schema: {
        tags: ['admin'],
        summary: 'Mark a dispute as under review',
        params: IdParams,
        response: ok(DisputeDto),
      },
    },
    async (req) => {
      requirePermission(req, { order: ['transition-any'] });
      return app.prisma.dispute.update({ where: { id: req.params.id }, data: { status: 'UNDER_REVIEW' } });
    },
  );

  r.post(
    '/v1/admin/disputes/:id/resolve',
    {
      schema: {
        tags: ['admin'],
        summary: 'Resolve a dispute with or without a refund',
        params: IdParams,
        body: ResolveDisputeInput,
        response: ok(DisputeDto),
      },
    },
    async (req) => {
      const actor = requirePermission(req, { payment: ['refund'] });
      return resolveDispute(app.prisma, { disputeId: req.params.id, ...req.body, adminId: actor.id });
    },
  );

  // ─── Money ────────────────────────────────────────────────
  r.get(
    '/v1/admin/payouts',
    {
      schema: {
        tags: ['admin'],
        summary: 'Farmer payouts',
        querystring: Pagination.extend({ status: z.enum(['PENDING', 'SUCCESS', 'FAILED']).optional() }),
        response: ok(AdminPayoutPageDto),
      },
    },
    async (req) => {
      // Admin-only: buyers also hold payment:read (for their own payments), and this lists farmers' phones.
      requirePermission(req, { payment: ['reconcile'] });
      const rows = await app.prisma.payout.findMany({
        where: req.query.status ? { status: req.query.status } : {},
        include: { order: { select: { code: true } }, farmer: { select: { name: true, phoneNumber: true } } },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        ...cursorArgs(req.query.cursor, req.query.limit),
      });
      return paginate(rows, req.query.limit);
    },
  );

  r.post(
    '/v1/admin/payouts/:orderId/retry',
    {
      schema: {
        tags: ['admin'],
        summary: 'Retry a failed payout',
        params: z.object({ orderId: z.string() }),
        response: ok(PayoutDto.nullable()),
      },
    },
    async (req) => {
      const actor = requirePermission(req, { payment: ['reconcile'] });
      return retryPayout(app.prisma, req.params.orderId, actor.id);
    },
  );

  r.post(
    '/v1/admin/payments/manual',
    {
      schema: {
        tags: ['admin'],
        summary:
          'Record a bank transfer or cash payment (orderId takes an id or order code, invoiceId an id or invoice number)',
        body: z
          .object({
            orderId: z.string().optional(),
            invoiceId: z.string().optional(),
            amount: Cents.positive(),
            method: z.enum(['BANK_TRANSFER', 'CASH']),
            reference: z.string().min(3).max(100),
          })
          .refine((v) => !!v.orderId !== !!v.invoiceId, { message: 'Give either orderId or invoiceId' }),
        response: created(PaymentDto),
      },
    },
    async (req, reply) => {
      const actor = requirePermission(req, { payment: ['reconcile'] });
      const p = await recordManualPayment(app.prisma, { ...req.body, adminId: actor.id });
      return reply.status(201).send(p);
    },
  );

  // ─── Settings, audit, jobs ────────────────────────────────
  r.get(
    '/v1/admin/settings',
    { schema: { tags: ['admin'], summary: 'Business settings', response: ok(SettingsDto) } },
    async (req) => {
      requirePermission(req, { setting: ['manage'] });
      return getAllSettings(app.prisma);
    },
  );

  r.put(
    '/v1/admin/settings/:key',
    {
      schema: {
        tags: ['admin'],
        summary: 'Change one business setting (validated against SettingsDto)',
        params: z.object({ key: z.string() }),
        body: SettingInput,
        response: ok(SettingsDto),
      },
    },
    async (req) => {
      const actor = requirePermission(req, { setting: ['manage'] });
      if (!isSettingKey(req.params.key)) throw Errors.notFound('Setting');
      const parsed = SettingsDto.shape[req.params.key].safeParse(req.body.value);
      if (!parsed.success) {
        throw Errors.badRequest('INVALID_SETTING', `Invalid value for ${req.params.key}`, {
          issues: parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
        });
      }
      await setSetting(app.prisma, req.params.key, parsed.data as never, actor.id);
      await audit(app.prisma, {
        actorId: actor.id,
        action: 'setting.update',
        entity: 'PlatformSetting',
        entityId: req.params.key,
        after: req.body.value,
      });
      return getAllSettings(app.prisma);
    },
  );

  r.get(
    '/v1/admin/audit',
    {
      schema: { tags: ['admin'], summary: 'Audit log', querystring: AuditQuery, response: ok(AuditPageDto) },
    },
    async (req) => {
      requirePermission(req, { audit: ['read'] });
      const q = req.query;
      const rows = await app.prisma.auditLog.findMany({
        where: { ...(q.entity ? { entity: q.entity } : {}), ...(q.entityId ? { entityId: q.entityId } : {}) },
        orderBy: { id: 'desc' },
        take: q.limit + 1,
        ...(q.cursor ? { cursor: { id: BigInt(q.cursor) }, skip: 1 } : {}),
      });
      const hasMore = rows.length > q.limit;
      const items = hasMore ? rows.slice(0, q.limit) : rows;
      return { items, nextCursor: hasMore ? items[items.length - 1]!.id.toString() : null };
    },
  );

  r.post(
    '/v1/admin/jobs/:name/run',
    {
      schema: {
        tags: ['admin'],
        summary: 'Run a scheduled job now',
        params: z.object({ name: z.string() }),
        response: accepted(JobQueuedDto),
      },
    },
    async (req, reply) => {
      const actor = requirePermission(req, { setting: ['manage'] });
      const job = RUNNABLE_JOBS[req.params.name];
      if (!job) throw Errors.notFound(`Job ${req.params.name}`);
      await enqueue(job[0], job[1] as never, {} as never, {
        jobId: `manual-${req.params.name}-${Date.now()}`,
      });
      await audit(app.prisma, {
        actorId: actor.id,
        action: 'job.run',
        entity: 'Job',
        entityId: req.params.name,
      });
      return reply.status(202).send({ queued: req.params.name, available: Object.keys(RUNNABLE_JOBS) });
    },
  );
}
