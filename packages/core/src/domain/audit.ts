import type { DB } from '@farmgo/db';

export interface AuditEntry {
  actorId?: string | null;
  action: string;
  entity: string;
  entityId: string;
  before?: unknown;
  after?: unknown;
  ip?: string | null;
}

/** Append to the audit log. Used for admin actions, order transitions and money movements. */
export async function audit(db: DB, e: AuditEntry): Promise<void> {
  await db.auditLog.create({
    data: {
      actorId: e.actorId ?? null,
      action: e.action,
      entity: e.entity,
      entityId: e.entityId,
      before: e.before === undefined ? undefined : (JSON.parse(JSON.stringify(e.before)) as object),
      after: e.after === undefined ? undefined : (JSON.parse(JSON.stringify(e.after)) as object),
      ip: e.ip ?? null,
    },
  });
}
