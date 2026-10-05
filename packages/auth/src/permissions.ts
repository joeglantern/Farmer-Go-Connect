import { createAccessControl } from 'better-auth/plugins/access';
import { adminAc, defaultStatements } from 'better-auth/plugins/admin/access';

/**
 * Platform RBAC. Safe to import from clients (no server dependencies).
 * Roles map 1:1 to `user.role` (see @farmgo/contracts PLATFORM_ROLES).
 */
export const statements = {
  ...defaultStatements,
  produce: ['manage'],
  farm: ['create', 'update', 'read'],
  farmer: ['onboard', 'read', 'kyc'],
  listing: ['create', 'update', 'read'],
  demand: ['create', 'update', 'read', 'board'],
  match: ['respond', 'override', 'read'],
  order: ['create', 'read', 'confirm', 'cancel', 'pay', 'dispute', 'review', 'transition-any'],
  qa: ['inspect', 'read'],
  route: ['build', 'assign', 'drive', 'read'],
  crate: ['manage', 'scan'],
  payment: ['read', 'refund', 'reconcile'],
  input: ['sell', 'buy'],
  report: ['read'],
  setting: ['manage'],
  audit: ['read'],
} as const;

export const ac = createAccessControl(statements);

export const roles = {
  user: ac.newRole({ demand: ['board'], listing: ['read'] }),
  farmer: ac.newRole({
    farm: ['create', 'update', 'read'],
    listing: ['create', 'update', 'read'],
    demand: ['board'],
    match: ['respond', 'read'],
    order: ['read', 'confirm', 'cancel', 'review'],
    // Farmers may also run a green-input enterprise (POST /v1/onboarding/supplier); selling still
    // requires membership of an INPUT_SUPPLIER organization.
    input: ['buy', 'sell'],
  }),
  buyer: ac.newRole({
    listing: ['read'],
    demand: ['create', 'update', 'read', 'board'],
    match: ['respond', 'read'],
    order: ['create', 'read', 'cancel', 'pay', 'dispute', 'review'],
    payment: ['read'],
  }),
  input_supplier: ac.newRole({ input: ['sell', 'buy'], demand: ['board'], listing: ['read'] }),
  agent: ac.newRole({
    farmer: ['onboard', 'read'],
    farm: ['create', 'update', 'read'],
    listing: ['create', 'update', 'read'],
    demand: ['board', 'read'],
    order: ['read'],
    crate: ['scan'],
  }),
  qa_officer: ac.newRole({ qa: ['inspect', 'read'], order: ['read'], listing: ['read'], crate: ['scan'] }),
  driver: ac.newRole({ route: ['drive', 'read'], order: ['read'], crate: ['scan'] }),
  admin: ac.newRole({
    ...adminAc.statements,
    produce: ['manage'],
    farm: ['create', 'update', 'read'],
    farmer: ['onboard', 'read', 'kyc'],
    listing: ['create', 'update', 'read'],
    demand: ['create', 'update', 'read', 'board'],
    match: ['respond', 'override', 'read'],
    order: ['create', 'read', 'confirm', 'cancel', 'pay', 'dispute', 'review', 'transition-any'],
    qa: ['inspect', 'read'],
    route: ['build', 'assign', 'drive', 'read'],
    crate: ['manage', 'scan'],
    payment: ['read', 'refund', 'reconcile'],
    input: ['sell', 'buy'],
    report: ['read'],
    setting: ['manage'],
    audit: ['read'],
  }),
};

export type Statements = typeof statements;
export type Resource = keyof Statements;
export type Permission = { [R in Resource]?: Statements[R][number][] };

/** Pure permission check used by the API (no DB call). */
export function roleHasPermission(role: string | null | undefined, permission: Permission): boolean {
  const r = roles[(role ?? 'user') as keyof typeof roles];
  if (!r) return false;
  // biome-ignore lint/suspicious/noExplicitAny: Better Auth's Role.authorize is generic over statements
  return (r.authorize(permission as any) as { success: boolean }).success;
}
