/**
 * Dev owner account, also runnable on its own:  pnpm --filter @farmgo/api dev-owner
 */
import { randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { createAuth } from '@farmgo/auth';
import { isProd } from '@farmgo/config';
import { prisma } from '@farmgo/db';

/**
 * The developer's own account (DEV_ADMIN_EMAIL / DEV_ADMIN_PASSWORD in .env). DEV_ADMIN_ROLE picks
 * its role: `admin` (default; Profile > View as opens any demo user) or `user`, a brand-new
 * account that goes through sign-up setup (pick Individual / Household, Farmer, ...).
 * Re-running resets the password and role to the .env values and signs the account out.
 */
export async function seedDevOwner(auth: ReturnType<typeof createAuth>) {
  const email = process.env.DEV_ADMIN_EMAIL;
  const password = process.env.DEV_ADMIN_PASSWORD;
  if (!email || !password) return;
  if (isProd) {
    // A developer shortcut: never create or reset an admin from .env on a production database.
    console.warn('dev-owner: skipped in production');
    return;
  }
  const name = process.env.DEV_ADMIN_NAME ?? 'FarmGo Owner';
  let user = await prisma.user.findUnique({ where: { email } });
  if (!user) {
    const res = await auth.api.signUpEmail({ body: { email, password, name } });
    user = await prisma.user.findUniqueOrThrow({ where: { id: res.user.id } });
  } else {
    const ctx = await auth.$context;
    const hash = await ctx.password.hash(password);
    const account = await prisma.account.findFirst({ where: { userId: user.id, providerId: 'credential' } });
    if (account) await prisma.account.update({ where: { id: account.id }, data: { password: hash } });
    else
      await prisma.account.create({
        data: {
          id: randomUUID(),
          userId: user.id,
          accountId: user.id,
          providerId: 'credential',
          password: hash,
        },
      });
  }
  const role = process.env.DEV_ADMIN_ROLE === 'user' ? 'user' : 'admin';
  if (role === 'user') {
    // Back to a fresh account: no business, no farmer profile, so setup runs again.
    await prisma.member.deleteMany({ where: { userId: user.id } });
    await prisma.farmerProfile.deleteMany({ where: { userId: user.id } });
  }
  await prisma.user.update({
    where: { id: user.id },
    data: { role, emailVerified: true, banned: false, county: user.county ?? 'Nairobi' },
  });
  // Sessions are cached with the old role: end them so the next sign-in sees the change.
  const ctx = await auth.$context;
  await ctx.internalAdapter.deleteUserSessions(user.id);
  console.log(`dev owner: ${email} (${role})`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const auth = createAuth({ prisma, sendOtp: async () => undefined, sendEmail: async () => undefined });
  seedDevOwner(auth)
    .then(() => prisma.$disconnect())
    .catch(async (err) => {
      console.error(err);
      await prisma.$disconnect();
      process.exit(1);
    });
}
