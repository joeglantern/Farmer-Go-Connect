import { randomUUID } from 'node:crypto';
import type {
  AgentCreateFarmerInput,
  OnboardBuyerInput,
  OnboardFarmerInput,
  OnboardHouseholdInput,
  OnboardSupplierInput,
} from '@farmgo/contracts';
import { phoneTempEmail } from '@farmgo/contracts';
import { AppError, Errors, emit } from '@farmgo/core';
import type { OrgType, PrismaClient, Tx } from '@farmgo/db';
import type { SessionUser } from '../types.js';

const slugify = (s: string) =>
  `${s
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 40)}-${randomUUID().slice(0, 6)}`;

/** A role can only be chosen once, and only from a fresh account (or re-confirming the same role). */
function assertCanTakeRole(user: SessionUser, role: string) {
  const current = user.role ?? 'user';
  if (current !== 'user' && current !== role) {
    throw new AppError('ROLE_ALREADY_SET', `This account is already registered as ${current}`, 409);
  }
}

async function createFarmerProfile(
  tx: Tx,
  userId: string,
  phone: string | null,
  input: OnboardFarmerInput,
  agentId?: string,
) {
  const mpesa = input.mpesaNumber ?? phone;
  if (!mpesa) throw Errors.badRequest('MPESA_REQUIRED', 'Add the M-Pesa number that should receive payments');
  const profile = await tx.farmerProfile.upsert({
    where: { userId },
    create: {
      userId,
      gender: input.gender,
      dateOfBirth: input.dateOfBirth,
      mpesaNumber: mpesa,
      groupOrgId: input.groupOrgId,
      onboardedById: agentId,
    },
    update: {
      gender: input.gender,
      dateOfBirth: input.dateOfBirth,
      mpesaNumber: mpesa,
      groupOrgId: input.groupOrgId,
    },
  });
  if (input.farm) {
    await tx.farm.create({ data: { ...input.farm, farmerId: profile.id } });
  }
  return profile;
}

export async function onboardFarmer(prisma: PrismaClient, user: SessionUser, input: OnboardFarmerInput) {
  assertCanTakeRole(user, 'farmer');
  return prisma.$transaction(async (tx) => {
    await tx.user.update({
      where: { id: user.id },
      data: {
        role: 'farmer',
        name: input.name,
        county: input.county,
        ...(input.preferredLanguage ? { preferredLanguage: input.preferredLanguage } : {}),
      },
    });
    const profile = await createFarmerProfile(tx, user.id, user.phoneNumber ?? null, input);
    await emit(tx, 'user.onboarded', { userId: user.id, role: 'farmer' }, user.id);
    return profile;
  });
}

async function createOrg(
  tx: Tx,
  ownerId: string,
  type: OrgType,
  input: OnboardBuyerInput | OnboardSupplierInput,
) {
  const org = await tx.organization.create({
    data: { id: randomUUID(), name: input.businessName, slug: slugify(input.businessName) },
  });
  await tx.member.create({
    data: { id: randomUUID(), organizationId: org.id, userId: ownerId, role: 'owner' },
  });
  const profile = await tx.orgProfile.create({
    data: {
      organizationId: org.id,
      type,
      buyerCategory: 'buyerCategory' in input ? input.buyerCategory : null,
      county: input.county,
      town: input.town,
      address: input.address,
      lat: input.lat,
      lng: input.lng,
      phone: input.phone,
      email: 'email' in input ? input.email : undefined,
      kraPin: 'kraPin' in input ? input.kraPin : undefined,
    },
  });
  return { org, profile };
}

/**
 * The business this user already owns of `type`, if any. Onboarding is retried by clients after a
 * dropped connection, so a second call must return the first business, not create another one
 * (two orgs force every later session to pick one with X-Org-Id).
 */
async function existingBusiness(prisma: PrismaClient, userId: string, type: OrgType) {
  const m = await prisma.member.findFirst({
    where: { userId, organization: { profile: { type } } },
    include: { organization: { include: { profile: true } } },
    orderBy: { createdAt: 'asc' },
  });
  if (!m?.organization.profile) return null;
  const { profile, ...org } = m.organization;
  return { org, profile, existing: true as const };
}

export async function onboardBuyer(prisma: PrismaClient, user: SessionUser, input: OnboardBuyerInput) {
  assertCanTakeRole(user, 'buyer');
  const existing = await existingBusiness(prisma, user.id, 'BUYER');
  if (existing?.profile.buyerCategory === 'HOUSEHOLD') {
    throw new AppError('ALREADY_HOUSEHOLD_BUYER', 'This account already buys as a household', 409);
  }
  if (existing) return existing;
  return prisma.$transaction(async (tx) => {
    await tx.user.update({
      where: { id: user.id },
      data: { role: 'buyer', county: input.county, ...(input.name ? { name: input.name } : {}) },
    });
    const result = await createOrg(tx, user.id, 'BUYER', input);
    if (user.id && result.org.id) {
      await tx.session.updateMany({
        where: { userId: user.id },
        data: { activeOrganizationId: result.org.id },
      });
    }
    await emit(tx, 'user.onboarded', { userId: user.id, role: 'buyer' }, user.id);
    return { ...result, existing: false as const };
  });
}

/**
 * An individual or family buyer: a personal BUYER organization named after the person, always
 * prepaid, with the person as its only member. Retries return the existing one.
 */
export async function onboardHousehold(
  prisma: PrismaClient,
  user: SessionUser,
  input: OnboardHouseholdInput,
) {
  assertCanTakeRole(user, 'buyer');
  const existing = await existingBusiness(prisma, user.id, 'BUYER');
  if (existing?.profile.buyerCategory === 'HOUSEHOLD') return existing;
  if (existing) {
    throw new AppError(
      'ALREADY_BUSINESS_BUYER',
      'This account already buys for a business, not a household',
      409,
    );
  }
  return prisma.$transaction(async (tx) => {
    await tx.user.update({
      where: { id: user.id },
      data: { role: 'buyer', county: input.county, name: input.name },
    });
    const result = await createOrg(tx, user.id, 'BUYER', {
      businessName: input.name,
      buyerCategory: 'HOUSEHOLD',
      county: input.county,
      town: input.town,
      address: input.address,
      lat: input.lat,
      lng: input.lng,
      phone: input.phone ?? user.phoneNumber ?? undefined,
    });
    await tx.session.updateMany({
      where: { userId: user.id },
      data: { activeOrganizationId: result.org.id },
    });
    await emit(tx, 'user.onboarded', { userId: user.id, role: 'buyer' }, user.id);
    return { ...result, existing: false as const };
  });
}

export async function onboardSupplier(prisma: PrismaClient, user: SessionUser, input: OnboardSupplierInput) {
  // Farmers may also run a green-input enterprise, so they keep their role and just gain an org.
  const current = user.role ?? 'user';
  if (!['user', 'input_supplier', 'farmer'].includes(current)) {
    throw new AppError('ROLE_ALREADY_SET', `This account is already registered as ${current}`, 409);
  }
  const existing = await existingBusiness(prisma, user.id, 'INPUT_SUPPLIER');
  if (existing) return existing;
  return prisma.$transaction(async (tx) => {
    if (current === 'user') {
      await tx.user.update({
        where: { id: user.id },
        data: { role: 'input_supplier', county: input.county, ...(input.name ? { name: input.name } : {}) },
      });
    }
    const result = await createOrg(tx, user.id, 'INPUT_SUPPLIER', input);
    await emit(tx, 'user.onboarded', { userId: user.id, role: 'input_supplier' }, user.id);
    return { ...result, existing: false as const };
  });
}

/**
 * A field agent registers a farmer by phone number. The farmer can later sign in with an
 * OTP to the same number; until then the agent can manage listings for them.
 */
export async function agentCreateFarmer(
  prisma: PrismaClient,
  agent: SessionUser,
  input: AgentCreateFarmerInput,
) {
  const existing = await prisma.user.findUnique({
    where: { phoneNumber: input.phoneNumber },
    include: { farmerProfile: true },
  });
  if (existing?.farmerProfile)
    throw Errors.conflict('FARMER_EXISTS', 'A farmer with this phone number is already registered');
  if (existing?.role && !['user', 'farmer'].includes(existing.role)) {
    throw Errors.conflict('PHONE_IN_USE', 'This phone number belongs to another type of account');
  }
  return prisma.$transaction(async (tx) => {
    const user =
      existing ??
      (await tx.user.create({
        data: {
          id: randomUUID(),
          name: input.name,
          email: phoneTempEmail(input.phoneNumber),
          phoneNumber: input.phoneNumber,
          phoneNumberVerified: false,
          role: 'farmer',
          county: input.county,
          preferredLanguage: input.preferredLanguage ?? 'sw',
        },
      }));
    if (existing) {
      await tx.user.update({
        where: { id: user.id },
        data: { role: 'farmer', name: input.name, county: input.county },
      });
    }
    const profile = await createFarmerProfile(tx, user.id, input.phoneNumber, input, agent.id);
    await emit(tx, 'farmer.created_by_agent', { userId: user.id, agentId: agent.id }, user.id);
    return { user, profile };
  });
}
