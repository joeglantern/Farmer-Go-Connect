import { roleHasPermission, statements } from '@farmgo/auth';
import {
  AccountDeletedDto,
  AccountExportDto,
  CurrentOrgDto,
  ErrorBody,
  FarmerProfileDto,
  MeDto,
  MeUpdatedDto,
  OnboardBuyerInput,
  OnboardedOrgDto,
  OnboardFarmerInput,
  OnboardHouseholdInput,
  OnboardSupplierInput,
  OrgProfileDto,
  UpdateFarmerProfileInput,
  UpdateMeInput,
  UpdateOrgProfileInput,
} from '@farmgo/contracts';
import { Errors } from '@farmgo/core';
import type { FastifyInstance } from 'fastify';
import { revokeAllSessions, syncAuthUser } from '../lib/auth-sync.js';
import { requireOrg, requireUser, roleOf } from '../lib/guards.js';
import { created, ok, typed } from '../lib/route.js';
import type { SessionUser } from '../types.js';
import { anonymizeAccount, exportAccount } from './account.service.js';
import { onboardBuyer, onboardFarmer, onboardHousehold, onboardSupplier } from './onboarding.service.js';
import { assertOwnKeys } from './uploads.routes.js';

/** Every permission the user's role grants, e.g. ["order:create", "demand:board"]. */
function permissionsFor(role: string): string[] {
  const out: string[] = [];
  for (const [resource, actions] of Object.entries(statements)) {
    for (const action of actions) {
      if (roleHasPermission(role, { [resource]: [action] } as never)) out.push(`${resource}:${action}`);
    }
  }
  return out;
}

/** Which kind of business the caller acts for: buyers run a BUYER org; suppliers, and farmers
 * who also run a green-input enterprise, run an INPUT_SUPPLIER org. */
function businessTypeFor(user: SessionUser): 'BUYER' | 'INPUT_SUPPLIER' {
  const role = roleOf(user);
  return role === 'input_supplier' || role === 'farmer' ? 'INPUT_SUPPLIER' : 'BUYER';
}

export default async function meRoutes(app: FastifyInstance) {
  const r = typed(app);

  r.get(
    '/v1/me',
    {
      schema: {
        tags: ['me'],
        summary: 'Current user, role, permissions and organizations',
        response: ok(MeDto),
      },
    },
    async (req) => {
      const user = requireUser(req);
      const [farmerProfile, memberships] = await Promise.all([
        app.prisma.farmerProfile.findUnique({
          where: { userId: user.id },
          include: { farms: { where: { active: true } } },
        }),
        app.prisma.member.findMany({
          where: { userId: user.id },
          include: { organization: { include: { profile: true } } },
        }),
      ]);
      const role = roleOf(user);
      return {
        user: {
          id: user.id,
          name: user.name,
          email: user.email,
          emailVerified: user.emailVerified,
          phoneNumber: user.phoneNumber ?? null,
          image: user.image ?? null,
          role,
          preferredLanguage: (user as { preferredLanguage?: string }).preferredLanguage ?? 'sw',
          county: (user as { county?: string | null }).county ?? null,
          twoFactorEnabled: (user as { twoFactorEnabled?: boolean }).twoFactorEnabled ?? false,
        },
        needsOnboarding: role === 'user',
        permissions: permissionsFor(role),
        farmerProfile,
        organizations: memberships.map((m) => ({
          id: m.organizationId,
          name: m.organization.name,
          slug: m.organization.slug,
          memberRole: m.role,
          profile: m.organization.profile,
        })),
        activeOrganizationId: req.session?.activeOrganizationId ?? memberships[0]?.organizationId ?? null,
        impersonatedBy: (req.session as { impersonatedBy?: string | null } | null)?.impersonatedBy ?? null,
      };
    },
  );

  r.patch(
    '/v1/me',
    {
      schema: {
        tags: ['me'],
        summary: 'Update name, language, county or avatar',
        body: UpdateMeInput,
        response: ok(MeUpdatedDto),
      },
    },
    async (req) => {
      const user = requireUser(req);
      if (req.body.image) await assertOwnKeys(req, [req.body.image]);
      const updated = await app.prisma.user.update({
        where: { id: user.id },
        data: req.body,
        select: { id: true, name: true, preferredLanguage: true, county: true, image: true },
      });
      await syncAuthUser(app, user.id);
      return updated;
    },
  );

  r.post(
    '/v1/me/delete-request',
    {
      schema: {
        tags: ['me'],
        summary: 'Delete my account (personal data removed; orders and payments kept, detached)',
        description:
          'Refused with 409 ACCOUNT_HAS_OPEN_ORDERS or ACCOUNT_HAS_UNPAID_PAYOUTS while orders are in ' +
          'progress or money is still owed to you. Signs you out everywhere.',
        response: ok(AccountDeletedDto),
      },
      config: { rateLimit: { max: 3, timeWindow: '1 minute' } },
    },
    async (req) => {
      const user = requireUser(req);
      const { deletedAt } = await anonymizeAccount(app.prisma, user.id);
      await syncAuthUser(app, user.id);
      await revokeAllSessions(app, user.id);
      return { ok: true as const, deletedAt };
    },
  );

  r.get(
    '/v1/me/export',
    {
      schema: {
        tags: ['me'],
        summary: 'Download everything we hold about me as JSON',
        response: ok(AccountExportDto),
      },
      config: { rateLimit: { max: 5, timeWindow: '1 minute' } },
    },
    async (req, reply) => {
      const user = requireUser(req);
      reply.header('content-disposition', `attachment; filename="farmgo-data-${user.id}.json"`);
      return exportAccount(app.prisma, user.id);
    },
  );

  r.patch(
    '/v1/me/farmer-profile',
    {
      schema: {
        tags: ['me'],
        summary: 'Update gender, date of birth, M-Pesa number or ID document',
        body: UpdateFarmerProfileInput,
        response: ok(FarmerProfileDto),
      },
    },
    async (req) => {
      const user = requireUser(req);
      const profile = await app.prisma.farmerProfile.findUnique({ where: { userId: user.id } });
      if (!profile) throw Errors.notFound('Farmer profile');
      if (req.body.nationalIdKey) await assertOwnKeys(req, [req.body.nationalIdKey]);
      return app.prisma.farmerProfile.update({
        where: { id: profile.id },
        data: {
          ...req.body,
          // Uploading an ID moves KYC to review; changing the payout number needs re-verification.
          ...(req.body.nationalIdKey ? { kycStatus: 'SUBMITTED' as const } : {}),
        },
      });
    },
  );

  r.post(
    '/v1/onboarding/farmer',
    {
      schema: {
        tags: ['me'],
        summary: 'Register as a farmer',
        body: OnboardFarmerInput,
        response: created(FarmerProfileDto),
      },
    },
    async (req, reply) => {
      const user = requireUser(req);
      if (req.body.farm?.photoKey) await assertOwnKeys(req, [req.body.farm.photoKey]);
      const profile = await onboardFarmer(app.prisma, user, req.body);
      await syncAuthUser(app, user.id);
      return reply.status(201).send(profile);
    },
  );

  r.post(
    '/v1/onboarding/buyer',
    {
      schema: {
        tags: ['me'],
        summary: 'Register a hotel, restaurant or other buyer',
        body: OnboardBuyerInput,
        // 201 when the business is created, 200 when this account already has one (safe retry).
        response: { 200: OnboardedOrgDto, 201: OnboardedOrgDto, default: ErrorBody },
      },
    },
    async (req, reply) => {
      const user = requireUser(req);
      const { org, profile, existing } = await onboardBuyer(app.prisma, user, req.body);
      await syncAuthUser(app, user.id);
      // A repeat returns the business already created (200) instead of a second one.
      return reply.status(existing ? 200 : 201).send({ organization: org, profile });
    },
  );

  r.post(
    '/v1/onboarding/household',
    {
      schema: {
        tags: ['me'],
        summary: 'Register as an individual or household buyer (prepaid, no KRA PIN)',
        body: OnboardHouseholdInput,
        response: { 200: OnboardedOrgDto, 201: OnboardedOrgDto, default: ErrorBody },
      },
    },
    async (req, reply) => {
      const user = requireUser(req);
      const { org, profile, existing } = await onboardHousehold(app.prisma, user, req.body);
      await syncAuthUser(app, user.id);
      return reply.status(existing ? 200 : 201).send({ organization: org, profile });
    },
  );

  r.post(
    '/v1/onboarding/supplier',
    {
      schema: {
        tags: ['me'],
        summary: 'Register a green-input enterprise',
        body: OnboardSupplierInput,
        // 201 when the business is created, 200 when this account already has one (safe retry).
        response: { 200: OnboardedOrgDto, 201: OnboardedOrgDto, default: ErrorBody },
      },
    },
    async (req, reply) => {
      const user = requireUser(req);
      const { org, profile, existing } = await onboardSupplier(app.prisma, user, req.body);
      await syncAuthUser(app, user.id);
      return reply.status(existing ? 200 : 201).send({ organization: org, profile });
    },
  );

  r.get(
    '/v1/orgs/current',
    { schema: { tags: ['me'], summary: 'The organization you are acting for', response: ok(CurrentOrgDto) } },
    async (req) => {
      const ctx = await requireOrg(req, businessTypeFor(requireUser(req)));
      const org = await app.prisma.organization.findUniqueOrThrow({
        where: { id: ctx.orgId },
        include: {
          profile: true,
          members: {
            include: { user: { select: { id: true, name: true, email: true, phoneNumber: true } } },
          },
        },
      });
      return { ...org, memberRole: ctx.memberRole };
    },
  );

  r.patch(
    '/v1/orgs/current',
    {
      schema: {
        tags: ['me'],
        summary: 'Update the organization profile (owners and admins)',
        body: UpdateOrgProfileInput,
        response: ok(OrgProfileDto),
      },
    },
    async (req) => {
      const ctx = await requireOrg(req, businessTypeFor(requireUser(req)));
      if (!['owner', 'admin'].includes(ctx.memberRole))
        throw Errors.forbidden('Only organization owners and admins can edit the profile');
      const category = req.body.buyerCategory;
      if (category !== undefined) {
        // A buyer category means nothing on a supplier profile (QA-026b).
        if (ctx.profile.type !== 'BUYER') {
          throw Errors.badRequest(
            'BUYER_CATEGORY_NOT_APPLICABLE',
            'Buyer categories apply to buyer organizations only',
          );
        }
        // Households are prepaid and personal, so a business cannot become one or leave it here.
        if ((category === 'HOUSEHOLD') !== (ctx.profile.buyerCategory === 'HOUSEHOLD')) {
          throw Errors.badRequest(
            'HOUSEHOLD_CATEGORY_LOCKED',
            'A household account cannot switch to a business category, or the other way round',
          );
        }
      }
      return app.prisma.orgProfile.update({ where: { organizationId: ctx.orgId }, data: req.body });
    },
  );
}
