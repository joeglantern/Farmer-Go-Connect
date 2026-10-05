import { z } from 'zod';
import { Language } from '../common.js';
import { PlatformRole } from '../roles.js';
import { FarmDto, FarmerProfileDto, MemberDto, OrganizationDto, OrgProfileDto, UserDto } from './models.js';
import { FileUrl, NullableString } from './primitives.js';

// ─── GET /v1/me ───────────────────────────────────────────────

export const MeUserDto = z.object({
  id: z.string(),
  name: z.string(),
  email: z.string(),
  emailVerified: z.boolean(),
  phoneNumber: NullableString,
  image: NullableString,
  imageUrl: FileUrl,
  role: PlatformRole,
  preferredLanguage: Language,
  county: NullableString,
  twoFactorEnabled: z.boolean(),
});

export const MeOrganizationDto = z.object({
  id: z.string(),
  name: z.string(),
  slug: z.string(),
  memberRole: z.string(),
  profile: OrgProfileDto.nullable(),
});

export const FarmerProfileWithFarmsDto = FarmerProfileDto.extend({ farms: z.array(FarmDto) });
export type FarmerProfileWithFarmsDto = z.infer<typeof FarmerProfileWithFarmsDto>;

export const MeDto = z.object({
  user: MeUserDto,
  /** True until the account has chosen farmer, buyer or supplier. */
  needsOnboarding: z.boolean(),
  /** "resource:action" strings the role grants, e.g. "order:create". */
  permissions: z.array(z.string()),
  farmerProfile: FarmerProfileWithFarmsDto.nullable(),
  organizations: z.array(MeOrganizationDto),
  activeOrganizationId: NullableString,
  /** Set while an admin is viewing the app as this user ("View as"): the admin's user id. */
  impersonatedBy: NullableString,
});
export type MeDto = z.infer<typeof MeDto>;

/** POST /v1/me/delete-request */
export const AccountDeletedDto = z.object({
  ok: z.literal(true),
  deletedAt: z.iso.datetime({ offset: true }),
});

/**
 * GET /v1/me/export: everything we hold about you (Kenya Data Protection Act). Sections are the
 * stored records as JSON; the shape of each follows the matching DTO where one exists.
 */
export const AccountExportDto = z.object({
  exportedAt: z.iso.datetime({ offset: true }),
  user: z.record(z.string(), z.unknown()),
  farmerProfile: z.record(z.string(), z.unknown()).nullable(),
  organizations: z.array(z.unknown()),
  orders: z.array(z.unknown()),
  payments: z.array(z.unknown()),
  payouts: z.array(z.unknown()),
  messages: z.array(z.unknown()),
  addresses: z.array(z.unknown()),
  favorites: z.array(z.unknown()),
  reviews: z.array(z.unknown()),
  inputOrders: z.array(z.unknown()),
});

// ─── PATCH /v1/me ─────────────────────────────────────────────

export const MeUpdatedDto = z.object({
  id: z.string(),
  name: z.string(),
  preferredLanguage: Language,
  county: NullableString,
  image: NullableString,
  imageUrl: FileUrl,
});
export type MeUpdatedDto = z.infer<typeof MeUpdatedDto>;

// ─── Onboarding ───────────────────────────────────────────────

/** POST /v1/onboarding/buyer and /v1/onboarding/supplier */
export const OnboardedOrgDto = z.object({ organization: OrganizationDto, profile: OrgProfileDto });
export type OnboardedOrgDto = z.infer<typeof OnboardedOrgDto>;

/** POST /v1/agent/farmers */
export const AgentFarmerCreatedDto = z.object({ user: UserDto, profile: FarmerProfileDto });
export type AgentFarmerCreatedDto = z.infer<typeof AgentFarmerCreatedDto>;

/** GET /v1/agent/farmers items */
export const AgentFarmerDto = FarmerProfileDto.extend({
  user: z.object({
    id: z.string(),
    name: z.string(),
    phoneNumber: NullableString,
    county: NullableString,
    phoneNumberVerified: z.boolean().nullable(),
  }),
  farms: z.array(FarmDto),
});
export type AgentFarmerDto = z.infer<typeof AgentFarmerDto>;

// ─── Organizations ────────────────────────────────────────────

export const OrgMemberDto = MemberDto.extend({
  user: z.object({ id: z.string(), name: z.string(), email: z.string(), phoneNumber: NullableString }),
});

/** GET /v1/orgs/current */
export const CurrentOrgDto = OrganizationDto.extend({
  profile: OrgProfileDto.nullable(),
  members: z.array(OrgMemberDto),
  /** The caller's role inside the organization (owner, admin, member). */
  memberRole: z.string(),
});
export type CurrentOrgDto = z.infer<typeof CurrentOrgDto>;
