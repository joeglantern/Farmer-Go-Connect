import { AppError, audit } from '@farmgo/core';
import type { PrismaClient } from '@farmgo/db';

const CLOSED_ORDER = ['PAID', 'REFUNDED', 'CANCELLED', 'QA_REJECTED'] as const;
const CLOSED_INPUT_ORDER = ['DELIVERED', 'REJECTED', 'CANCELLED'] as const;

/**
 * Why this account cannot be deleted yet, or null. Money and deliveries in flight must finish
 * first: open orders as a farmer, open orders of a business the user runs alone, and anything
 * still to be paid out to them.
 */
export async function deletionBlockers(prisma: PrismaClient, userId: string) {
  const memberships = await prisma.member.findMany({ where: { userId }, select: { organizationId: true } });
  // Businesses that would be left without anyone to finish their orders.
  const soleOrgs: string[] = [];
  for (const m of memberships) {
    const others = await prisma.member.count({
      where: { organizationId: m.organizationId, userId: { not: userId } },
    });
    if (others === 0) soleOrgs.push(m.organizationId);
  }
  const [farmerOrders, businessOrders, inputOrders, payouts, unpaidDelivered] = await Promise.all([
    prisma.order.count({ where: { farmerId: userId, status: { notIn: [...CLOSED_ORDER] } } }),
    prisma.order.count({ where: { buyerOrgId: { in: soleOrgs }, status: { notIn: [...CLOSED_ORDER] } } }),
    prisma.inputOrder.count({
      where: {
        status: { notIn: [...CLOSED_INPUT_ORDER] },
        OR: [{ buyerId: userId }, { product: { supplierOrgId: { in: soleOrgs } } }],
      },
    }),
    prisma.payout.count({ where: { farmerId: userId, status: { in: ['PENDING', 'FAILED'] } } }),
    // Settled orders whose payout has not been created yet.
    prisma.order.count({ where: { farmerId: userId, status: 'PAID', payout: null } }),
  ]);
  const openOrders = farmerOrders + businessOrders + inputOrders;
  if (openOrders) {
    return new AppError(
      'ACCOUNT_HAS_OPEN_ORDERS',
      `Finish or cancel your ${openOrders} open order${openOrders === 1 ? '' : 's'} before deleting your account`,
      409,
      { openOrders },
    );
  }
  if (payouts + unpaidDelivered) {
    return new AppError(
      'ACCOUNT_HAS_UNPAID_PAYOUTS',
      'We still owe you money. Your account can be deleted once your payouts have been sent.',
      409,
      { unpaidPayouts: payouts + unpaidDelivered },
    );
  }
  return null;
}

/**
 * Delete an account (Kenya Data Protection Act): remove personal data and sign-in methods, but
 * keep orders and payments for accounting with the person detached. The row itself stays so
 * financial records still point somewhere; it can never sign in again.
 */
export async function anonymizeAccount(prisma: PrismaClient, userId: string) {
  const blocker = await deletionBlockers(prisma, userId);
  if (blocker) throw blocker;
  const deletedAt = new Date();
  await prisma.$transaction(async (tx) => {
    await tx.user.update({
      where: { id: userId },
      data: {
        name: 'Deleted user',
        email: `deleted-${userId}@deleted.farmgo.local`,
        emailVerified: false,
        phoneNumber: null,
        phoneNumberVerified: false,
        image: null,
        county: null,
        twoFactorEnabled: false,
        banned: true,
        banReason: 'Account deleted by its owner',
      },
    });
    const profile = await tx.farmerProfile.findUnique({ where: { userId } });
    if (profile) {
      await tx.farmerProfile.update({
        where: { id: profile.id },
        data: { mpesaNumber: '', nationalIdKey: null, dateOfBirth: null, gender: 'UNDISCLOSED' },
      });
      await tx.farm.updateMany({
        where: { farmerId: profile.id },
        data: { active: false, lat: null, lng: null, photoKey: null, ward: null, name: 'Closed farm' },
      });
      await tx.supplyListing.updateMany({
        where: { farm: { farmerId: profile.id }, status: { in: ['OPEN', 'PARTIALLY_MATCHED', 'DRAFT'] } },
        data: { status: 'CANCELLED' },
      });
    }
    await tx.account.deleteMany({ where: { userId } });
    await tx.twoFactor.deleteMany({ where: { userId } });
    await tx.deviceToken.deleteMany({ where: { userId } });
    await tx.notification.deleteMany({ where: { userId } });
    await tx.notificationPreference.deleteMany({ where: { userId } });
    await tx.favorite.deleteMany({ where: { userId } });
    await tx.address.deleteMany({ where: { userId, orgId: null } });
    await tx.member.deleteMany({ where: { userId } });
    await tx.invitation.deleteMany({ where: { inviterId: userId } });
    await audit(tx, { actorId: userId, action: 'account.delete', entity: 'User', entityId: userId });
  });
  return { deletedAt };
}

/** Everything we hold about a user, as plain JSON (no credentials, no provider payloads). */
export async function exportAccount(prisma: PrismaClient, userId: string) {
  const [user, profile, memberships, orders, payments, messages, addresses, favorites, reviews, inputOrders] =
    await Promise.all([
      prisma.user.findUniqueOrThrow({
        where: { id: userId },
        select: {
          id: true,
          name: true,
          email: true,
          phoneNumber: true,
          image: true,
          role: true,
          county: true,
          preferredLanguage: true,
          createdAt: true,
        },
      }),
      prisma.farmerProfile.findUnique({
        where: { userId },
        include: { farms: { include: { listings: { include: { produce: { select: { name: true } } } } } } },
      }),
      prisma.member.findMany({
        where: { userId },
        include: { organization: { select: { id: true, name: true, profile: true } } },
      }),
      prisma.order.findMany({
        where: { OR: [{ farmerId: userId }, { createdById: userId }] },
        include: { items: true, events: true },
        orderBy: { createdAt: 'asc' },
      }),
      prisma.payment.findMany({
        where: {
          OR: [
            { initiatedById: userId },
            { order: { farmerId: userId } },
            { inputOrder: { buyerId: userId } },
          ],
        },
        omit: { raw: true },
        orderBy: { createdAt: 'asc' },
      }),
      prisma.orderMessage.findMany({ where: { authorId: userId }, orderBy: { createdAt: 'asc' } }),
      prisma.address.findMany({ where: { userId } }),
      prisma.favorite.findMany({ where: { userId } }),
      prisma.review.findMany({ where: { authorId: userId } }),
      prisma.inputOrder.findMany({ where: { buyerId: userId } }),
    ]);
  const payouts = await prisma.payout.findMany({ where: { farmerId: userId }, omit: { raw: true } });
  return {
    exportedAt: new Date(),
    user,
    farmerProfile: profile,
    organizations: memberships.map((m) => ({ role: m.role, ...m.organization })),
    orders,
    payments,
    payouts,
    messages,
    addresses,
    favorites,
    reviews,
    inputOrders,
  };
}
