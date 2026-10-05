import { expo } from '@better-auth/expo';
import { env, isProd } from '@farmgo/config';
import { isPhoneTempEmail, normalizeKenyanPhone, phoneTempEmail } from '@farmgo/contracts';
import type { PrismaClient } from '@farmgo/db';
import { betterAuth } from 'better-auth';
import { prismaAdapter } from 'better-auth/adapters/prisma';
import { admin, bearer, organization, phoneNumber, twoFactor } from 'better-auth/plugins';
import { ac, roles } from './permissions.js';

/** Better Auth secondary storage contract (implemented over Redis in @farmgo/core). */
export interface KeyValueStore {
  get(key: string): Promise<string | null>;
  getAndDelete(key: string): Promise<string | null>;
  increment(key: string, ttlSeconds: number): Promise<number>;
  set(key: string, value: string, ttlSeconds?: number): Promise<unknown>;
  delete(key: string): Promise<void>;
}

export interface AuthDeps {
  prisma: PrismaClient;
  /** Redis-backed store for sessions cache and auth rate limiting. */
  secondaryStorage?: KeyValueStore;
  sendOtp: (phoneNumber: string, code: string, purpose: 'sign-in' | 'password-reset') => Promise<void>;
  /** Called after Better Auth changes a user or one of their sessions (cache invalidation). */
  onUserChanged?: (userId: string) => Promise<void> | void;
  sendEmail: (
    to: string,
    template: 'verify-email' | 'reset-password' | 'org-invite',
    data: Record<string, string>,
  ) => Promise<void>;
}

export function createAuth(deps: AuthDeps) {
  const trustedOrigins = Array.from(
    new Set([env.WEB_URL, env.ADMIN_URL, env.MOBILE_SCHEME, ...env.CORS_ORIGINS].filter(Boolean)),
  );

  return betterAuth({
    appName: 'FarmGo Connect',
    baseURL: env.BETTER_AUTH_URL,
    basePath: '/api/auth',
    secret: env.BETTER_AUTH_SECRET,
    database: prismaAdapter(deps.prisma, { provider: 'postgresql' }),
    secondaryStorage: deps.secondaryStorage,
    trustedOrigins,

    databaseHooks: {
      user: { update: { after: async (user) => void (await deps.onUserChanged?.(user.id)) } },
      session: {
        update: { after: async (session) => void (await deps.onUserChanged?.(session.userId)) },
      },
    },

    emailAndPassword: {
      enabled: true,
      minPasswordLength: 8,
      requireEmailVerification: false,
      sendResetPassword: async ({ user, url }) => {
        if (isPhoneTempEmail(user.email)) return;
        await deps.sendEmail(user.email, 'reset-password', { name: user.name, url });
      },
    },
    emailVerification: {
      sendOnSignUp: true,
      autoSignInAfterVerification: true,
      sendVerificationEmail: async ({ user, url }) => {
        if (isPhoneTempEmail(user.email)) return;
        await deps.sendEmail(user.email, 'verify-email', { name: user.name, url });
      },
    },

    session: {
      expiresIn: 60 * 60 * 24 * 30, // 30 days: farmers should not have to log in often
      updateAge: 60 * 60 * 24,
      // Off so revoked sessions and role changes apply immediately; Redis keeps lookups fast.
      cookieCache: { enabled: false },
      storeSessionInDatabase: true,
    },

    user: {
      additionalFields: {
        preferredLanguage: { type: 'string', required: false, defaultValue: 'sw', input: true },
        county: { type: 'string', required: false, input: true },
      },
    },

    rateLimit: {
      enabled: env.NODE_ENV !== 'test',
      storage: deps.secondaryStorage ? 'secondary-storage' : 'memory',
      window: 60,
      max: 100,
      customRules: {
        '/phone-number/send-otp': { window: 60, max: 3 },
        '/phone-number/verify': { window: 60, max: 10 },
        '/sign-in/email': { window: 60, max: 10 },
        '/request-password-reset': { window: 300, max: 3 },
      },
    },

    advanced: {
      cookiePrefix: 'farmgo',
      useSecureCookies: isProd,
      ipAddress: { ipAddressHeaders: ['x-forwarded-for', 'x-real-ip'] },
    },

    plugins: [
      phoneNumber({
        otpLength: 6,
        expiresIn: 300,
        allowedAttempts: 5,
        phoneNumberValidator: (p) => normalizeKenyanPhone(p) === p,
        sendOTP: async ({ phoneNumber: phone, code }) => deps.sendOtp(phone, code, 'sign-in'),
        sendPasswordResetOTP: async ({ phoneNumber: phone, code }) =>
          deps.sendOtp(phone, code, 'password-reset'),
        signUpOnVerification: {
          getTempEmail: phoneTempEmail,
          getTempName: (phone) => phone,
        },
      }),
      organization({
        // Organizations are created by /v1/onboarding/buyer|supplier, which also creates the
        // OrgProfile every business endpoint needs. A raw organization/create would add a
        // profile-less org and switch the session to it, locking the user out (QA-009).
        allowUserToCreateOrganization: false,
        organizationLimit: 5,
        membershipLimit: 50,
        invitationExpiresIn: 60 * 60 * 24 * 7,
        sendInvitationEmail: async (data) => {
          await deps.sendEmail(data.email, 'org-invite', {
            organization: data.organization.name,
            inviter: data.inviter.user.name,
            url: `${env.WEB_URL}/invite/${data.id}`,
          });
        },
      }),
      admin({
        ac,
        roles,
        defaultRole: 'user',
        adminRoles: ['admin'],
        impersonationSessionDuration: 60 * 30,
      }),
      twoFactor({ issuer: 'FarmGo Connect' }),
      bearer(),
      expo(),
    ],
  });
}

export type Auth = ReturnType<typeof createAuth>;
export type AuthSession = NonNullable<Awaited<ReturnType<Auth['api']['getSession']>>>;
export type AuthUser = AuthSession['user'];
