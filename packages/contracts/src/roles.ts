import { z } from 'zod';

/**
 * Platform roles (stored in `user.role`, managed by the Better Auth admin plugin).
 * `user` is a freshly signed-up account that has not chosen a side yet.
 * farmer / buyer / input_supplier are self-service (via onboarding).
 * agent / qa_officer / driver / admin are assigned by an admin.
 */
export const PLATFORM_ROLES = [
  'user',
  'farmer',
  'buyer',
  'input_supplier',
  'agent',
  'qa_officer',
  'driver',
  'admin',
] as const;
export const PlatformRole = z.enum(PLATFORM_ROLES);
export type PlatformRole = z.infer<typeof PlatformRole>;

export const SELF_SERVICE_ROLES = ['farmer', 'buyer', 'input_supplier'] as const;
export const STAFF_ROLES = ['agent', 'qa_officer', 'driver', 'admin'] as const;

/** Organization member roles (Better Auth organization plugin). */
export const ORG_ROLES = ['owner', 'admin', 'member'] as const;
export const OrgRole = z.enum(ORG_ROLES);
