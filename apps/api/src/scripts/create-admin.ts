/**
 * Create (or promote) a platform admin.
 *   pnpm --filter @farmgo/api create-admin you@example.com "Your Name" 'a-long-password'
 * The admin must enable two-factor authentication after first sign-in.
 */
import { createAuth } from '@farmgo/auth';
import { audit } from '@farmgo/core';
import { prisma } from '@farmgo/db';

const [email, name, password] = process.argv.slice(2);
if (!email || !name || !password || password.length < 12) {
  console.error('Usage: create-admin <email> <name> <password (12+ characters)>');
  process.exit(1);
}

const auth = createAuth({ prisma, sendOtp: async () => undefined, sendEmail: async () => undefined });

async function main() {
  let user = await prisma.user.findUnique({ where: { email: email! } });
  if (!user) {
    const res = await auth.api.signUpEmail({ body: { email: email!, password: password!, name: name! } });
    user = await prisma.user.findUniqueOrThrow({ where: { id: res.user.id } });
  }
  await prisma.user.update({ where: { id: user.id }, data: { role: 'admin', emailVerified: true } });
  await audit(prisma, { action: 'user.create_admin', entity: 'User', entityId: user.id, after: { email } });
  console.log(`done: ${email} is now an admin`);
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (err) => {
    console.error(err);
    await prisma.$disconnect();
    process.exit(1);
  });
