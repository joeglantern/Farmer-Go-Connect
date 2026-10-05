import { type Permission, roleHasPermission } from '@farmgo/auth';
import type { PlatformRole } from '@farmgo/contracts';
import { AppError, Errors } from '@farmgo/core';
import type { OrgProfile, OrgType } from '@farmgo/db';
import type { FastifyRequest } from 'fastify';
import type { SessionUser } from '../types.js';

/** The signed-in user, or 401. */
export function requireUser(req: FastifyRequest): SessionUser {
  if (!req.user) throw Errors.unauthorized();
  if (req.user.banned) throw Errors.forbidden('This account is suspended');
  return req.user;
}

export function roleOf(user: SessionUser): PlatformRole {
  return (user.role ?? 'user') as PlatformRole;
}

/** 403 unless the user has one of `roles` (admins always pass). */
export function requireRole(req: FastifyRequest, ...roles: PlatformRole[]): SessionUser {
  const user = requireUser(req);
  const role = roleOf(user);
  if (role !== 'admin' && !roles.includes(role)) {
    throw Errors.forbidden(`This is only available to ${roles.join(' or ')} accounts`);
  }
  return user;
}

/** 403 unless the user's role grants `permission` (see @farmgo/auth permissions). */
export function requirePermission(req: FastifyRequest, permission: Permission): SessionUser {
  const user = requireUser(req);
  if (!roleHasPermission(roleOf(user), permission)) throw Errors.forbidden();
  return user;
}

export const isAdmin = (user: SessionUser | null) => user?.role === 'admin';

export interface OrgContext {
  orgId: string;
  memberRole: string;
  profile: OrgProfile;
}

/**
 * The organization the user is acting for: the `X-Org-Id` header, else the session's active
 * organization, else their only membership. The user must be a member and the org must be of
 * the expected type (e.g. BUYER).
 */
export async function requireOrg(req: FastifyRequest, type: OrgType): Promise<OrgContext> {
  const user = requireUser(req);
  const prisma = req.server.prisma;
  const header = req.headers['x-org-id'];
  const requested = (typeof header === 'string' && header) || req.session?.activeOrganizationId || null;

  const memberships = await prisma.member.findMany({
    where: { userId: user.id, ...(requested ? { organizationId: requested } : {}) },
    include: { organization: { include: { profile: true } } },
  });
  const matching = memberships.filter((m) => m.organization.profile?.type === type);
  const m = matching[0];
  if (!m?.organization.profile) {
    if (isAdmin(user) && requested) {
      const profile = await prisma.orgProfile.findUnique({ where: { organizationId: requested } });
      if (profile?.type === type) return { orgId: requested, memberRole: 'admin', profile };
    }
    throw noOrgError(roleOf(user), type);
  }
  if (!requested && matching.length > 1) {
    throw Errors.badRequest(
      'ORG_REQUIRED',
      'You belong to several organizations. Choose one with the X-Org-Id header.',
    );
  }
  return { orgId: m.organizationId, memberRole: m.role, profile: m.organization.profile };
}

const ORG_KINDS: Record<OrgType, { kind: string; role: PlatformRole; onboarding: string | null }> = {
  BUYER: { kind: 'buyer', role: 'buyer', onboarding: '/v1/onboarding/buyer' },
  INPUT_SUPPLIER: { kind: 'supplier', role: 'input_supplier', onboarding: '/v1/onboarding/supplier' },
  FARMER_GROUP: { kind: 'farmer group', role: 'farmer', onboarding: null },
};

/** Why the caller has no organization of `type`, worded for their role (QA-027). */
function noOrgError(role: PlatformRole, type: OrgType) {
  const { kind, role: owner, onboarding } = ORG_KINDS[type];
  const details = { orgType: type, onboarding: null as string | null };
  if ((role === owner || role === 'user') && onboarding) {
    return new AppError(
      'NO_ORGANIZATION',
      type === 'BUYER'
        ? 'Set up your business or household profile first'
        : `Set up your ${kind} business profile first`,
      403,
      { ...details, onboarding },
    );
  }
  if (role === 'admin') {
    return new AppError(
      'NO_ORGANIZATION',
      `Choose the ${kind} organization to act for with the X-Org-Id header`,
      403,
      details,
    );
  }
  if (!['buyer', 'input_supplier'].includes(role)) {
    // Farmers and staff never belong to a business organization.
    return new AppError(
      'NO_ORGANIZATION',
      `Your account is not part of an organization. This is only available to ${kind} accounts.`,
      403,
      details,
    );
  }
  return new AppError(
    'NO_ORGANIZATION',
    `You are not part of a ${kind} organization. This is only available to ${kind} accounts.`,
    403,
    details,
  );
}

/** Farmer profile of the signed-in farmer (or 403). */
export async function requireFarmer(req: FastifyRequest) {
  const user = requireRole(req, 'farmer');
  const profile = await req.server.prisma.farmerProfile.findUnique({ where: { userId: user.id } });
  if (!profile) throw Errors.forbidden('Complete your farmer profile first (POST /v1/onboarding/farmer)');
  return { user, profile };
}
